const db = require('../lib/database');
const hubspot = require('../lib/hubspot-client');
const rentman = require('../lib/rentman-client');
const { createChildLogger } = require('../lib/logger');
const { SyncLogger } = require('./sync-logger');
const { sanitizeNumber, previousWeekday, nextWeekday, extractIdFromRef } = require('../lib/utils');
const config = require('../config');

const logger = createChildLogger('sync-deals');

async function syncDeals(options = {}) {
    const {
        batchSize = 50,
        triggeredBy = 'system'
    } = options;

    // Deals/projects kan kun synkroniseres fra Rentman til HubSpot
    // Rentman API understøtter ikke create/update af projects
    const direction = 'rentman_to_hubspot';

    const syncLogger = new SyncLogger('deal', direction, triggeredBy);
    await syncLogger.start({ batchSize, options });

    try {
        await syncRentmanToHubspot(syncLogger, batchSize);

        await syncLogger.complete();
        return syncLogger.getStats();
    } catch (error) {
        await syncLogger.logError(
            'unknown',
            'critical',
            'internal',
            error.message,
            { stackTrace: error.stack }
        );
        await syncLogger.fail(error.message);
        throw error;
    }
}

async function syncRentmanToHubspot(syncLogger, batchSize) {
    logger.info('Starting Rentman to HubSpot deal sync');

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
        // rentman.get() returnerer data direkte (array), ikke { data: [...] }
        const projects = await rentman.get(`/projects?limit=${batchSize}&offset=${offset}`);

        if (!projects || !Array.isArray(projects) || projects.length === 0) {
            hasMore = false;
            break;
        }

        await syncLogger.updateProgress(syncLogger.getStats().processedItems, null);

        for (const rentmanProject of projects) {
            try {
                // Skip "internal subrental" projekter
                const projectName = (rentmanProject.displayname || rentmanProject.name || '').toLowerCase();
                if (projectName.includes('internal subrental')) {
                    logger.debug('Skipper internal subrental projekt', { id: rentmanProject.id, name: projectName });
                    continue;
                }

                const existingSync = await db.findSyncedDealByRentmanId(rentmanProject.id);

                if (existingSync) {
                    await updateHubspotDeal(rentmanProject, existingSync, syncLogger);
                } else {
                    await createHubspotDeal(rentmanProject, syncLogger);
                }
            } catch (error) {
                await handleItemError(syncLogger, 'deal', null, rentmanProject.id, error, 'rentman');
            }
        }

        offset += batchSize;
        hasMore = projects.length === batchSize;
    }
}

async function createHubspotDeal(rentmanProject, syncLogger) {
    const properties = await mapRentmanToHubspotDeal(rentmanProject);

    // Hent company og contact til associations - samme som webhook service
    const customerId = extractIdFromRef(rentmanProject.customer);
    const custContactId = extractIdFromRef(rentmanProject.cust_contact);

    let companySync = null;
    let contactSync = null;

    if (customerId) {
        companySync = await db.findSyncedCompanyByRentmanId(customerId);
    }
    if (custContactId) {
        contactSync = await db.findSyncedContactByRentmanId(custContactId);
    }

    // Opret deal med associations
    const result = await hubspot.createDeal(
        properties,
        companySync?.hubspot_id || null,
        contactSync?.hubspot_id || null
    );

    if (result?.id) {
        await db.insertSyncedDeal(
            rentmanProject.displayname,
            rentmanProject.id,
            result.id,
            companySync?.id || 0,
            contactSync?.id || 0
        );

        await syncLogger.logItem(
            'deal',
            result.id,
            String(rentmanProject.id),
            'create',
            'success',
            { dataAfter: properties }
        );

        logger.info('Created HubSpot deal from Rentman', {
            rentmanId: rentmanProject.id,
            hubspotId: result.id,
            companyId: companySync?.hubspot_id,
            contactId: contactSync?.hubspot_id
        });

        // Sync tilhørende subprojects (orders)
        await syncProjectSubprojects(rentmanProject.id, result.id, companySync, contactSync, syncLogger);
    }
}

async function updateHubspotDeal(rentmanProject, existingSync, syncLogger) {
    const properties = await mapRentmanToHubspotDeal(rentmanProject);

    await hubspot.updateDeal(existingSync.hubspot_project_id, properties);

    await syncLogger.logItem(
        'deal',
        existingSync.hubspot_project_id,
        String(rentmanProject.id),
        'update',
        'success',
        { dataAfter: properties }
    );

    logger.debug('Updated HubSpot deal from Rentman', {
        rentmanId: rentmanProject.id,
        hubspotId: existingSync.hubspot_project_id
    });

    // Sync tilhørende subprojects (orders)
    const customerId = extractIdFromRef(rentmanProject.customer);
    const custContactId = extractIdFromRef(rentmanProject.cust_contact);

    let companySync = null;
    let contactSync = null;

    if (customerId) {
        companySync = await db.findSyncedCompanyByRentmanId(customerId);
    }
    if (custContactId) {
        contactSync = await db.findSyncedContactByRentmanId(custContactId);
    }

    await syncProjectSubprojects(rentmanProject.id, existingSync.hubspot_project_id, companySync, contactSync, syncLogger);
}

/**
 * Syncer alle subprojects (orders) for et projekt.
 * Kaldes efter deal create/update.
 */
async function syncProjectSubprojects(rentmanProjectId, hubspotDealId, companySync, contactSync, syncLogger) {
    try {
        const subprojects = await rentman.getProjectSubprojects(`/projects/${rentmanProjectId}`);

        if (!subprojects || !Array.isArray(subprojects) || subprojects.length === 0) {
            logger.debug('Ingen subprojects fundet for projekt', { projectId: rentmanProjectId });
            return;
        }

        logger.info('Syncer subprojects for projekt', {
            projectId: rentmanProjectId,
            count: subprojects.length
        });

        for (const subproject of subprojects) {
            try {
                // Skip "internal subrental" subprojects
                const subprojectName = (subproject.displayname || subproject.name || '').toLowerCase();
                if (subprojectName.includes('internal subrental')) {
                    logger.debug('Skipper internal subrental subproject', { id: subproject.id, name: subprojectName });
                    continue;
                }

                const existingOrderSync = await db.findSyncedOrderByRentmanId(subproject.id);

                if (existingOrderSync) {
                    // Opdater eksisterende order
                    await updateSubprojectOrder(subproject, existingOrderSync, syncLogger);
                } else {
                    // Opret ny order
                    await createSubprojectOrder(subproject, hubspotDealId, companySync, contactSync, syncLogger);
                }
            } catch (error) {
                logger.error('Fejl ved sync af subproject', {
                    subprojectId: subproject.id,
                    error: error.message
                });
                await syncLogger.logItem(
                    'order',
                    null,
                    String(subproject.id),
                    'error',
                    'failed',
                    { errorMessage: error.message }
                );
            }
        }
    } catch (error) {
        logger.error('Fejl ved hentning af subprojects', {
            projectId: rentmanProjectId,
            error: error.message
        });
    }
}

async function createSubprojectOrder(subproject, hubspotDealId, companySync, contactSync, syncLogger) {
    // Hent status fra Rentman API
    const status = await rentman.getStatus(subproject.status);
    const stageId = hubspot.getOrderStageFromRentmanStatus(status?.id);
    const projectId = extractIdFromRef(subproject.project);

    const properties = {
        hs_order_name: subproject.displayname || subproject.name || 'Unnamed Order',
        hs_total_price: sanitizeNumber(subproject.project_total_price) || 0,
        hs_pipeline: config.hubspot.pipelines.orders,
        hs_pipeline_stage: stageId,
        start_projekt_period: subproject.usageperiod_start || null,
        slut_projekt_period: subproject.usageperiod_end || null,
        start_planning_period: subproject.planperiod_start || null,
        slut_planning_period: subproject.planperiod_end || null,
        rabat: sanitizeNumber(subproject.discount_subproject),
        fixed_price: subproject.fixed_price,
        rental_price: subproject.project_rental_price,
        sale_price: subproject.project_sale_price,
        crew_price: subproject.project_crew_price,
        transport_price: subproject.project_transport_price,
        rentman_projekt: rentman.buildProjectUrl ? rentman.buildProjectUrl(projectId, subproject.id) : null
    };

    const result = await hubspot.createOrder(
        properties,
        hubspotDealId,
        companySync?.hubspot_id || null,
        contactSync?.hubspot_id || null
    );

    if (result?.id) {
        const dealSync = await db.findSyncedDealByHubspotId(hubspotDealId);

        await db.insertSyncedOrder(
            subproject.displayname,
            subproject.id,
            result.id,
            companySync?.id || 0,
            contactSync?.id || 0,
            dealSync?.id || null
        );

        // Opdater dashboard database
        if (projectId) {
            const projectData = await rentman.getProject(projectId);
            if (projectData) {
                await db.upsertDashboardSubproject({ data: subproject }, { data: projectData });
            }
        }

        await syncLogger.logItem(
            'order',
            result.id,
            String(subproject.id),
            'create',
            'success',
            { dataAfter: properties }
        );

        logger.info('Created HubSpot order from subproject', {
            rentmanId: subproject.id,
            hubspotId: result.id,
            dealId: hubspotDealId
        });
    }
}

async function updateSubprojectOrder(subproject, existingSync, syncLogger) {
    // Hent status fra Rentman API
    const status = await rentman.getStatus(subproject.status);
    const stageId = hubspot.getOrderStageFromRentmanStatus(status?.id);
    const projectId = extractIdFromRef(subproject.project);

    const properties = {
        hs_order_name: subproject.displayname || subproject.name || 'Unnamed Order',
        hs_total_price: sanitizeNumber(subproject.project_total_price) || 0,
        hs_pipeline: config.hubspot.pipelines.orders,
        hs_pipeline_stage: stageId,
        start_projekt_period: subproject.usageperiod_start || null,
        slut_projekt_period: subproject.usageperiod_end || null,
        start_planning_period: subproject.planperiod_start || null,
        slut_planning_period: subproject.planperiod_end || null,
        rabat: sanitizeNumber(subproject.discount_subproject),
        fixed_price: subproject.fixed_price,
        rental_price: subproject.project_rental_price,
        sale_price: subproject.project_sale_price,
        crew_price: subproject.project_crew_price,
        transport_price: subproject.project_transport_price,
        rentman_projekt: rentman.buildProjectUrl ? rentman.buildProjectUrl(projectId, subproject.id) : null
    };

    await hubspot.updateOrder(existingSync.hubspot_order_id, properties);
    await db.updateSyncedOrderName(subproject.id, subproject.displayname);

    // Opdater dashboard database
    if (projectId) {
        const projectData = await rentman.getProject(projectId);
        if (projectData) {
            await db.upsertDashboardSubproject({ data: subproject }, { data: projectData });
        }
    }

    await syncLogger.logItem(
        'order',
        existingSync.hubspot_order_id,
        String(subproject.id),
        'update',
        'success',
        { dataAfter: properties }
    );

    logger.debug('Updated HubSpot order from subproject', {
        rentmanId: subproject.id,
        hubspotId: existingSync.hubspot_order_id
    });
}

async function mapRentmanToHubspotDeal(rentmanProject) {
    const syncedUsers = await db.getSyncedUsers();
    let hubspotOwnerId = null;

    if (rentmanProject.account_manager) {
        const accountManagerId = extractIdFromRef(rentmanProject.account_manager);
        const userMapping = syncedUsers.find(u =>
            u.rentman_id?.toString() === accountManagerId?.toString() ||
            u.rentman_user_id === parseInt(accountManagerId)
        );
        hubspotOwnerId = userMapping?.hubspot_id || userMapping?.hubspot_owner_id;
    }

    const properties = {
        dealname: rentmanProject.displayname || rentmanProject.name || 'Unnamed Project',
        amount: sanitizeNumber(rentmanProject.project_total_price) || 0,
        dealstage: 'appointmentscheduled',
        rentman_database_id: rentmanProject.number,
        rentman_projekt: rentman.buildProjectUrl ? rentman.buildProjectUrl(rentmanProject.id) : null
    };

    // Sæt pipeline hvis konfigureret (og ikke 'default')
    if (config.hubspot?.pipelines?.deals && config.hubspot.pipelines.deals !== 'default') {
        properties.pipeline = config.hubspot.pipelines.deals;
    }

    if (hubspotOwnerId) {
        properties.hubspot_owner_id = hubspotOwnerId;
    }

    // Datofelter - samme som webhook service
    if (rentmanProject.usageperiod_start) {
        properties.usage_period = new Date(rentmanProject.usageperiod_start);
    }
    if (rentmanProject.usageperiod_end) {
        properties.slut_projekt_period = new Date(rentmanProject.usageperiod_end);
    }
    if (rentmanProject.planperiod_start) {
        properties.start_planning_period = new Date(rentmanProject.planperiod_start);
    }
    if (rentmanProject.planperiod_end) {
        properties.slut_planning_period = new Date(rentmanProject.planperiod_end);
    }
    console.log(properties)
    console.log(rentmanProject)
    return properties;
}

async function handleItemError(syncLogger, itemType, hubspotId, rentmanId, error, sourceSystem) {
    const errorType = categorizeError(error);
    const severity = error.response?.status >= 500 ? 'high' : 'medium';

    const itemLogId = await syncLogger.logItem(
        itemType,
        hubspotId,
        rentmanId ? String(rentmanId) : null,
        'error',
        'failed',
        {
            errorMessage: error.message,
            errorCode: error.response?.status?.toString()
        }
    );

    await syncLogger.logError(
        errorType,
        severity,
        sourceSystem,
        error.message,
        {
            errorCode: error.response?.status?.toString(),
            stackTrace: error.stack,
            context: { hubspotId, rentmanId },
            syncItemLogId: itemLogId
        }
    );

    logger.error('Deal sync error', {
        hubspotId,
        rentmanId,
        error: error.message
    });
}

function categorizeError(error) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        return 'connection_error';
    }
    if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
        return 'timeout';
    }
    if (error.response?.status === 429) {
        return 'rate_limit';
    }
    if (error.response?.status >= 400 && error.response?.status < 500) {
        return 'validation_error';
    }
    if (error.response?.status >= 500) {
        return 'api_error';
    }
    return 'unknown';
}

async function syncSingleDeal(rentmanId = null, hubspotId = null) {
    // Deals/projects kan kun synkroniseres fra Rentman til HubSpot
    const syncLogger = new SyncLogger('deal', 'rentman_to_hubspot', 'manual');
    await syncLogger.start({ rentmanId, hubspotId, singleItem: true });
    syncLogger.stats.totalItems = 1;

    try {
        if (rentmanId) {
            const rentmanProject = await rentman.getProject(rentmanId);
            if (rentmanProject) {
                const existingSync = await db.findSyncedDealByRentmanId(rentmanId);
                if (existingSync) {
                    await updateHubspotDeal(rentmanProject, existingSync, syncLogger);
                } else {
                    await createHubspotDeal(rentmanProject, syncLogger);
                }
            }
        } else if (hubspotId) {
            // Kan ikke synkronisere fra HubSpot til Rentman - tjek kun om den findes
            const existingSync = await db.findSyncedDealByHubspotId(hubspotId);
            if (existingSync) {
                logger.info('HubSpot deal er allerede synkroniseret', {
                    hubspotId,
                    rentmanId: existingSync.rentman_project_id
                });
            } else {
                logger.info('HubSpot deal ikke fundet i Rentman - kan ikke oprettes via API', {
                    hubspotId
                });
                await syncLogger.logItem(
                    'deal',
                    hubspotId,
                    null,
                    'skip',
                    'skipped',
                    { errorMessage: 'Rentman API understøtter ikke oprettelse af projects' }
                );
            }
        }

        await syncLogger.complete();
        return syncLogger.getStats();
    } catch (error) {
        await syncLogger.fail(error.message);
        throw error;
    }
}

async function syncDealFinancials(rentmanProjectId) {
    const syncLogger = new SyncLogger('deal', 'rentman_to_hubspot', 'financial_update');
    await syncLogger.start({ rentmanProjectId, financialUpdate: true });

    try {
        const existingSync = await db.findSyncedDealByRentmanId(rentmanProjectId);
        if (!existingSync) {
            await syncLogger.logItem('deal', null, String(rentmanProjectId), 'skip', 'skipped', {
                errorMessage: 'Deal not synced'
            });
            await syncLogger.complete();
            return;
        }

        const rentmanProject = await rentman.getProject(rentmanProjectId);
        if (!rentmanProject) {
            await syncLogger.fail('Could not fetch Rentman project');
            return;
        }

        const totalPrice = sanitizeNumber(rentmanProject.project_total_price);

        await hubspot.updateDeal(existingSync.hubspot_project_id, {
            amount: totalPrice
        });

        await syncLogger.logItem(
            'deal',
            existingSync.hubspot_project_id,
            String(rentmanProjectId),
            'update',
            'success',
            { dataAfter: { amount: totalPrice } }
        );

        await syncLogger.complete();

        logger.info('Synced deal financials', {
            rentmanId: rentmanProjectId,
            hubspotId: existingSync.hubspot_project_id,
            amount: totalPrice
        });
    } catch (error) {
        await syncLogger.fail(error.message);
        throw error;
    }
}

module.exports = {
    syncDeals,
    syncSingleDeal,
    syncDealFinancials
};

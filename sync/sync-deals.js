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
        direction = 'bidirectional',
        batchSize = 50,
        triggeredBy = 'system'
    } = options;

    const syncLogger = new SyncLogger('deal', direction, triggeredBy);
    await syncLogger.start({ batchSize, options });

    try {
        if (direction === 'rentman_to_hubspot' || direction === 'bidirectional') {
            await syncRentmanToHubspot(syncLogger, batchSize);
        }

        if (direction === 'hubspot_to_rentman' || direction === 'bidirectional') {
            await syncHubspotToRentman(syncLogger, batchSize);
        }

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
        const projects = await rentman.get(`/projects?limit=${batchSize}&offset=${offset}`);

        if (!projects?.data || projects.data.length === 0) {
            hasMore = false;
            break;
        }

        await syncLogger.updateProgress(syncLogger.getStats().processedItems, null);

        for (const rentmanProject of projects.data) {
            try {
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
        hasMore = projects.data.length === batchSize;
    }
}

async function syncHubspotToRentman(syncLogger, batchSize) {
    logger.info('Starting HubSpot to Rentman deal sync');

    let after = undefined;
    let hasMore = true;

    while (hasMore) {
        const response = await hubspot.searchDeals({
            limit: batchSize,
            after,
            properties: [
                'dealname', 'amount', 'dealstage', 'pipeline',
                'planning_period_start', 'planning_period_end',
                'hubspot_owner_id', 'closedate'
            ]
        });

        if (!response?.results || response.results.length === 0) {
            hasMore = false;
            break;
        }

        for (const hubspotDeal of response.results) {
            try {
                const existingSync = await db.findSyncedDealByHubspotId(hubspotDeal.id);

                if (existingSync) {
                    await updateRentmanProject(hubspotDeal, existingSync, syncLogger);
                } else {
                    await createRentmanProject(hubspotDeal, syncLogger);
                }
            } catch (error) {
                await handleItemError(syncLogger, 'deal', hubspotDeal.id, null, error, 'hubspot');
            }
        }

        after = response.paging?.next?.after;
        hasMore = !!after;
    }
}

async function createHubspotDeal(rentmanProject, syncLogger) {
    const properties = await mapRentmanToHubspotDeal(rentmanProject);

    const result = await hubspot.createDeal(properties);

    if (result?.id) {
        await db.addSyncedDeal(rentmanProject.id, result.id);

        const contactId = extractIdFromRef(rentmanProject.contact);
        if (contactId) {
            const companySync = await db.findSyncedCompanyByRentmanId(contactId);
            if (companySync?.hubspot_company_id) {
                await hubspot.associateDealToCompany(result.id, companySync.hubspot_company_id);
            }
        }

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
            hubspotId: result.id
        });
    }
}

async function updateHubspotDeal(rentmanProject, existingSync, syncLogger) {
    const properties = await mapRentmanToHubspotDeal(rentmanProject, true);

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
}

async function createRentmanProject(hubspotDeal, syncLogger) {
    const props = hubspotDeal.properties || {};

    const associations = await hubspot.getDealAssociations(hubspotDeal.id, 'companies');
    let rentmanContactId = null;

    if (associations?.results?.length > 0) {
        const hubspotCompanyId = associations.results[0].id;
        const companySync = await db.findSyncedCompanyByHubspotId(hubspotCompanyId);
        rentmanContactId = companySync?.rentman_contact_id;
    }

    if (!rentmanContactId) {
        await syncLogger.logItem(
            'deal',
            hubspotDeal.id,
            null,
            'skip',
            'skipped',
            { errorMessage: 'No associated company found in Rentman' }
        );
        return;
    }

    const projectData = mapHubspotToRentmanProject(hubspotDeal, rentmanContactId);

    const result = await rentman.post('/projects', projectData);

    if (result?.data?.id) {
        await db.addSyncedDeal(result.data.id, hubspotDeal.id);

        await syncLogger.logItem(
            'deal',
            hubspotDeal.id,
            String(result.data.id),
            'create',
            'success',
            { dataAfter: projectData }
        );

        logger.info('Created Rentman project from HubSpot', {
            hubspotId: hubspotDeal.id,
            rentmanId: result.data.id
        });
    }
}

async function updateRentmanProject(hubspotDeal, existingSync, syncLogger) {
    const projectData = mapHubspotToRentmanProject(hubspotDeal);

    await rentman.put(`/projects/${existingSync.rentman_project_id}`, projectData);

    await syncLogger.logItem(
        'deal',
        hubspotDeal.id,
        String(existingSync.rentman_project_id),
        'update',
        'success',
        { dataAfter: projectData }
    );

    logger.debug('Updated Rentman project from HubSpot', {
        hubspotId: hubspotDeal.id,
        rentmanId: existingSync.rentman_project_id
    });
}

async function mapRentmanToHubspotDeal(rentmanProject, isUpdate = false) {
    const syncedUsers = await db.getSyncedUsers();
    let hubspotOwnerId = null;

    if (rentmanProject.account_manager) {
        const accountManagerId = extractIdFromRef(rentmanProject.account_manager);
        const userMapping = syncedUsers.find(u => u.rentman_id?.toString() === accountManagerId?.toString());
        hubspotOwnerId = userMapping?.hubspot_id;
    }

    const properties = {
        dealname: rentmanProject.displayname || rentmanProject.name || 'Unnamed Project',
        amount: sanitizeNumber(rentmanProject.project_total_price) || 0,
        pipeline: config.hubspot.pipelineId,
        rentman_database_id: rentmanProject.number
    };

    if (!isUpdate) {
        properties.dealstage = 'appointmentscheduled';
    }

    if (isUpdate) {
        properties.opret_i_rentam_request = 'Ja';
        properties.hidden_rentman_request = true;
        properties.rentman_projekt = rentman.buildProjectUrl(rentmanProject.id);
    }

    if (hubspotOwnerId) {
        properties.hubspot_owner_id = hubspotOwnerId;
    }

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

    return properties;
}

function mapHubspotToRentmanProject(hubspotDeal, rentmanContactId = null) {
    const props = hubspotDeal.properties || {};

    const data = {
        displayname: props.dealname || 'Unnamed Deal'
    };

    if (rentmanContactId) {
        data.contact = `/contacts/${rentmanContactId}`;
    }

    if (props.planning_period_start) {
        data.planperiod_start = props.planning_period_start;
    }

    if (props.planning_period_end) {
        data.planperiod_end = props.planning_period_end;
    }

    return data;
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
    const syncLogger = new SyncLogger('deal', 'bidirectional', 'manual');
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
            const hubspotDeal = await hubspot.getDeal(hubspotId);
            if (hubspotDeal) {
                const existingSync = await db.findSyncedDealByHubspotId(hubspotId);
                if (existingSync) {
                    await updateRentmanProject(hubspotDeal, existingSync, syncLogger);
                } else {
                    await createRentmanProject(hubspotDeal, syncLogger);
                }
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

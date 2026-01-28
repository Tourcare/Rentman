const db = require('../lib/database');
const hubspot = require('../lib/hubspot-client');
const rentman = require('../lib/rentman-client');
const { createChildLogger } = require('../lib/logger');
const { SyncLogger } = require('./sync-logger');
const { sanitizeNumber, extractIdFromRef } = require('../lib/utils');
const config = require('../config');

const logger = createChildLogger('sync-orders');

async function syncOrders(options = {}) {
    const {
        batchSize = 50,
        triggeredBy = 'system'
    } = options;

    // Orders/subprojects kan kun synkroniseres fra Rentman til HubSpot
    // Rentman API understøtter ikke create/update af subprojects
    const direction = 'rentman_to_hubspot';

    const syncLogger = new SyncLogger('order', direction, triggeredBy);
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
    logger.info('Starting Rentman to HubSpot order sync');

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
        // rentman.get() returnerer data direkte (array), ikke { data: [...] }
        const subprojects = await rentman.get(`/subprojects?limit=${batchSize}&offset=${offset}`);

        if (!subprojects || !Array.isArray(subprojects) || subprojects.length === 0) {
            hasMore = false;
            break;
        }

        await syncLogger.updateProgress(syncLogger.getStats().processedItems, null);

        for (const rentmanSubproject of subprojects) {
            try {
                // Skip "internal subrental" subprojects
                const subprojectName = (rentmanSubproject.displayname || rentmanSubproject.name || '').toLowerCase();
                if (subprojectName.includes('internal subrental')) {
                    logger.debug('Skipper internal subrental subproject', { id: rentmanSubproject.id, name: subprojectName });
                    continue;
                }

                const existingSync = await db.findSyncedOrderByRentmanId(rentmanSubproject.id);

                if (existingSync) {
                    await updateHubspotOrder(rentmanSubproject, existingSync, syncLogger);
                } else {
                    await createHubspotOrder(rentmanSubproject, syncLogger);
                }
            } catch (error) {
                await handleItemError(syncLogger, 'order', null, rentmanSubproject.id, error, 'rentman');
            }
        }

        offset += batchSize;
        hasMore = subprojects.length === batchSize;
    }
}

async function createHubspotOrder(rentmanSubproject, syncLogger) {
    const projectId = extractIdFromRef(rentmanSubproject.project);
    if (!projectId) {
        await syncLogger.logItem(
            'order',
            null,
            String(rentmanSubproject.id),
            'skip',
            'skipped',
            { errorMessage: 'No parent project reference' }
        );
        return;
    }

    const dealSync = await db.findSyncedDealByRentmanId(projectId);
    if (!dealSync) {
        await syncLogger.logItem(
            'order',
            null,
            String(rentmanSubproject.id),
            'skip',
            'skipped',
            { errorMessage: 'Parent deal not synced' }
        );
        return;
    }

    // Hent project info for at få company og contact - samme som webhook service
    const projectInfo = await rentman.getProject(projectId);
    let companySync = null;
    let contactSync = null;

    if (projectInfo) {
        const customerId = extractIdFromRef(projectInfo.customer);
        const custContactId = extractIdFromRef(projectInfo.cust_contact);

        if (customerId) {
            companySync = await db.findSyncedCompanyByRentmanId(customerId);
        }
        if (custContactId) {
            contactSync = await db.findSyncedContactByRentmanId(custContactId);
        }
    }

    const properties = await mapRentmanToHubspotOrder(rentmanSubproject);

    // Opret order med alle associations - samme som webhook service
    const result = await hubspot.createOrder(
        properties,
        dealSync.hubspot_project_id,
        companySync?.hubspot_id || null,
        contactSync?.hubspot_id || null
    );

    if (result?.id) {
        await db.insertSyncedOrder(
            rentmanSubproject.displayname,
            rentmanSubproject.id,
            result.id,
            companySync?.id || 0,
            contactSync?.id || 0,
            dealSync.id
        );

        // Opdater dashboard database
        await updateDashboardSubproject(rentmanSubproject, projectId);

        await syncLogger.logItem(
            'order',
            result.id,
            String(rentmanSubproject.id),
            'create',
            'success',
            { dataAfter: properties }
        );

        logger.info('Created HubSpot order from Rentman', {
            rentmanId: rentmanSubproject.id,
            hubspotId: result.id,
            dealId: dealSync.hubspot_project_id,
            companyId: companySync?.hubspot_id,
            contactId: contactSync?.hubspot_id
        });

        await updateParentDealStatus(dealSync.hubspot_project_id);
    }
}

async function updateHubspotOrder(rentmanSubproject, existingSync, syncLogger) {
    const properties = await mapRentmanToHubspotOrder(rentmanSubproject);

    await hubspot.updateOrder(existingSync.hubspot_order_id, properties);

    // Opdater navn i database - samme som webhook service
    await db.updateSyncedOrderName(rentmanSubproject.id, rentmanSubproject.displayname);

    // Opdater dashboard database
    const projectId = extractIdFromRef(rentmanSubproject.project);
    if (projectId) {
        await updateDashboardSubproject(rentmanSubproject, projectId);
    }

    await syncLogger.logItem(
        'order',
        existingSync.hubspot_order_id,
        String(rentmanSubproject.id),
        'update',
        'success',
        { dataAfter: properties }
    );

    logger.debug('Updated HubSpot order from Rentman', {
        rentmanId: rentmanSubproject.id,
        hubspotId: existingSync.hubspot_order_id
    });

    // Hent deal ID via join - synced_order har kun synced_deals_id (FK)
    const hubspotDealId = await db.getHubspotDealIdForOrder(rentmanSubproject.id);
    if (hubspotDealId) {
        await updateParentDealStatus(hubspotDealId);
    }
}

async function mapRentmanToHubspotOrder(rentmanSubproject) {
    // Hent status fra Rentman API - samme som webhook service
    const status = await rentman.getStatus(rentmanSubproject.status);
    const stageId = hubspot.getOrderStageFromRentmanStatus(status?.id);
    const projectId = extractIdFromRef(rentmanSubproject.project);

    return {
        hs_order_name: rentmanSubproject.displayname || rentmanSubproject.name || 'Unnamed Order',
        hs_total_price: sanitizeNumber(rentmanSubproject.project_total_price) || 0,
        hs_pipeline: config.hubspot.pipelines.orders,
        hs_pipeline_stage: stageId,
        // Datofelter - samme som webhook service
        start_projekt_period: rentmanSubproject.usageperiod_start || null,
        slut_projekt_period: rentmanSubproject.usageperiod_end || null,
        start_planning_period: rentmanSubproject.planperiod_start || null,
        slut_planning_period: rentmanSubproject.planperiod_end || null,
        // Prisfelter - samme som webhook service
        rabat: sanitizeNumber(rentmanSubproject.discount_subproject),
        fixed_price: rentmanSubproject.fixed_price,
        rental_price: rentmanSubproject.project_rental_price,
        sale_price: rentmanSubproject.project_sale_price,
        crew_price: rentmanSubproject.project_crew_price,
        transport_price: rentmanSubproject.project_transport_price,
        // Rentman link
        rentman_projekt: rentman.buildProjectUrl ? rentman.buildProjectUrl(projectId, rentmanSubproject.id) : null
    };
}

/**
 * Opdaterer dashboard database med subproject data.
 * Samme logik som rentman-update-db.js webhook handler.
 */
async function updateDashboardSubproject(rentmanSubproject, projectId) {
    try {
        const projectData = await rentman.getProject(projectId);
        if (!projectData) {
            logger.warn('Kunne ikke hente project data til dashboard', { projectId });
            return;
        }

        await db.upsertDashboardSubproject(
            { data: rentmanSubproject },
            { data: projectData }
        );

        logger.debug('Opdaterede dashboard database', {
            subprojectId: rentmanSubproject.id,
            projectId
        });
    } catch (error) {
        logger.error('Fejl ved opdatering af dashboard database', {
            subprojectId: rentmanSubproject.id,
            projectId,
            error: error.message
        });
    }
}

async function updateParentDealStatus(hubspotDealId) {
    try {
        const orders = await db.findSyncedOrdersByDealId(hubspotDealId);

        if (!orders || orders.length === 0) {
            return;
        }

        const orderStatuses = [];
        for (const order of orders) {
            const orderData = await hubspot.getOrder(order.hubspot_order_id);
            if (orderData?.properties?.hs_pipeline_stage) {
                orderStatuses.push(orderData.properties.hs_pipeline_stage);
            }
        }

        const newDealStage = hubspot.calculateDealStageFromOrders(orderStatuses);

        if (newDealStage) {
            await hubspot.updateDeal(hubspotDealId, { dealstage: newDealStage });
            logger.debug('Updated deal stage based on orders', {
                dealId: hubspotDealId,
                newStage: newDealStage
            });
        }
    } catch (error) {
        logger.error('Failed to update parent deal status', {
            dealId: hubspotDealId,
            error: error.message
        });
    }
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

    logger.error('Order sync error', {
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

async function syncSingleOrder(rentmanId = null, hubspotId = null) {
    // Orders/subprojects kan kun synkroniseres fra Rentman til HubSpot
    const syncLogger = new SyncLogger('order', 'rentman_to_hubspot', 'manual');
    await syncLogger.start({ rentmanId, hubspotId, singleItem: true });
    syncLogger.stats.totalItems = 1;

    try {
        if (rentmanId) {
            const rentmanSubproject = await rentman.getSubproject(rentmanId);
            if (rentmanSubproject) {
                const existingSync = await db.findSyncedOrderByRentmanId(rentmanId);
                if (existingSync) {
                    await updateHubspotOrder(rentmanSubproject, existingSync, syncLogger);
                } else {
                    await createHubspotOrder(rentmanSubproject, syncLogger);
                }
            }
        } else if (hubspotId) {
            // Kan ikke synkronisere fra HubSpot til Rentman - tjek kun om den findes
            const existingSync = await db.findSyncedOrderByHubspotId(hubspotId);
            if (existingSync) {
                logger.info('HubSpot order er allerede synkroniseret', {
                    hubspotId,
                    rentmanId: existingSync.rentman_subproject_id
                });
            } else {
                logger.info('HubSpot order ikke fundet i Rentman - kan ikke oprettes via API', {
                    hubspotId
                });
                await syncLogger.logItem(
                    'order',
                    hubspotId,
                    null,
                    'skip',
                    'skipped',
                    { errorMessage: 'Rentman API understøtter ikke oprettelse af subprojects' }
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

async function syncOrderFinancials(rentmanSubprojectId) {
    const syncLogger = new SyncLogger('order', 'rentman_to_hubspot', 'financial_update');
    await syncLogger.start({ rentmanSubprojectId, financialUpdate: true });

    try {
        const existingSync = await db.findSyncedOrderByRentmanId(rentmanSubprojectId);
        if (!existingSync) {
            await syncLogger.logItem('order', null, String(rentmanSubprojectId), 'skip', 'skipped', {
                errorMessage: 'Order not synced'
            });
            await syncLogger.complete();
            return;
        }

        const rentmanSubproject = await rentman.getSubproject(rentmanSubprojectId);
        if (!rentmanSubproject) {
            await syncLogger.fail('Could not fetch Rentman subproject');
            return;
        }

        const totalPrice = sanitizeNumber(rentmanSubproject.project_total_price);

        await hubspot.updateOrder(existingSync.hubspot_order_id, {
            hs_total_price: totalPrice
        });

        // Opdater dashboard database
        const projectId = extractIdFromRef(rentmanSubproject.project);
        if (projectId) {
            await updateDashboardSubproject(rentmanSubproject, projectId);
        }

        await syncLogger.logItem(
            'order',
            existingSync.hubspot_order_id,
            String(rentmanSubprojectId),
            'update',
            'success',
            { dataAfter: { hs_total_price: totalPrice } }
        );

        await syncLogger.complete();

        logger.info('Synced order financials', {
            rentmanId: rentmanSubprojectId,
            hubspotId: existingSync.hubspot_order_id,
            amount: totalPrice
        });
    } catch (error) {
        await syncLogger.fail(error.message);
        throw error;
    }
}

module.exports = {
    syncOrders,
    syncSingleOrder,
    syncOrderFinancials
};

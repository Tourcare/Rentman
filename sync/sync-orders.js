const db = require('../lib/database');
const hubspot = require('../lib/hubspot-client');
const rentman = require('../lib/rentman-client');
const { createChildLogger } = require('../lib/logger');
const { SyncLogger } = require('./sync-logger');
const { sanitizeNumber, extractIdFromRef } = require('../lib/utils');

const logger = createChildLogger('sync-orders');

const RENTMAN_STATUS_TO_ORDER_STAGE = {
    'Optie': '0',
    'Bevestigd': '1',
    'Offerte': '2',
    'Geannuleerd': '3'
};

const ORDER_STAGE_TO_RENTMAN_STATUS = {
    '0': 'Optie',
    '1': 'Bevestigd',
    '2': 'Offerte',
    '3': 'Geannuleerd'
};

async function syncOrders(options = {}) {
    const {
        direction = 'bidirectional',
        batchSize = 50,
        triggeredBy = 'system'
    } = options;

    const syncLogger = new SyncLogger('order', direction, triggeredBy);
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
    logger.info('Starting Rentman to HubSpot order sync');

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
        const subprojects = await rentman.get(`/subprojects?limit=${batchSize}&offset=${offset}`);

        if (!subprojects?.data || subprojects.data.length === 0) {
            hasMore = false;
            break;
        }

        await syncLogger.updateProgress(syncLogger.getStats().processedItems, null);

        for (const rentmanSubproject of subprojects.data) {
            try {
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
        hasMore = subprojects.data.length === batchSize;
    }
}

async function syncHubspotToRentman(syncLogger, batchSize) {
    logger.info('Starting HubSpot to Rentman order sync');

    let after = undefined;
    let hasMore = true;

    while (hasMore) {
        const response = await hubspot.searchOrders({
            limit: batchSize,
            after,
            properties: [
                'hs_order_name', 'hs_total_price', 'hs_pipeline_stage',
                'hs_date', 'hs_end_date'
            ]
        });

        if (!response?.results || response.results.length === 0) {
            hasMore = false;
            break;
        }

        for (const hubspotOrder of response.results) {
            try {
                const existingSync = await db.findSyncedOrderByHubspotId(hubspotOrder.id);

                if (existingSync) {
                    await updateRentmanSubproject(hubspotOrder, existingSync, syncLogger);
                } else {
                    logger.debug('HubSpot order without Rentman link - skipping', {
                        hubspotId: hubspotOrder.id
                    });
                    await syncLogger.logItem(
                        'order',
                        hubspotOrder.id,
                        null,
                        'skip',
                        'skipped',
                        { errorMessage: 'No linked Rentman subproject' }
                    );
                }
            } catch (error) {
                await handleItemError(syncLogger, 'order', hubspotOrder.id, null, error, 'hubspot');
            }
        }

        after = response.paging?.next?.after;
        hasMore = !!after;
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

    const properties = mapRentmanToHubspotOrder(rentmanSubproject);

    const result = await hubspot.createOrder(properties);

    if (result?.id) {
        await db.addSyncedOrder(rentmanSubproject.id, result.id, dealSync.hubspot_project_id);

        await hubspot.associateOrderToDeal(result.id, dealSync.hubspot_project_id);

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
            dealId: dealSync.hubspot_project_id
        });

        await updateParentDealStatus(dealSync.hubspot_project_id);
    }
}

async function updateHubspotOrder(rentmanSubproject, existingSync, syncLogger) {
    const properties = mapRentmanToHubspotOrder(rentmanSubproject);

    await hubspot.updateOrder(existingSync.hubspot_order_id, properties);

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

    if (existingSync.hubspot_deal_id) {
        await updateParentDealStatus(existingSync.hubspot_deal_id);
    }
}

async function updateRentmanSubproject(hubspotOrder, existingSync, syncLogger) {
    const subprojectData = mapHubspotToRentmanSubproject(hubspotOrder);

    await rentman.put(`/subprojects/${existingSync.rentman_subproject_id}`, subprojectData);

    await syncLogger.logItem(
        'order',
        hubspotOrder.id,
        String(existingSync.rentman_subproject_id),
        'update',
        'success',
        { dataAfter: subprojectData }
    );

    logger.debug('Updated Rentman subproject from HubSpot', {
        hubspotId: hubspotOrder.id,
        rentmanId: existingSync.rentman_subproject_id
    });
}

function mapRentmanToHubspotOrder(rentmanSubproject) {
    const status = rentmanSubproject.status || 'Optie';
    const stageId = RENTMAN_STATUS_TO_ORDER_STAGE[status] || '0';

    return {
        hs_order_name: rentmanSubproject.displayname || rentmanSubproject.name || 'Unnamed Order',
        hs_total_price: sanitizeNumber(rentmanSubproject.project_total_price) || 0,
        hs_pipeline_stage: stageId,
        hs_date: rentmanSubproject.planperiod_start || null,
        hs_end_date: rentmanSubproject.planperiod_end || null
    };
}

function mapHubspotToRentmanSubproject(hubspotOrder) {
    const props = hubspotOrder.properties || {};
    const stageId = props.hs_pipeline_stage || '0';
    const status = ORDER_STAGE_TO_RENTMAN_STATUS[stageId] || 'Optie';

    return {
        displayname: props.hs_order_name || 'Unnamed Order',
        status: status,
        planperiod_start: props.hs_date || null,
        planperiod_end: props.hs_end_date || null
    };
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
    const syncLogger = new SyncLogger('order', 'bidirectional', 'manual');
    await syncLogger.start({ rentmanId, hubspotId, singleItem: true });
    syncLogger.stats.totalItems = 1;

    try {
        if (rentmanId) {
            const rentmanSubproject = await rentman.getSubproject(rentmanId);
            if (rentmanSubproject?.data) {
                const existingSync = await db.findSyncedOrderByRentmanId(rentmanId);
                if (existingSync) {
                    await updateHubspotOrder(rentmanSubproject.data, existingSync, syncLogger);
                } else {
                    await createHubspotOrder(rentmanSubproject.data, syncLogger);
                }
            }
        } else if (hubspotId) {
            const hubspotOrder = await hubspot.getOrder(hubspotId);
            if (hubspotOrder) {
                const existingSync = await db.findSyncedOrderByHubspotId(hubspotId);
                if (existingSync) {
                    await updateRentmanSubproject(hubspotOrder, existingSync, syncLogger);
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
        if (!rentmanSubproject?.data) {
            await syncLogger.fail('Could not fetch Rentman subproject');
            return;
        }

        const totalPrice = sanitizeNumber(rentmanSubproject.data.project_total_price);

        await hubspot.updateOrder(existingSync.hubspot_order_id, {
            hs_total_price: totalPrice
        });

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

const config = require('../../config');
const { createChildLogger } = require('../../lib/logger');
const db = require('../../lib/database');
const hubspot = require('../../lib/hubspot-client');
const rentman = require('../../lib/rentman-client');
const { sanitizeNumber, retry, extractIdFromRef } = require('../../lib/utils');

const logger = createChildLogger('rentman-order');

async function createOrders(webhook) {
    logger.info('createOrders funktion kaldet');

    for (const item of webhook.items) {
        try {
            const subProjectInfo = await rentman.get(item.ref);
            if (!subProjectInfo) {
                logger.warn('Kunne ikke hente subproject', { ref: item.ref });
                continue;
            }

            const projectInfo = await rentman.get(subProjectInfo.project);
            if (!projectInfo) {
                logger.warn('Kunne ikke hente project for subproject', { projectRef: subProjectInfo.project });
                continue;
            }

            const [companyInfo, contactInfo] = await Promise.all([
                rentman.get(projectInfo.customer),
                rentman.get(projectInfo.cust_contact)
            ]);

            let companyDb = null;
            let contactDb = null;

            if (companyInfo?.id) {
                companyDb = await db.findSyncedCompanyByRentmanId(companyInfo.id);
            }

            if (contactInfo?.id) {
                contactDb = await db.findSyncedContactByRentmanId(contactInfo.id);
            }

            const dealInfo = await retry(async () => {
                const existingOrder = await db.findSyncedOrderByRentmanId(subProjectInfo.id);
                if (existingOrder) {
                    logger.info('Order allerede oprettet - duplikat', { subprojectId: subProjectInfo.id });
                    return null;
                }
                return db.findSyncedDealByRentmanId(projectInfo.id);
            }, { maxAttempts: 6, delayMs: 5000 });

            if (!dealInfo) {
                logger.warn('Ingen deal fundet for project', { projectId: projectInfo.id });
                continue;
            }

            const orderId = await createHubSpotOrder(
                subProjectInfo,
                dealInfo.hubspot_project_id,
                companyDb?.hubspot_id,
                contactDb?.hubspot_id
            );

            await db.insertSyncedOrder(
                subProjectInfo.displayname,
                subProjectInfo.id,
                orderId,
                companyDb?.id || 0,
                contactDb?.id || 0,
                dealInfo.id
            );

            logger.syncOperation('create', 'order', {
                rentmanId: subProjectInfo.id,
                hubspotId: orderId
            }, true);
        } catch (error) {
            logger.error('Fejl ved oprettelse af order', {
                error: error.message,
                stack: error.stack,
                itemRef: item.ref
            });
        }
    }
}

async function updateOrders(webhook) {
    logger.info('updateOrders funktion kaldet');

    for (const item of webhook.items) {
        try {
            const subProjectInfo = await rentman.get(item.ref);
            if (!subProjectInfo) {
                logger.warn('Kunne ikke hente subproject', { ref: item.ref });
                continue;
            }

            const orderInfo = await retry(
                () => db.findSyncedOrderByRentmanId(subProjectInfo.id),
                { maxAttempts: 3, delayMs: 3000 }
            );

            if (!orderInfo) {
                logger.warn('Ingen order fundet', { subprojectName: subProjectInfo.displayname });
                continue;
            }

            await updateHubSpotOrder(subProjectInfo, orderInfo.hubspot_order_id);
            await db.updateSyncedOrderName(subProjectInfo.id, subProjectInfo.displayname);

            logger.syncOperation('update', 'order', {
                rentmanId: subProjectInfo.id,
                hubspotId: orderInfo.hubspot_order_id
            }, true);
        } catch (error) {
            logger.error('Fejl ved opdatering af order', {
                error: error.message,
                stack: error.stack,
                itemRef: item.ref
            });
        }
    }

    if (webhook.items.length > 0) {
        const hubspotDealId = await db.getHubspotDealIdForOrder(webhook.items[0].id);
        if (hubspotDealId) {
            await updateDealStatusAndFinancial(hubspotDealId);
        }
    }
}

async function deleteOrder(event) {
    logger.info('Starter sletning af orders', { count: event.items.length });

    for (const subId of event.items) {
        try {
            const syncedOrder = await db.findSyncedOrderByRentmanId(subId);

            if (syncedOrder?.hubspot_order_id) {
                await hubspot.deleteOrder(syncedOrder.hubspot_order_id);

                logger.syncOperation('delete', 'order', {
                    rentmanId: subId,
                    hubspotId: syncedOrder.hubspot_order_id,
                    name: syncedOrder.subproject_name
                }, true);
            }
        } catch (error) {
            logger.error('Fejl ved sletning af order', {
                error: error.message,
                subprojectId: subId
            });
        }
    }
}

async function createHubSpotOrder(subproject, dealId, companyId, contactId) {
    const status = await rentman.getStatus(subproject.status);
    const stageId = hubspot.getOrderStageFromRentmanStatus(status?.id);
    const projectId = extractIdFromRef(subproject.project);

    const properties = {
        hs_order_name: subproject.displayname,
        hs_total_price: sanitizeNumber(subproject.project_total_price),
        hs_pipeline: config.hubspot.pipelines.orders,
        hs_pipeline_stage: stageId,
        start_projekt_period: subproject.usageperiod_start,
        slut_projekt_period: subproject.usageperiod_end,
        slut_planning_period: subproject.planperiod_end,
        start_planning_period: subproject.planperiod_start,
        rabat: sanitizeNumber(subproject.discount_subproject),
        fixed_price: subproject.fixed_price,
        rental_price: subproject.project_rental_price,
        sale_price: subproject.project_sale_price,
        crew_price: subproject.project_crew_price,
        transport_price: subproject.project_transport_price,
        rentman_projekt: rentman.buildProjectUrl(projectId, subproject.id)
    };

    const orderId = await hubspot.createOrder(properties, dealId, companyId, contactId);

    if (dealId) {
        await updateDealStatusAfterOrderCreate(dealId);
    }

    return orderId;
}

async function updateHubSpotOrder(subproject, orderId) {
    const status = await rentman.getStatus(subproject.status);
    const stageId = hubspot.getOrderStageFromRentmanStatus(status?.id);
    const projectId = extractIdFromRef(subproject.project);

    const properties = {
        hs_order_name: subproject.displayname,
        hs_total_price: sanitizeNumber(subproject.project_total_price),
        hs_pipeline: config.hubspot.pipelines.orders,
        hs_pipeline_stage: stageId,
        start_projekt_period: subproject.usageperiod_start,
        slut_projekt_period: subproject.usageperiod_end,
        slut_planning_period: subproject.planperiod_end,
        start_planning_period: subproject.planperiod_start,
        rabat: sanitizeNumber(subproject.discount_subproject),
        fixed_price: subproject.fixed_price,
        rental_price: subproject.project_rental_price,
        sale_price: subproject.project_sale_price,
        crew_price: subproject.project_crew_price,
        transport_price: subproject.project_transport_price,
        rentman_projekt: rentman.buildProjectUrl(projectId, subproject.id)
    };

    await hubspot.updateOrder(orderId, properties);
}

async function updateDealStatusAfterOrderCreate(dealId) {
    const deal = await hubspot.getObject('deals', dealId, [], ['orders']);
    const orderAssociations = deal?.associations?.orders?.results;

    if (!orderAssociations || orderAssociations.length === 0) {
        return;
    }

    const orderStages = [];

    for (const orderAssoc of orderAssociations) {
        const order = await hubspot.getOrder(orderAssoc.id);
        if (order?.properties?.hs_pipeline_stage) {
            orderStages.push(order.properties.hs_pipeline_stage);
        }
    }

    const newStage = hubspot.calculateDealStageFromOrders(orderStages);

    if (newStage) {
        await hubspot.updateDeal(dealId, { dealstage: newStage });
    }
}

async function updateDealStatusAndFinancial(hubspotDealId) {
    logger.info('Opdaterer deal status og financials', { dealId: hubspotDealId });

    const deal = await hubspot.getObject('deals', hubspotDealId, [], ['orders']);
    const orderAssociations = deal?.associations?.orders?.results;

    if (!orderAssociations || orderAssociations.length === 0) {
        return;
    }

    const orderStages = [];

    for (const orderAssoc of orderAssociations) {
        const order = await hubspot.getOrder(orderAssoc.id);
        if (order?.properties?.hs_pipeline_stage) {
            orderStages.push(order.properties.hs_pipeline_stage);
        }
    }

    const newStage = hubspot.calculateDealStageFromOrders(orderStages);

    const dealDb = await db.findSyncedDealByHubspotId(hubspotDealId);
    if (!dealDb) return;

    const rentmanProject = await rentman.getProject(dealDb.rentman_project_id);
    const totalPrice = rentmanProject ? sanitizeNumber(rentmanProject.project_total_price) : 0;

    const properties = { amount: totalPrice };
    if (newStage) {
        properties.dealstage = newStage;
    }

    await hubspot.updateDeal(hubspotDealId, properties);
}

module.exports = {
    createOrders,
    updateOrders,
    deleteOrder
};

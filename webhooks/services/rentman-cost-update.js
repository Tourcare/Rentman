const { createChildLogger } = require('../../lib/logger');
const db = require('../../lib/database');
const hubspot = require('../../lib/hubspot-client');
const rentman = require('../../lib/rentman-client');
const { sanitizeNumber, extractIdFromRef } = require('../../lib/utils');

const logger = createChildLogger('rentman-cost');

async function handleEquipmentUpdate(event) {
    logger.info('handleEquipmentUpdate kaldet', { itemCount: event.items.length });

    for (const item of event.items) {
        try {
            if (!item.ref) {
                continue;
            }

            const rentmanData = await rentman.get(item.ref);
            if (!rentmanData) {
                logger.warn('Kunne ikke hente equipment data', { ref: item.ref });
                continue;
            }

            const subprojectId = extractIdFromRef(rentmanData.subproject);
            const projectId = extractIdFromRef(rentmanData.project);

            if (!projectId) {
                continue;
            }

            const [dealDb, orderDb] = await Promise.all([
                db.findSyncedDealByRentmanId(projectId),
                subprojectId ? db.findSyncedOrderByRentmanId(subprojectId) : null
            ]);

            const hubspotDealId = dealDb?.hubspot_project_id;
            const hubspotOrderId = orderDb?.hubspot_order_id;

            if (!hubspotDealId) {
                continue;
            }

            await updateDealFinancial(projectId, hubspotDealId);

            if (hubspotOrderId && subprojectId) {
                await updateOrderFinancial(subprojectId, hubspotOrderId);
            }

            logger.syncOperation('update', 'financials', {
                projectId,
                subprojectId,
                hubspotDealId,
                hubspotOrderId
            }, true);
        } catch (error) {
            logger.error('Fejl ved opdatering af financials', {
                error: error.message,
                stack: error.stack,
                itemRef: item.ref
            });
        }
    }
}

async function updateDealFinancial(rentmanProjectId, hubspotDealId) {
    const rentmanProject = await rentman.getProject(rentmanProjectId);
    if (!rentmanProject) {
        logger.warn('Kunne ikke hente projekt fra Rentman', { projectId: rentmanProjectId });
        return;
    }

    const totalPrice = sanitizeNumber(rentmanProject.project_total_price);

    await hubspot.updateDeal(hubspotDealId, { amount: totalPrice });

    logger.debug('Opdateret deal financials', {
        dealId: hubspotDealId,
        amount: totalPrice
    });
}

async function updateOrderFinancial(rentmanSubprojectId, hubspotOrderId) {
    const rentmanSubproject = await rentman.get(`/subprojects/${rentmanSubprojectId}`);
    if (!rentmanSubproject) {
        logger.warn('Kunne ikke hente subproject fra Rentman', { subprojectId: rentmanSubprojectId });
        return;
    }

    const totalPrice = sanitizeNumber(rentmanSubproject.project_total_price);

    await hubspot.updateOrder(hubspotOrderId, { hs_total_price: totalPrice });

    logger.debug('Opdateret order financials', {
        orderId: hubspotOrderId,
        totalPrice
    });
}

module.exports = {
    handleEquipmentUpdate
};

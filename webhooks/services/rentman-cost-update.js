const { createChildLogger } = require('../../lib/logger');
const db = require('../../lib/database');
const hubspot = require('../../lib/hubspot-client');
const rentman = require('../../lib/rentman-client');
const { sanitizeNumber, extractIdFromRef } = require('../../lib/utils');
const { ensureOrder } = require('./rentman-update-order');

const logger = createChildLogger('rentman-cost');

// Mapping fra itemType til Rentman API endpoint
const ITEM_TYPE_ENDPOINTS = {
    ProjectEquipment: 'projectequipment',
    ProjectEquipmentGroup: 'projectequipmentgroup',
    ProjectFunction: 'projectfunctions',
    ProjectFunctionGroup: 'projectfunctiongroups',
    ProjectCost: 'costs',
    ProjectCrew: 'projectcrew'
};

/**
 * Opdaterer HubSpot deal/order financials når equipment/cost/function/crew
 * ændres i Rentman. Data-persistering til rentman_data håndteres af
 * saveWebhookToDb (webhooks/services/rentman-save-all.js).
 */
async function handleEquipmentUpdate(event) {
    logger.info('handleEquipmentUpdate kaldet', { itemCount: event.items.length, eventType: event.eventType });

    // Delete events: vi har intet ref at slå op — lad rentman-save-all håndtere DB sletning
    // og spring financial refresh over (vi kan ikke slå projekt op fra et slettet item).
    if (event.eventType === 'delete') {
        return;
    }

    for (const item of event.items) {
        try {
            const ref = item.ref || (item.id ? `/${ITEM_TYPE_ENDPOINTS[event.itemType]}/${item.id}` : null);
            if (!ref) {
                continue;
            }

            const rentmanData = await rentman.get(ref);
            if (!rentmanData) {
                logger.warn('Kunne ikke hente data fra Rentman', { ref, itemType: event.itemType });
                continue;
            }

            const subprojectId = extractIdFromRef(rentmanData.subproject);
            const projectId = extractIdFromRef(rentmanData.project);

            if (!projectId) {
                continue;
            }

            const dealDb = await db.findSyncedDealByRentmanId(projectId);
            const hubspotDealId = dealDb?.hubspot_project_id;

            if (!hubspotDealId) {
                continue;
            }

            await updateDealFinancial(projectId, hubspotDealId);

            if (subprojectId) {
                const subprojectInfo = await rentman.get(`/subprojects/${subprojectId}`);
                if (subprojectInfo) {
                    const orderDb = await ensureOrder(subprojectInfo);
                    if (orderDb?.hubspot_order_id) {
                        await updateOrderFinancial(subprojectId, orderDb.hubspot_order_id);
                    }
                }
            }

            logger.syncOperation('update', 'financials', {
                projectId,
                subprojectId,
                hubspotDealId
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

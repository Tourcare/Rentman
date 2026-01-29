const { createChildLogger } = require('../../lib/logger');
const db = require('../../lib/database');
const hubspot = require('../../lib/hubspot-client');
const rentman = require('../../lib/rentman-client');
const { sanitizeNumber, extractIdFromRef } = require('../../lib/utils');

const logger = createChildLogger('rentman-cost');

async function handleEquipmentUpdate(event) {
    logger.info('handleEquipmentUpdate kaldet', { itemCount: event.items.length, eventType: event.eventType });

    // Håndter delete events separat
    if (event.eventType === 'delete') {
        await handleEquipmentDelete(event);
        return;
    }

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

            // Sync equipment data til database baseret på item type
            await syncEquipmentToDatabase(event.itemType, rentmanData);

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

/**
 * Håndterer delete events for equipment.
 * Ved delete events indeholder items kun ID'et, ikke ref.
 */
async function handleEquipmentDelete(event) {
    for (const itemId of event.items) {
        try {
            if (event.itemType === 'ProjectEquipment') {
                await db.deleteProjectEquipment(itemId);
                logger.debug('Slettede project_equipment fra database', { id: itemId });
            } else if (event.itemType === 'ProjectEquipmentGroup') {
                await db.deleteProjectEquipmentGroup(itemId);
                logger.debug('Slettede project_equipment_group fra database', { id: itemId });
            }
        } catch (error) {
            logger.error('Fejl ved sletning af equipment fra database', {
                error: error.message,
                itemType: event.itemType,
                id: itemId
            });
        }
    }
}

/**
 * Synkroniserer equipment eller equipment group data til databasen.
 * Henter også tilhørende equipment_group data hvis det er ProjectEquipment.
 */
async function syncEquipmentToDatabase(itemType, rentmanData) {
    try {
        if (itemType === 'ProjectEquipment') {
            // Upsert selve equipment
            await db.upsertProjectEquipment(rentmanData);
            logger.debug('Synkede project_equipment til database', { id: rentmanData.id });

            // Hent og upsert tilhørende equipment_group hvis den findes
            if (rentmanData.equipment_group) {
                const groupData = await rentman.get(rentmanData.equipment_group);
                if (groupData) {
                    await db.upsertProjectEquipmentGroup(groupData);
                    logger.debug('Synkede project_equipment_group til database', { id: groupData.id });
                }
            }
        } else if (itemType === 'ProjectEquipmentGroup') {
            // Upsert selve equipment group
            await db.upsertProjectEquipmentGroup(rentmanData);
            logger.debug('Synkede project_equipment_group til database', { id: rentmanData.id });
        }
    } catch (error) {
        logger.error('Fejl ved sync af equipment til database', {
            error: error.message,
            itemType,
            id: rentmanData.id
        });
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

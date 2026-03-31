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

async function handleEquipmentUpdate(event) {
    logger.info('handleEquipmentUpdate kaldet', { itemCount: event.items.length, eventType: event.eventType });

    // Håndter delete events separat
    if (event.eventType === 'delete') {
        await handleEquipmentDelete(event);
        return;
    }

    for (const item of event.items) {
        try {
            // Resolve ref: brug item.ref hvis tilgængelig, ellers konstruer fra item.id
            const ref = item.ref || (item.id ? `/${ITEM_TYPE_ENDPOINTS[event.itemType]}/${item.id}` : null);
            if (!ref) {
                continue;
            }

            const rentmanData = await rentman.get(ref);
            if (!rentmanData) {
                logger.warn('Kunne ikke hente data fra Rentman', { ref, itemType: event.itemType });
                continue;
            }

            // Sync equipment data til database baseret på item type
            await syncEquipmentToDatabase(event.itemType, rentmanData);

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

/**
 * Håndterer delete events for equipment.
 * Ved delete events indeholder items kun ID'et, ikke ref.
 */
async function handleEquipmentDelete(event) {
    for (const itemId of event.items) {
        try {
            switch (event.itemType) {
                case 'ProjectEquipment':
                    await db.deleteProjectEquipment(itemId);
                    break;
                case 'ProjectEquipmentGroup':
                    await db.deleteProjectEquipmentGroup(itemId);
                    break;
                case 'ProjectFunction':
                    await db.deleteProjectFunction(itemId);
                    break;
                case 'ProjectFunctionGroup':
                    await db.deleteProjectFunctionGroup(itemId);
                    break;
                case 'ProjectCost':
                    await db.deleteProjectCost(itemId);
                    break;
                case 'ProjectCrew':
                    await db.deleteProjectCrew(itemId);
                    break;
                default:
                    logger.debug('Ingen delete handler for itemType', { itemType: event.itemType });
                    return;
            }
            logger.debug(`Slettede ${event.itemType} fra database`, { id: itemId });
        } catch (error) {
            logger.error('Fejl ved sletning fra database', {
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
        switch (itemType) {
            case 'ProjectEquipment':
                await db.upsertProjectEquipment(rentmanData);
                logger.debug('Synkede project_equipment til database', { id: rentmanData.id });
                // Hent og upsert tilhørende equipment_group hvis den findes
                if (rentmanData.equipment_group) {
                    const eqGroupData = await rentman.get(rentmanData.equipment_group);
                    if (eqGroupData) {
                        await db.upsertProjectEquipmentGroup(eqGroupData);
                        logger.debug('Synkede project_equipment_group til database', { id: eqGroupData.id });
                    }
                }
                break;

            case 'ProjectEquipmentGroup':
                await db.upsertProjectEquipmentGroup(rentmanData);
                logger.debug('Synkede project_equipment_group til database', { id: rentmanData.id });
                break;

            case 'ProjectFunction':
                await db.upsertProjectFunction(rentmanData);
                logger.debug('Synkede project_function til database', { id: rentmanData.id });
                // Hent og upsert tilhørende function_group hvis den findes
                if (rentmanData.group) {
                    const fnGroupData = await rentman.get(rentmanData.group);
                    if (fnGroupData) {
                        await db.upsertProjectFunctionGroup(fnGroupData);
                        logger.debug('Synkede project_function_group til database', { id: fnGroupData.id });
                    }
                }
                break;

            case 'ProjectFunctionGroup':
                await db.upsertProjectFunctionGroup(rentmanData);
                logger.debug('Synkede project_function_group til database', { id: rentmanData.id });
                break;

            case 'ProjectCost':
                await db.upsertProjectCost(rentmanData);
                logger.debug('Synkede project_cost til database', { id: rentmanData.id });
                break;

            case 'ProjectCrew':
                await db.upsertProjectCrew(rentmanData);
                logger.debug('Synkede project_crew til database', { id: rentmanData.id });
                break;

            default:
                logger.debug('Ingen sync handler for itemType', { itemType });
        }
    } catch (error) {
        logger.error('Fejl ved sync til database', {
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

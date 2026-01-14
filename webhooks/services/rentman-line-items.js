const config = require('../../config');
const { createChildLogger } = require('../../lib/logger');
const db = require('../../lib/database');
const hubspot = require('../../lib/hubspot-client');
const rentman = require('../../lib/rentman-client');
const { sanitizeNumber } = require('../../lib/utils');

const logger = createChildLogger('rentman-line-items');

function isEnabled() {
    return config.features.lineItems.enabled;
}

function isWebhookSyncEnabled() {
    return config.features.lineItems.enabled && config.features.lineItems.syncOnWebhook;
}

async function syncProjectLineItems(rentmanProjectId, options = {}) {
    if (!isEnabled()) {
        logger.debug('Line items feature er deaktiveret');
        return { success: false, reason: 'feature_disabled' };
    }

    const {
        includeEquipment = config.features.lineItems.includeEquipment,
        includeCosts = config.features.lineItems.includeCosts,
        includeCrew = config.features.lineItems.includeCrew,
        includeTransport = config.features.lineItems.includeTransport,
        deleteExisting = config.features.lineItems.deleteExisting
    } = options;

    try {
        const dealSync = await db.findSyncedDealByRentmanId(rentmanProjectId);

        if (!dealSync) {
            logger.warn('Ingen synkroniseret deal fundet for projekt', { rentmanProjectId });
            return { success: false, reason: 'deal_not_synced' };
        }

        const hubspotDealId = dealSync.hubspot_project_id;

        logger.info('Starter line items sync', {
            rentmanProjectId,
            hubspotDealId,
            options: { includeEquipment, includeCosts, includeCrew, includeTransport }
        });

        const financials = await rentman.getProjectFinancials(rentmanProjectId, {
            includeEquipment,
            includeCosts,
            includeCrew,
            includeTransport
        });

        const lineItems = transformFinancialsToLineItems(financials, {
            includeEquipment,
            includeCosts,
            includeCrew,
            includeTransport
        });

        if (lineItems.length === 0) {
            logger.info('Ingen line items at synkronisere', { rentmanProjectId });
            return { success: true, created: 0, reason: 'no_items' };
        }

        const result = await hubspot.syncDealLineItems(hubspotDealId, lineItems, deleteExisting);

        logger.info('Line items sync afsluttet', {
            rentmanProjectId,
            hubspotDealId,
            created: result.created,
            errors: result.errors
        });

        return result;
    } catch (error) {
        logger.error('Fejl ved sync af line items', {
            rentmanProjectId,
            error: error.message,
            stack: error.stack
        });
        return { success: false, error: error.message };
    }
}

function transformFinancialsToLineItems(financials, options) {
    const lineItems = [];

    if (options.includeEquipment && financials.equipment) {
        for (const item of financials.equipment) {
            const lineItem = transformEquipmentToLineItem(item);
            if (lineItem) {
                lineItems.push(lineItem);
            }
        }
    }

    if (options.includeCosts && financials.costs) {
        for (const cost of financials.costs) {
            const lineItem = transformCostToLineItem(cost);
            if (lineItem) {
                lineItems.push(lineItem);
            }
        }
    }

    if (options.includeCrew && financials.functions) {
        for (const func of financials.functions) {
            const lineItem = transformFunctionToLineItem(func);
            if (lineItem) {
                lineItems.push(lineItem);
            }
        }
    }

    if (options.includeTransport && financials.vehicles) {
        for (const vehicle of financials.vehicles) {
            const lineItem = transformVehicleToLineItem(vehicle);
            if (lineItem) {
                lineItems.push(lineItem);
            }
        }
    }

    return lineItems;
}

function transformEquipmentToLineItem(equipment) {
    const quantity = sanitizeNumber(equipment.quantity || equipment.quantity_total || 1, 0);
    const unitPrice = sanitizeNumber(equipment.unit_price || equipment.price || 0);
    const discount = sanitizeNumber(equipment.discount || 0);

    if (quantity === 0 || unitPrice === 0) {
        return null;
    }

    return {
        name: equipment.displayname || equipment.name || 'Udstyr',
        quantity: String(quantity),
        price: String(unitPrice),
        discount: discount > 0 ? String(discount) : undefined,
        hs_sku: equipment.code || undefined,
        description: buildEquipmentDescription(equipment)
    };
}

function buildEquipmentDescription(equipment) {
    const parts = [];

    if (equipment.code) {
        parts.push(`Kode: ${equipment.code}`);
    }

    if (equipment.quantity_total && equipment.quantity_total !== equipment.quantity) {
        parts.push(`Antal total: ${equipment.quantity_total}`);
    }

    if (equipment.rental_period_days) {
        parts.push(`Lejeperiode: ${equipment.rental_period_days} dage`);
    }

    return parts.length > 0 ? parts.join(' | ') : undefined;
}

function transformCostToLineItem(cost) {
    const quantity = sanitizeNumber(cost.quantity || 1, 0);
    const unitPrice = sanitizeNumber(cost.unit_price || cost.price || cost.total || 0);
    const discount = sanitizeNumber(cost.discount || 0);

    if (unitPrice === 0) {
        return null;
    }

    return {
        name: cost.displayname || cost.name || 'Omkostning',
        quantity: String(quantity),
        price: String(unitPrice),
        discount: discount > 0 ? String(discount) : undefined,
        description: cost.remark || undefined
    };
}

function transformFunctionToLineItem(func) {
    const quantity = sanitizeNumber(func.quantity || func.amount || 1, 0);
    const unitPrice = sanitizeNumber(func.unit_price || func.price || 0);
    const hours = sanitizeNumber(func.planninghours || func.hours || 0, 1);

    if (unitPrice === 0 && hours === 0) {
        return null;
    }

    const effectivePrice = unitPrice > 0 ? unitPrice : (hours * sanitizeNumber(func.hourly_rate || 0));

    if (effectivePrice === 0) {
        return null;
    }

    return {
        name: func.displayname || func.name || 'Personale',
        quantity: String(quantity),
        price: String(effectivePrice),
        description: buildFunctionDescription(func)
    };
}

function buildFunctionDescription(func) {
    const parts = [];

    if (func.planninghours || func.hours) {
        parts.push(`Timer: ${func.planninghours || func.hours}`);
    }

    if (func.hourly_rate) {
        parts.push(`Timepris: ${func.hourly_rate}`);
    }

    if (func.function_type) {
        parts.push(`Type: ${func.function_type}`);
    }

    return parts.length > 0 ? parts.join(' | ') : undefined;
}

function transformVehicleToLineItem(vehicle) {
    const quantity = sanitizeNumber(vehicle.quantity || 1, 0);
    const unitPrice = sanitizeNumber(vehicle.unit_price || vehicle.price || vehicle.total || 0);

    if (unitPrice === 0) {
        return null;
    }

    return {
        name: vehicle.displayname || vehicle.name || 'Transport',
        quantity: String(quantity),
        price: String(unitPrice),
        description: buildVehicleDescription(vehicle)
    };
}

function buildVehicleDescription(vehicle) {
    const parts = [];

    if (vehicle.license_plate) {
        parts.push(`Nummerplade: ${vehicle.license_plate}`);
    }

    if (vehicle.distance_km) {
        parts.push(`Afstand: ${vehicle.distance_km} km`);
    }

    return parts.length > 0 ? parts.join(' | ') : undefined;
}

async function handleEquipmentWebhook(event) {
    if (!isWebhookSyncEnabled()) {
        return;
    }

    try {
        for (const item of event.items) {
            if (!item.ref) continue;

            const equipmentData = await rentman.get(item.ref);
            if (!equipmentData?.project) continue;

            const projectId = rentman.extractIdFromRef(equipmentData.project);
            if (!projectId) continue;

            await syncProjectLineItems(projectId);
        }
    } catch (error) {
        logger.error('Fejl ved equipment webhook line items sync', {
            error: error.message,
            eventType: event.eventType
        });
    }
}

async function handleCostWebhook(event) {
    if (!isWebhookSyncEnabled()) {
        return;
    }

    try {
        for (const item of event.items) {
            if (!item.ref) continue;

            const costData = await rentman.get(item.ref);
            if (!costData?.project) continue;

            const projectId = rentman.extractIdFromRef(costData.project);
            if (!projectId) continue;

            await syncProjectLineItems(projectId);
        }
    } catch (error) {
        logger.error('Fejl ved cost webhook line items sync', {
            error: error.message,
            eventType: event.eventType
        });
    }
}

async function testSyncForProject(rentmanProjectId) {
    logger.info('Test sync startet', { rentmanProjectId });

    const result = await syncProjectLineItems(rentmanProjectId, {
        deleteExisting: true
    });

    logger.info('Test sync afsluttet', {
        rentmanProjectId,
        result
    });

    return result;
}

async function previewLineItems(rentmanProjectId) {
    if (!isEnabled()) {
        return { success: false, reason: 'feature_disabled' };
    }

    try {
        const financials = await rentman.getProjectFinancials(rentmanProjectId, {
            includeEquipment: config.features.lineItems.includeEquipment,
            includeCosts: config.features.lineItems.includeCosts,
            includeCrew: config.features.lineItems.includeCrew,
            includeTransport: config.features.lineItems.includeTransport
        });

        const lineItems = transformFinancialsToLineItems(financials, {
            includeEquipment: config.features.lineItems.includeEquipment,
            includeCosts: config.features.lineItems.includeCosts,
            includeCrew: config.features.lineItems.includeCrew,
            includeTransport: config.features.lineItems.includeTransport
        });

        return {
            success: true,
            rentmanProjectId,
            rawFinancials: financials,
            lineItems,
            summary: {
                equipmentCount: financials.equipment?.length || 0,
                costsCount: financials.costs?.length || 0,
                functionsCount: financials.functions?.length || 0,
                vehiclesCount: financials.vehicles?.length || 0,
                totalLineItems: lineItems.length
            }
        };
    } catch (error) {
        logger.error('Fejl ved preview', {
            rentmanProjectId,
            error: error.message
        });
        return { success: false, error: error.message };
    }
}

module.exports = {
    isEnabled,
    isWebhookSyncEnabled,
    syncProjectLineItems,
    handleEquipmentWebhook,
    handleCostWebhook,
    testSyncForProject,
    previewLineItems,
    transformFinancialsToLineItems
};

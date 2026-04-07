/**
 * Rentman Database Sync
 *
 * Synkroniserer alle Rentman data til den dedikerede Rentman database.
 * Henter collections fra API for at få IDs, derefter henter hvert item
 * individuelt by ID for at få fuld data inkl. GENERATED felter.
 *
 * Brug:
 *   syncAll()           - Synker alle item types
 *   syncItemType(type)  - Synker én specifik item type
 *   syncItemById(type, id) - Synker ét specifikt item by ID
 *
 * Rate limiting: Venter 100ms mellem individuelle API kald for at holde
 * sig inden for Rentmans 10 req/s limit.
 */

const { createChildLogger } = require('../lib/logger');
const rentman = require('../lib/rentman-client');
const rentmanDb = require('../lib/rentman-db');

const logger = createChildLogger('sync-rentman-db');

const RATE_LIMIT_DELAY = 100; // ms mellem API kald

/**
 * Item types med top-level collection endpoints.
 * Project-child typer (ProjectEquipment, ProjectCrew osv.) synkes via deres
 * parent projekter.
 */
const TOP_LEVEL_TYPES = [
    'Project', 'Subproject', 'Contact', 'ContactPerson', 'Equipment', 'Crew',
    'Appointment', 'Accessory', 'StockLocation', 'CrewAvailability',
    'InvoiceLine', 'Contract', 'SerialNumber', 'Factuur', 'File', 'Folder',
    'TimeRegistrationActivity', 'Ledger', 'Subrental', 'SubrentalEquipmentGroup',
    'SubrentalEquipment', 'Quotation', 'ProjectRequest', 'ProjectRequestEquipment',
    'CrewRate', 'CrewRateFactor', 'Repair', 'EquipmentSetContent', 'Status',
    'TaxClass', 'ProjectType', 'TimeRegistration', 'Vehicle', 'StockMovement'
];

/**
 * Item types der hentes via projects (har ingen top-level collection).
 * Key = itemType, value = sub-endpoint under /projects/{id}/
 */
const PROJECT_CHILD_TYPES = {
    ProjectEquipment: 'projectequipment',
    ProjectEquipmentGroup: 'projectequipmentgroup',
    ProjectFunction: 'projectfunctions',
    ProjectFunctionGroup: 'projectfunctiongroups',
    ProjectCost: 'projectcosts',
    ProjectCrew: 'projectcrew',
    ProjectVehicle: 'projectvehicles'
};

// =============================================================================
// Hjælpefunktioner
// =============================================================================

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Henter en pagineret collection fra Rentman API.
 * Henter KUN id feltet for at undgå 6MB response limit.
 * Fuld data hentes efterfølgende by ID for hvert item.
 */
async function fetchCollection(endpoint, limit = 300) {
    const allItems = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
        const result = await rentman.request('GET', `${endpoint}?fields=id&limit=${limit}&offset=${offset}`);

        if (!result.success || !result.data) {
            break;
        }

        const items = Array.isArray(result.data) ? result.data : [];
        allItems.push(...items);

        if (items.length < limit) {
            hasMore = false;
        } else {
            offset += limit;
        }

        await delay(RATE_LIMIT_DELAY);
    }

    return allItems;
}

/**
 * Henter et enkelt item by ID og upsert'er til DB.
 */
async function fetchAndUpsertById(itemType, itemId) {
    const config = rentmanDb.getItemTypeConfig(itemType);
    if (!config) return false;

    const data = await rentman.get(`${config.endpoint}/${itemId}`);
    if (!data) return false;

    await rentmanDb.upsertItem(itemType, data);
    return true;
}

// =============================================================================
// Sync funktioner
// =============================================================================

/**
 * Synker én item type der har top-level collection endpoint.
 * 1. Henter collection for at få alle IDs
 * 2. For hvert ID: henter individuelt by ID for fuld data
 * 3. Upsert til DB
 */
async function syncItemType(itemType) {
    const config = rentmanDb.getItemTypeConfig(itemType);
    if (!config) {
        logger.warn('Ukendt itemType', { itemType });
        return { synced: 0, errors: 0 };
    }

    logger.info(`Starter sync af ${itemType}...`);
    const start = Date.now();

    // Hent collection for at få IDs
    const collection = await fetchCollection(config.endpoint);
    logger.info(`Fundet ${collection.length} ${itemType} items i collection`);

    let synced = 0;
    let errors = 0;
    const total = collection.length;

    for (let i = 0; i < total; i++) {
        const item = collection[i];
        try {
            const data = await rentman.get(`${config.endpoint}/${item.id}`);
            if (data) {
                await rentmanDb.upsertItem(itemType, data);
                synced++;
            } else {
                errors++;
                logger.warn(`Kunne ikke hente ${itemType} by ID`, { id: item.id });
            }
        } catch (error) {
            errors++;
            logger.error(`Fejl ved sync af ${itemType}`, { id: item.id, error: error.message });
        }

        // Progress logging for hver 25. item eller ved sidste item
        if ((i + 1) % 25 === 0 || i + 1 === total) {
            const pct = Math.round(((i + 1) / total) * 100);
            logger.info(`[${itemType}] ${i + 1}/${total} (${pct}%) - ${synced} OK, ${errors} fejl`);
        }

        await delay(RATE_LIMIT_DELAY);
    }

    const duration = Date.now() - start;
    logger.info(`Sync af ${itemType} færdig`, { synced, errors, total, duration: `${Math.round(duration / 1000)}s` });

    return { synced, errors };
}

/**
 * Synker project-child item types via alle projekter.
 * 1. Henter alle projekt IDs
 * 2. For hvert projekt: henter child collection
 * 3. For hvert child item: henter by ID og upsert
 */
async function syncProjectChildTypes() {
    logger.info('Starter sync af project-child types...');

    // Hent alle projekt IDs
    const projects = await fetchCollection('/projects');
    logger.info(`Fundet ${projects.length} projekter, synker child types...`);

    const stats = {};
    for (const type of Object.keys(PROJECT_CHILD_TYPES)) {
        stats[type] = { synced: 0, errors: 0 };
    }

    const totalProjects = projects.length;
    for (let pi = 0; pi < totalProjects; pi++) {
        const project = projects[pi];
        logger.info(`[Project-children] Projekt ${pi + 1}/${totalProjects} (id=${project.id})`);

        for (const [itemType, subEndpoint] of Object.entries(PROJECT_CHILD_TYPES)) {
            try {
                const config = rentmanDb.getItemTypeConfig(itemType);
                if (!config) continue;

                // Hent child collection under projektet (kun IDs)
                const result = await rentman.request('GET', `/projects/${project.id}/${subEndpoint}?fields=id`);
                await delay(RATE_LIMIT_DELAY);

                if (!result.success || !result.data) continue;

                const items = Array.isArray(result.data) ? result.data : [];
                if (items.length === 0) continue;

                for (const item of items) {
                    try {
                        const data = await rentman.get(`${config.endpoint}/${item.id}`);
                        if (data) {
                            await rentmanDb.upsertItem(itemType, data);
                            stats[itemType].synced++;
                        }
                    } catch (error) {
                        stats[itemType].errors++;
                        logger.error(`Fejl ved sync af ${itemType}`, { id: item.id, projectId: project.id, error: error.message });
                    }
                    await delay(RATE_LIMIT_DELAY);
                }

                logger.debug(`[Project-children] Projekt ${project.id}: ${items.length} ${itemType} synket`);
            } catch (error) {
                logger.error(`Fejl ved hentning af ${itemType} for projekt`, { projectId: project.id, error: error.message });
            }
        }
    }

    for (const [type, s] of Object.entries(stats)) {
        logger.info(`Sync af ${type} færdig`, s);
    }

    return stats;
}

/**
 * Synker ét specifikt item by ID.
 * Bruges til on-demand sync af enkeltstående items.
 */
async function syncItemById(itemType, itemId) {
    logger.info(`Synker ${itemType} id=${itemId}...`);

    try {
        const success = await fetchAndUpsertById(itemType, itemId);
        if (success) {
            logger.info(`Synket ${itemType} id=${itemId}`);
        } else {
            logger.warn(`Kunne ikke synke ${itemType} id=${itemId}`);
        }
        return success;
    } catch (error) {
        logger.error(`Fejl ved sync af ${itemType} id=${itemId}`, { error: error.message });
        return false;
    }
}

/**
 * Kører en fuld sync af alle item types til Rentman DB.
 * Synker top-level types først, derefter project-child types.
 */
async function syncAll() {
    logger.info('Starter fuld Rentman DB sync...');
    const start = Date.now();

    const results = {};
    const allTypes = [...TOP_LEVEL_TYPES, ...Object.keys(PROJECT_CHILD_TYPES)];
    const totalTypes = allTypes.length;
    let completedTypes = 0;

    // Sync top-level types
    for (const itemType of TOP_LEVEL_TYPES) {
        completedTypes++;
        logger.info(`=== [OVERALL ${completedTypes}/${totalTypes}] Starter ${itemType} ===`);
        try {
            results[itemType] = await syncItemType(itemType);
        } catch (error) {
            logger.error(`Fejl ved sync af ${itemType}`, { error: error.message });
            results[itemType] = { synced: 0, errors: 1 };
        }
    }

    // Sync project-child types
    logger.info(`=== [OVERALL ${completedTypes}/${totalTypes}] Starter project-child types (${Object.keys(PROJECT_CHILD_TYPES).length} typer) ===`);
    try {
        const childResults = await syncProjectChildTypes();
        Object.assign(results, childResults);
    } catch (error) {
        logger.error('Fejl ved sync af project-child types', { error: error.message });
    }
    completedTypes = totalTypes;

    const duration = Date.now() - start;
    const totalSynced = Object.values(results).reduce((sum, r) => sum + (r.synced || 0), 0);
    const totalErrors = Object.values(results).reduce((sum, r) => sum + (r.errors || 0), 0);

    logger.info('Fuld Rentman DB sync færdig', {
        totalSynced,
        totalErrors,
        duration: `${Math.round(duration / 1000)}s`,
        results
    });

    return { totalSynced, totalErrors, duration, results };
}

module.exports = {
    syncAll,
    syncItemType,
    syncItemById,
    syncProjectChildTypes,
    TOP_LEVEL_TYPES,
    PROJECT_CHILD_TYPES
};

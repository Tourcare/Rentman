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
const BATCH_SIZE = 8; // Parallelle API kald per batch (under 10 req/s limit)

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
    ProjectCost: 'costs',
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

/**
 * Henter en batch af items parallelt fra API.
 * Returnerer kun items med data (filtrerer tomme/fejl fra).
 */
async function fetchBatch(endpoint, ids) {
    const results = await Promise.all(
        ids.map(id => rentman.get(`${endpoint}/${id}`).catch(() => null))
    );
    return results.filter(data => data !== null && data !== undefined);
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

    for (let i = 0; i < total; i += BATCH_SIZE) {
        const batchIds = collection.slice(i, i + BATCH_SIZE).map(item => item.id);

        try {
            const items = await fetchBatch(config.endpoint, batchIds);
            errors += batchIds.length - items.length;

            if (items.length > 0) {
                await rentmanDb.upsertBatch(itemType, items);
                synced += items.length;
            }
        } catch (error) {
            errors += batchIds.length;
            logger.error(`Fejl ved batch sync af ${itemType}`, { ids: batchIds, error: error.message });
        }

        // Progress logging
        const done = Math.min(i + BATCH_SIZE, total);
        if (done % 50 < BATCH_SIZE || done === total) {
            const pct = Math.round((done / total) * 100);
            logger.info(`[${itemType}] ${done}/${total} (${pct}%) - ${synced} OK, ${errors} fejl`);
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
async function syncProjectChildTypes({ fromProject } = {}) {
    logger.info('Starter sync af project-child types...');

    // Hent alle projekt IDs
    const projects = await fetchCollection('/projects');
    logger.info(`Fundet ${projects.length} projekter, synker child types...`);

    const stats = {};
    for (const type of Object.keys(PROJECT_CHILD_TYPES)) {
        stats[type] = { synced: 0, errors: 0 };
    }

    // Find start-index hvis --from-project er angivet
    let startIndex = 0;
    if (fromProject) {
        const idx = projects.findIndex(p => p.id >= fromProject);
        if (idx >= 0) {
            startIndex = idx;
            logger.info(`Springer de første ${startIndex} projekter over, starter fra id=${projects[startIndex].id}`);
        }
    }

    const totalProjects = projects.length;
    for (let pi = startIndex; pi < totalProjects; pi++) {
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

                // Batch fetch + batch upsert
                for (let bi = 0; bi < items.length; bi += BATCH_SIZE) {
                    const batchIds = items.slice(bi, bi + BATCH_SIZE).map(item => item.id);
                    try {
                        const fetched = await fetchBatch(config.endpoint, batchIds);
                        stats[itemType].errors += batchIds.length - fetched.length;

                        if (fetched.length > 0) {
                            await rentmanDb.upsertBatch(itemType, fetched);
                            stats[itemType].synced += fetched.length;
                        }
                    } catch (error) {
                        stats[itemType].errors += batchIds.length;
                        logger.error(`Fejl ved batch sync af ${itemType}`, { projectId: project.id, error: error.message });
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
async function syncAll({ from, fromProject } = {}) {
    logger.info('Starter fuld Rentman DB sync...');
    const start = Date.now();

    const results = {};
    const allTypes = [...TOP_LEVEL_TYPES, ...Object.keys(PROJECT_CHILD_TYPES)];
    const totalTypes = allTypes.length;
    let completedTypes = 0;

    // Bestem om top-level types skal springes over
    const skipTopLevel = from && from.toLowerCase() === 'children';
    let startFromType = (!skipTopLevel && from) ? from : null;
    let skipping = !!startFromType;

    // Sync top-level types
    if (!skipTopLevel) {
        for (const itemType of TOP_LEVEL_TYPES) {
            if (skipping) {
                if (itemType === startFromType) {
                    skipping = false;
                } else {
                    completedTypes++;
                    logger.info(`=== [SKIP] ${itemType} (springer over) ===`);
                    continue;
                }
            }
            completedTypes++;
            logger.info(`=== [OVERALL ${completedTypes}/${totalTypes}] Starter ${itemType} ===`);
            try {
                results[itemType] = await syncItemType(itemType);
            } catch (error) {
                logger.error(`Fejl ved sync af ${itemType}`, { error: error.message });
                results[itemType] = { synced: 0, errors: 1 };
            }
        }
    } else {
        completedTypes = TOP_LEVEL_TYPES.length;
        logger.info(`=== Springer ${completedTypes} top-level types over ===`);
    }

    // Sync project-child types
    logger.info(`=== [OVERALL ${completedTypes}/${totalTypes}] Starter project-child types (${Object.keys(PROJECT_CHILD_TYPES).length} typer) ===`);
    try {
        const childResults = await syncProjectChildTypes({ fromProject });
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

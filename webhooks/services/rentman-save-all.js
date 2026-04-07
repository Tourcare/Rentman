/**
 * Rentman Save All - Webhook Handler
 *
 * Gemmer ALLE Rentman webhook payloads i den dedikerede Rentman database.
 * Henter fuld data fra Rentman API by ID for hvert item, og upsert'er til DB.
 *
 * Kører PARALLELT med eksisterende HubSpot handlers - erstatter dem ikke.
 * Håndterer create, update og delete events for alle 42 item types.
 */

const { createChildLogger } = require('../../lib/logger');
const rentman = require('../../lib/rentman-client');
const rentmanDb = require('../../lib/rentman-db');

const logger = createChildLogger('rentman-save-all');

/**
 * Håndterer et Rentman webhook event og gemmer data til Rentman DB.
 * - create/update: Henter fuld item data fra API by ID, upsert til DB
 * - delete: Sletter fra DB
 */
async function saveWebhookToDb(event) {
    const { eventType, itemType, items } = event;

    if (!items || items.length === 0) {
        return;
    }

    const config = rentmanDb.getItemTypeConfig(itemType);
    if (!config) {
        logger.debug('Ingen DB config for itemType, springer over', { itemType });
        return;
    }

    if (eventType === 'delete') {
        await handleDelete(itemType, items);
        return;
    }

    // create eller update: hent fuld data fra API og gem
    for (const item of items) {
        try {
            const itemId = item.id || (item.ref ? item.ref.split('/').pop() : null);
            if (!itemId) {
                logger.warn('Kunne ikke finde item ID', { itemType, item });
                continue;
            }

            // Hent fuld item data fra Rentman API by ID
            const endpoint = `${config.endpoint}/${itemId}`;
            const data = await rentman.get(endpoint);

            if (!data) {
                logger.warn('Kunne ikke hente data fra Rentman API', { itemType, itemId, endpoint });
                continue;
            }

            await rentmanDb.upsertItem(itemType, data);

            logger.debug(`Gemt ${itemType} til Rentman DB`, { itemId, eventType });
        } catch (error) {
            logger.error(`Fejl ved gemning af ${itemType} til DB`, {
                error: error.message,
                itemId: item.id,
                eventType
            });
        }
    }
}

/**
 * Håndterer delete events. Ved delete indeholder items kun IDs (integers).
 */
async function handleDelete(itemType, items) {
    for (const item of items) {
        try {
            // Delete items er bare integers (IDs)
            const itemId = typeof item === 'object' ? item.id : item;
            if (itemId == null) continue;

            await rentmanDb.deleteItem(itemType, itemId);
            logger.debug(`Slettet ${itemType} fra Rentman DB`, { itemId });
        } catch (error) {
            logger.error(`Fejl ved sletning af ${itemType} fra DB`, {
                error: error.message,
                item
            });
        }
    }
}

module.exports = {
    saveWebhookToDb
};

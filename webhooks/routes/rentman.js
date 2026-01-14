/**
 * Rentman Webhook Route
 *
 * Modtager webhook events fra Rentman når der sker ændringer i projekter,
 * kontakter, udstyr, omkostninger m.v. Events logges til database.
 *
 * Håndterede item typer:
 * - Project: Opretter/opdaterer HubSpot deals
 * - Subproject: Opretter/opdaterer HubSpot orders + dashboard sync
 * - Contact/ContactPerson: Synkroniserer til HubSpot companies/contacts
 * - File: Linker tilbud/kontrakter til HubSpot deals
 * - ProjectEquipment/Group: Opdaterer deal beløb + line items sync
 * - ProjectCost: Opdaterer deal beløb + line items sync
 * - ProjectFunction: Synkroniserer personale til line items
 * - ProjectVehicle: Synkroniserer transport til line items
 *
 * Ignorerede events:
 * - Events fra integration brugeren (config.rentman.integrationUserId)
 *   for at undgå uendelige loops
 */

const express = require('express');
const { createChildLogger } = require('../../lib/logger');
const errorLogger = require('../../lib/error-logger');
const { isIntegrationUser } = require('../../lib/rentman-client');
const { rentmanCrossCheckRental } = require('../services/rentman-request');
const { syncDeal, updateDeal } = require('../services/rentman-update-deal');
const { createOrders, updateOrders, deleteOrder } = require('../services/rentman-update-order');
const { createContact, updateContact, deleteContact } = require('../services/rentman-update-contact');
const { linkFileToDeal } = require('../services/rentman-quotation-files');
const { handleEquipmentUpdate } = require('../services/rentman-cost-update');
const { handleDashboardWebhook } = require('../services/rentman-update-db');

// Line items sync - kun aktiv hvis FEATURE_LINE_ITEMS_WEBHOOK=true
const { handleEquipmentWebhook, handleCostWebhook } = require('../services/rentman-line-items');

const logger = createChildLogger('rentman-route');
const router = express.Router();

router.use(express.json());

/**
 * Mapping fra Rentman itemType til handler funktion.
 * Hver handler ved hvordan den skal behandle create/update/delete events.
 */
const ITEM_TYPE_HANDLERS = {
    Project: handleProjectEvent,              // → HubSpot deals
    Subproject: handleSubprojectEvent,        // → HubSpot orders + dashboard
    Contact: handleContactEvent,              // → HubSpot companies
    ContactPerson: handleContactEvent,        // → HubSpot contacts
    File: handleFileEvent,                    // → HubSpot attachments
    ProjectEquipment: handleEquipmentEvent,   // → Deal amount + line items
    ProjectEquipmentGroup: handleEquipmentEvent,
    ProjectCost: handleCostEvent,             // → Deal amount + line items
    ProjectFunction: handleFunctionEvent,     // → Line items (crew)
    ProjectVehicle: handleVehicleEvent        // → Line items (transport)
};

/**
 * POST /rentman
 * Modtager Rentman webhook payload med ét event.
 * Svarer straks med 200 OK og behandler event asynkront.
 */
router.post('/', async (req, res) => {
    const event = req.body;
    const start = Date.now();
    let webhookEventId = null;

    res.status(200).send('OK');

    if (!event || !event.itemType) {
        logger.warn('Ugyldig webhook modtaget fra Rentman', { event });
        return;
    }

    const itemId = event.items?.[0]?.id || event.items?.[0]?.ref?.split('/').pop();

    try {
        webhookEventId = await errorLogger.logWebhookEvent('rentman', {
            eventType: event.eventType,
            itemType: event.itemType,
            objectType: event.itemType,
            objectId: itemId
        }, 'processing');
    } catch (err) {
        // Continue even if logging fails
    }

    logger.webhookReceived('rentman', event.eventType, {
        itemType: event.itemType,
        itemCount: event.items?.length || 0,
        userId: event.user?.id,
        logEvent: false
    });

    try {
        if (event.user?.id && isIntegrationUser(event.user.id)) {
            logger.info('Ignorerer webhook fra integration bruger', {
                userId: event.user.id
            });

            if (webhookEventId) {
                await errorLogger.updateWebhookEvent(webhookEventId, {
                    status: 'ignored',
                    processingCompletedAt: new Date()
                });
            }
            return;
        }

        const handler = ITEM_TYPE_HANDLERS[event.itemType];

        if (handler) {
            await handler(event);
        } else {
            logger.debug('Ingen handler for itemType', { itemType: event.itemType });
        }

        const duration = Date.now() - start;
        logger.webhookProcessed('rentman', event.eventType, true, duration, {
            itemType: event.itemType
        });

        if (webhookEventId) {
            await errorLogger.updateWebhookEvent(webhookEventId, {
                status: 'completed',
                processingStartedAt: new Date(start),
                processingCompletedAt: new Date()
            });
        }
    } catch (error) {
        const duration = Date.now() - start;

        const errorId = await errorLogger.logError(error, {
            module: 'rentman-route',
            sourceSystem: 'webhook',
            isWebhook: true,
            webhookEventId,
            rentmanId: itemId,
            extra: {
                eventType: event.eventType,
                itemType: event.itemType,
                itemCount: event.items?.length || 0
            }
        });

        if (webhookEventId) {
            await errorLogger.updateWebhookEvent(webhookEventId, {
                status: 'failed',
                processingStartedAt: new Date(start),
                processingCompletedAt: new Date(),
                errorId,
                errorMessage: error.message
            });
        }

        logger.webhookProcessed('rentman', event.eventType, false, duration, {
            itemType: event.itemType,
            error: error.message,
            webhookEventId
        });
    }
});

// =============================================================================
// Event Handlers - én funktion per Rentman itemType
// =============================================================================

/**
 * Håndterer Project events.
 * - create: Tjekker om projektet er konverteret fra en rental request.
 *           Hvis ja, opdateres eksisterende deal. Ellers oprettes ny deal.
 * - update: Opdaterer eksisterende HubSpot deal med nye data.
 */
async function handleProjectEvent(event) {
    const { eventType, items } = event;

    if (eventType === 'create') {
        // Tjek om dette projekt er konverteret fra en rental request
        const isConverted = await rentmanCrossCheckRental(items[0].ref);

        if (isConverted) {
            await updateDeal(event, true);
        } else {
            await syncDeal(event);
        }
    } else if (eventType === 'update') {
        await updateDeal(event);
    }
}

/**
 * Håndterer Subproject events.
 * Subprojects i Rentman mapper til Orders i HubSpot.
 * Opdaterer også dashboard database for planlægningsoversigt.
 */
async function handleSubprojectEvent(event) {
    const { eventType } = event;

    // Altid opdater dashboard uanset event type
    handleDashboardWebhook(event);

    switch (eventType) {
        case 'create':
            await createOrders(event);
            break;
        case 'update':
            await updateOrders(event);
            break;
        case 'delete':
            await deleteOrder(event);
            break;
    }
}

/**
 * Håndterer Contact og ContactPerson events.
 * Contact → HubSpot Company
 * ContactPerson → HubSpot Contact (tilknyttet company)
 */
async function handleContactEvent(event) {
    const { eventType } = event;

    switch (eventType) {
        case 'create':
            await createContact(event);
            break;
        case 'update':
            await updateContact(event);
            break;
        case 'delete':
            await deleteContact(event);
            break;
    }
}

/**
 * Håndterer File events.
 * Når et tilbud eller kontrakt genereres i Rentman,
 * uploades filen til HubSpot og tilknyttes som note på deal.
 */
async function handleFileEvent(event) {
    if (event.eventType === 'create') {
        await linkFileToDeal(event);
    }
}

/**
 * Håndterer ProjectEquipment og ProjectEquipmentGroup events.
 * 1. Opdaterer deal amount i HubSpot (handleEquipmentUpdate)
 * 2. Synkroniserer line items hvis feature er aktiveret (handleEquipmentWebhook)
 */
async function handleEquipmentEvent(event) {
    await handleEquipmentUpdate(event);
    await handleEquipmentWebhook(event);  // Kun aktiv hvis FEATURE_LINE_ITEMS_WEBHOOK=true
}

/**
 * Håndterer ProjectCost events.
 * Samme som equipment - opdaterer beløb og synkroniserer line items.
 */
async function handleCostEvent(event) {
    await handleEquipmentUpdate(event);
    await handleCostWebhook(event);  // Kun aktiv hvis FEATURE_LINE_ITEMS_WEBHOOK=true
}

/**
 * Håndterer ProjectFunction events (personale/crew).
 * Synkroniserer kun til line items - påvirker ikke deal amount direkte.
 */
async function handleFunctionEvent(event) {
    await handleEquipmentWebhook(event);  // Kun aktiv hvis FEATURE_LINE_ITEMS_WEBHOOK=true
}

/**
 * Håndterer ProjectVehicle events (transport).
 * Synkroniserer kun til line items - påvirker ikke deal amount direkte.
 */
async function handleVehicleEvent(event) {
    await handleEquipmentWebhook(event);  // Kun aktiv hvis FEATURE_LINE_ITEMS_WEBHOOK=true
}

module.exports = router;

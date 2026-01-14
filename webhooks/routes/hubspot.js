/**
 * HubSpot Webhook Route
 *
 * Modtager webhook events fra HubSpot når der sker ændringer i CRM data.
 * Events logges til database for fejlsporing og monitoring.
 *
 * Håndterede event typer:
 * - Deal events (object.creation, object.propertyChange, object.deletion)
 * - Contact events (oprettelse, opdatering)
 * - Company events (oprettelse, opdatering)
 * - Association changes (contact-company, deal-company relationer)
 *
 * Ignorerede kilder (for at undgå loops):
 * - INTEGRATION: Ændringer fra denne integration
 * - API: Direkte API kald
 * - AUTO_ASSOCIATE_BY_DOMAIN: Automatiske HubSpot associeringer
 */

const express = require('express');
const config = require('../../config');
const { createChildLogger } = require('../../lib/logger');
const errorLogger = require('../../lib/error-logger');
const { filterDuplicateWebhookEvents, isIgnoredWebhookSource } = require('../../lib/utils');
const { handleHubSpotDealWebhook } = require('../services/hubspot-deal');
const { handleHubSpotContactWebhook } = require('../services/hubspot-contact');

const logger = createChildLogger('hubspot-route');
const router = express.Router();

router.use(express.json());

/**
 * POST /hubspot
 * Modtager HubSpot webhook payload med et eller flere events.
 * Svarer straks med 200 OK og behandler events asynkront.
 */
router.post('/', async (req, res) => {
    const events = req.body;
    const start = Date.now();
    let webhookEventId = null;

    res.status(200).send('OK');

    if (!events || events.length === 0) {
        logger.warn('Tom webhook modtaget fra HubSpot');
        return;
    }

    const firstEvent = events[0];

    try {
        webhookEventId = await errorLogger.logWebhookEvent('hubspot', {
            eventId: firstEvent.eventId,
            eventType: firstEvent.subscriptionType,
            subscriptionType: firstEvent.subscriptionType,
            objectType: firstEvent.objectTypeId,
            objectId: firstEvent.objectId
        }, 'processing');
    } catch (err) {
        // Continue even if logging fails
    }

    logger.webhookReceived('hubspot', firstEvent.subscriptionType, {
        eventCount: events.length,
        objectTypeId: firstEvent.objectTypeId,
        changeSource: firstEvent.changeSource,
        logEvent: false
    });

    try {
        if (isIgnoredWebhookSource(firstEvent.changeSource)) {
            logger.info('Ignorerer webhook fra integration/API kilde', {
                source: firstEvent.changeSource
            });

            if (webhookEventId) {
                await errorLogger.updateWebhookEvent(webhookEventId, {
                    status: 'ignored',
                    processingCompletedAt: new Date()
                });
            }
            return;
        }

        const dealEvents = events.filter(e => e.objectTypeId === config.hubspot.objectTypes.deals);
        if (dealEvents.length > 0) {
            await handleHubSpotDealWebhook(dealEvents);
        }

        const contactEvents = events.filter(e =>
            e.objectTypeId === config.hubspot.objectTypes.contacts ||
            e.objectTypeId === config.hubspot.objectTypes.companies
        );

        const isAssociationEvent = firstEvent.subscriptionType === 'object.associationChange';

        if (contactEvents.length > 0 || isAssociationEvent) {
            const filteredEvents = filterDuplicateWebhookEvents(events);

            if (filteredEvents.length > 0) {
                await handleHubSpotContactWebhook(filteredEvents);
            }
        }

        const duration = Date.now() - start;
        logger.webhookProcessed('hubspot', firstEvent.subscriptionType, true, duration, {
            dealEvents: dealEvents.length,
            contactEvents: contactEvents.length
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
            module: 'hubspot-route',
            sourceSystem: 'webhook',
            isWebhook: true,
            webhookEventId,
            extra: {
                subscriptionType: firstEvent.subscriptionType,
                objectTypeId: firstEvent.objectTypeId,
                objectId: firstEvent.objectId,
                eventCount: events.length
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

        logger.webhookProcessed('hubspot', firstEvent.subscriptionType, false, duration, {
            error: error.message,
            webhookEventId
        });
    }
});

module.exports = router;

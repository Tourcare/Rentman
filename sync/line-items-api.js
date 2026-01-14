/**
 * Line Items Manual Sync API
 *
 * REST API til manuel synkronisering af Rentman projekt-finanser
 * til HubSpot line items på deals.
 *
 * Endpoints:
 * - GET  /status              - Feature status og konfiguration
 * - GET  /preview/:id         - Preview uden at synce
 * - POST /sync/:id            - Sync et projekt
 * - POST /test/:id            - Test sync (ignorerer feature flag)
 * - POST /sync-bulk           - Bulk sync flere projekter
 *
 * Bemærk: Automatisk sync via webhooks håndteres i webhooks/routes/rentman.js
 */

const express = require('express');
const config = require('../config');
const { createChildLogger } = require('../lib/logger');
const lineItems = require('../webhooks/services/rentman-line-items');

const logger = createChildLogger('line-items-api');
const router = express.Router();

router.use(express.json());

// =============================================================================
// Status endpoint
// =============================================================================

/**
 * GET /status
 * Returnerer feature status og konfiguration.
 */
router.get('/status', (req, res) => {
    res.json({
        enabled: lineItems.isEnabled(),
        webhookSyncEnabled: lineItems.isWebhookSyncEnabled(),
        config: {
            includeEquipment: config.features.lineItems.includeEquipment,
            includeCosts: config.features.lineItems.includeCosts,
            includeCrew: config.features.lineItems.includeCrew,
            includeTransport: config.features.lineItems.includeTransport,
            deleteExisting: config.features.lineItems.deleteExisting
        }
    });
});

// =============================================================================
// Preview endpoint
// =============================================================================

/**
 * GET /preview/:rentmanProjectId
 * Viser hvad der ville blive synkroniseret uden at gøre det.
 */
router.get('/preview/:rentmanProjectId', async (req, res) => {
    try {
        const { rentmanProjectId } = req.params;

        if (!rentmanProjectId) {
            return res.status(400).json({ error: 'rentmanProjectId er påkrævet' });
        }

        const result = await lineItems.previewLineItems(parseInt(rentmanProjectId));

        if (!result.success) {
            return res.status(400).json(result);
        }

        res.json(result);
    } catch (error) {
        logger.error('Fejl ved preview', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// Sync endpoints
// =============================================================================

/**
 * POST /sync/:rentmanProjectId
 * Synkroniserer line items for et specifikt projekt.
 */
router.post('/sync/:rentmanProjectId', async (req, res) => {
    try {
        const { rentmanProjectId } = req.params;
        const options = req.body || {};

        if (!rentmanProjectId) {
            return res.status(400).json({ error: 'rentmanProjectId er påkrævet' });
        }

        if (!lineItems.isEnabled()) {
            return res.status(400).json({
                error: 'Line items feature er deaktiveret',
                hint: 'Sæt FEATURE_LINE_ITEMS=true i miljøvariabler'
            });
        }

        logger.info('Manuel sync startet', { rentmanProjectId, options });

        const result = await lineItems.syncProjectLineItems(parseInt(rentmanProjectId), options);

        res.json({
            success: result.success !== false,
            rentmanProjectId: parseInt(rentmanProjectId),
            ...result
        });
    } catch (error) {
        logger.error('Fejl ved sync', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /test/:rentmanProjectId
 * Test sync der ignorerer feature flag.
 * Bruges til at teste funktionaliteten uden at aktivere den permanent.
 */
router.post('/test/:rentmanProjectId', async (req, res) => {
    try {
        const { rentmanProjectId } = req.params;

        if (!rentmanProjectId) {
            return res.status(400).json({ error: 'rentmanProjectId er påkrævet' });
        }

        // Temporarily enable feature for test
        const originalEnabled = config.features.lineItems.enabled;
        config.features.lineItems.enabled = true;

        try {
            logger.info('Test sync startet', { rentmanProjectId });

            const result = await lineItems.testSyncForProject(parseInt(rentmanProjectId));

            res.json({
                success: result.success !== false,
                testMode: true,
                featureWasEnabled: originalEnabled,
                rentmanProjectId: parseInt(rentmanProjectId),
                ...result
            });
        } finally {
            // Restore original setting
            config.features.lineItems.enabled = originalEnabled;
        }
    } catch (error) {
        logger.error('Fejl ved test sync', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /sync-bulk
 * Bulk sync for flere projekter på én gang.
 * Body: { projectIds: [123, 456, ...], options: {} }
 */
router.post('/sync-bulk', async (req, res) => {
    try {
        const { projectIds, options = {} } = req.body;

        if (!projectIds || !Array.isArray(projectIds) || projectIds.length === 0) {
            return res.status(400).json({ error: 'projectIds array er påkrævet' });
        }

        if (!lineItems.isEnabled()) {
            return res.status(400).json({
                error: 'Line items feature er deaktiveret',
                hint: 'Sæt FEATURE_LINE_ITEMS=true i miljøvariabler'
            });
        }

        logger.info('Bulk sync startet', { projectCount: projectIds.length });

        const results = [];

        for (const projectId of projectIds) {
            try {
                const result = await lineItems.syncProjectLineItems(parseInt(projectId), options);
                results.push({
                    projectId,
                    success: result.success !== false,
                    ...result
                });
            } catch (error) {
                results.push({
                    projectId,
                    success: false,
                    error: error.message
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        const errorCount = results.filter(r => !r.success).length;

        res.json({
            success: errorCount === 0,
            total: projectIds.length,
            successCount,
            errorCount,
            results
        });
    } catch (error) {
        logger.error('Fejl ved bulk sync', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

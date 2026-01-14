const express = require('express');
const { createChildLogger } = require('../lib/logger');
const errorLogger = require('../lib/error-logger');
const sync = require('./index');

const logger = createChildLogger('sync-dashboard-api');
const router = express.Router();

router.get('/status', async (req, res) => {
    try {
        const status = await sync.getSyncStatus();
        res.json(status);
    } catch (error) {
        logger.error('Failed to get sync status', { error: error.message });
        res.status(500).json({ error: 'Failed to get sync status' });
    }
});

router.get('/summary', async (req, res) => {
    try {
        const summary = await sync.getDashboardSummary();
        res.json(summary);
    } catch (error) {
        logger.error('Failed to get dashboard summary', { error: error.message });
        res.status(500).json({ error: 'Failed to get dashboard summary' });
    }
});

router.get('/history', async (req, res) => {
    try {
        const { limit = 50, type } = req.query;
        const history = await sync.getSyncHistory({
            limit: parseInt(limit),
            syncType: type || null
        });
        res.json(history);
    } catch (error) {
        logger.error('Failed to get sync history', { error: error.message });
        res.status(500).json({ error: 'Failed to get sync history' });
    }
});

router.get('/history/:id', async (req, res) => {
    try {
        const details = await sync.getSyncDetails(parseInt(req.params.id));
        if (!details) {
            return res.status(404).json({ error: 'Sync log not found' });
        }
        res.json(details);
    } catch (error) {
        logger.error('Failed to get sync details', { error: error.message });
        res.status(500).json({ error: 'Failed to get sync details' });
    }
});

router.get('/errors', async (req, res) => {
    try {
        const { limit = 100, resolved = 'false' } = req.query;
        const errors = await sync.getErrors({
            limit: parseInt(limit),
            resolved: resolved === 'true'
        });
        res.json(errors);
    } catch (error) {
        logger.error('Failed to get errors', { error: error.message });
        res.status(500).json({ error: 'Failed to get errors' });
    }
});

router.post('/errors/:id/resolve', async (req, res) => {
    try {
        const { resolvedBy = 'dashboard' } = req.body;
        const success = await sync.resolveError(parseInt(req.params.id), resolvedBy);
        if (success) {
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Failed to resolve error' });
        }
    } catch (error) {
        logger.error('Failed to resolve error', { error: error.message });
        res.status(500).json({ error: 'Failed to resolve error' });
    }
});

router.post('/run', async (req, res) => {
    try {
        if (sync.isRunning) {
            return res.status(409).json({
                error: 'Sync already running',
                currentType: sync.currentType
            });
        }

        const {
            type = 'full',
            direction = 'bidirectional',
            batchSize = 100,
            triggeredBy = 'dashboard'
        } = req.body;

        res.json({ message: 'Sync started', type });

        if (type === 'full') {
            sync.runFullSync({ direction, batchSize, triggeredBy }).catch(error => {
                logger.error('Full sync failed', { error: error.message });
            });
        } else {
            sync.runSingleTypeSync(type, { direction, batchSize, triggeredBy }).catch(error => {
                logger.error('Single sync failed', { error: error.message, type });
            });
        }
    } catch (error) {
        logger.error('Failed to start sync', { error: error.message });
        res.status(500).json({ error: 'Failed to start sync' });
    }
});

router.post('/run/company', async (req, res) => {
    try {
        if (sync.isRunning) {
            return res.status(409).json({ error: 'Sync already running' });
        }

        const { direction = 'bidirectional', batchSize = 100 } = req.body;
        res.json({ message: 'Company sync started' });

        sync.syncCompanies({ direction, batchSize, triggeredBy: 'dashboard' }).catch(error => {
            logger.error('Company sync failed', { error: error.message });
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to start company sync' });
    }
});

router.post('/run/contact', async (req, res) => {
    try {
        if (sync.isRunning) {
            return res.status(409).json({ error: 'Sync already running' });
        }

        const { direction = 'bidirectional', batchSize = 100 } = req.body;
        res.json({ message: 'Contact sync started' });

        sync.syncContacts({ direction, batchSize, triggeredBy: 'dashboard' }).catch(error => {
            logger.error('Contact sync failed', { error: error.message });
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to start contact sync' });
    }
});

router.post('/run/deal', async (req, res) => {
    try {
        if (sync.isRunning) {
            return res.status(409).json({ error: 'Sync already running' });
        }

        const { direction = 'bidirectional', batchSize = 50 } = req.body;
        res.json({ message: 'Deal sync started' });

        sync.syncDeals({ direction, batchSize, triggeredBy: 'dashboard' }).catch(error => {
            logger.error('Deal sync failed', { error: error.message });
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to start deal sync' });
    }
});

router.post('/run/order', async (req, res) => {
    try {
        if (sync.isRunning) {
            return res.status(409).json({ error: 'Sync already running' });
        }

        const { direction = 'bidirectional', batchSize = 50 } = req.body;
        res.json({ message: 'Order sync started' });

        sync.syncOrders({ direction, batchSize, triggeredBy: 'dashboard' }).catch(error => {
            logger.error('Order sync failed', { error: error.message });
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to start order sync' });
    }
});

router.post('/sync-single', async (req, res) => {
    try {
        const { type, rentmanId, hubspotId } = req.body;

        if (!type || (!rentmanId && !hubspotId)) {
            return res.status(400).json({
                error: 'Missing required parameters: type and either rentmanId or hubspotId'
            });
        }

        let result;
        switch (type) {
            case 'company':
                result = await sync.syncSingleCompany(rentmanId, hubspotId);
                break;
            case 'contact':
                result = await sync.syncSingleContact(rentmanId, hubspotId);
                break;
            case 'deal':
                result = await sync.syncSingleDeal(rentmanId, hubspotId);
                break;
            case 'order':
                result = await sync.syncSingleOrder(rentmanId, hubspotId);
                break;
            default:
                return res.status(400).json({ error: `Unknown type: ${type}` });
        }

        res.json({ success: true, stats: result });
    } catch (error) {
        logger.error('Failed to sync single item', { error: error.message });
        res.status(500).json({ error: 'Failed to sync item' });
    }
});

router.get('/statistics', async (req, res) => {
    try {
        const { days = 30 } = req.query;
        const { getStatistics } = require('./sync-logger');
        const stats = await getStatistics(parseInt(days));
        res.json(stats);
    } catch (error) {
        logger.error('Failed to get statistics', { error: error.message });
        res.status(500).json({ error: 'Failed to get statistics' });
    }
});

router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        isRunning: sync.isRunning,
        currentType: sync.currentType,
        timestamp: new Date().toISOString()
    });
});

// Integration error endpoints
router.get('/integration-errors', async (req, res) => {
    try {
        const { limit = 100, resolved, severity, errorType, sourceSystem, sourceModule } = req.query;

        const filters = {};
        if (resolved !== undefined) filters.resolved = resolved === 'true';
        if (severity) filters.severity = severity;
        if (errorType) filters.errorType = errorType;
        if (sourceSystem) filters.sourceSystem = sourceSystem;
        if (sourceModule) filters.sourceModule = sourceModule;

        const errors = await errorLogger.getRecentErrors(parseInt(limit), filters);
        res.json(errors);
    } catch (error) {
        logger.error('Failed to get integration errors', { error: error.message });
        res.status(500).json({ error: 'Failed to get integration errors' });
    }
});

router.get('/integration-errors/summary', async (req, res) => {
    try {
        const summary = await errorLogger.getErrorSummary();
        res.json(summary);
    } catch (error) {
        logger.error('Failed to get error summary', { error: error.message });
        res.status(500).json({ error: 'Failed to get error summary' });
    }
});

router.get('/integration-errors/statistics', async (req, res) => {
    try {
        const { days = 30 } = req.query;
        const stats = await errorLogger.getErrorStatistics(parseInt(days));
        res.json(stats);
    } catch (error) {
        logger.error('Failed to get error statistics', { error: error.message });
        res.status(500).json({ error: 'Failed to get error statistics' });
    }
});

router.post('/integration-errors/:id/resolve', async (req, res) => {
    try {
        const { resolvedBy = 'dashboard', notes } = req.body;
        const success = await errorLogger.resolveError(
            parseInt(req.params.id),
            resolvedBy,
            notes
        );

        if (success) {
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Failed to resolve error' });
        }
    } catch (error) {
        logger.error('Failed to resolve integration error', { error: error.message });
        res.status(500).json({ error: 'Failed to resolve error' });
    }
});

// Webhook event endpoints
router.get('/webhook-events', async (req, res) => {
    try {
        const { limit = 100, source, status, eventType } = req.query;

        const filters = {};
        if (source) filters.source = source;
        if (status) filters.status = status;
        if (eventType) filters.eventType = eventType;

        const events = await errorLogger.getWebhookEvents(parseInt(limit), filters);
        res.json(events);
    } catch (error) {
        logger.error('Failed to get webhook events', { error: error.message });
        res.status(500).json({ error: 'Failed to get webhook events' });
    }
});

// Combined dashboard summary
router.get('/dashboard', async (req, res) => {
    try {
        const [syncSummary, errorSummary] = await Promise.all([
            sync.getDashboardSummary(),
            errorLogger.getErrorSummary()
        ]);

        res.json({
            sync: syncSummary,
            errors: errorSummary,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Failed to get dashboard data', { error: error.message });
        res.status(500).json({ error: 'Failed to get dashboard data' });
    }
});

module.exports = router;

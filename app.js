/**
 * HubSpot CRM og Rentman Integration Server
 *
 * Denne applikation håndterer tovejs-synkronisering mellem HubSpot CRM og Rentman
 * warehouse rental software. Den modtager webhooks fra begge systemer og
 * opdaterer data i real-time.
 *
 * Hovedfunktioner:
 * - Webhook endpoints til HubSpot og Rentman events
 * - Line items sync fra Rentman projekter til HubSpot deals
 * - Dashboard API til sync status og fejlhåndtering
 * - Brugerautentificering til beskyttede sider
 */

const express = require('express');
const path = require('path');
const session = require('express-session');
const config = require('./config');
const logger = require('./lib/logger');
const db = require('./lib/database');
const rentmanDb = require('./lib/rentman-db');
const hubspot = require('./lib/hubspot-client');
const rentman = require('./lib/rentman-client');

// Webhook route handlers
const hubspotRouter = require('./webhooks/routes/hubspot');
const rentmanRouter = require('./webhooks/routes/rentman');

// Sync API routes
// Dashboard API - giver overblik over sync status, fejl og historik
const syncDashboardRouter = require('./sync/dashboard-api');
const { syncAll, syncItemType, syncItemById } = require('./sync/sync-rentman-db');

const app = express();

app.use(express.json());

app.use(session({
    secret: config.server.secret,
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: config.isProduction,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

app.use(express.static(path.join(process.cwd(), 'public')));

app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (!req.path.startsWith('/hubspot') && !req.path.startsWith('/rentman')) {
            logger.debug(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
        }
    });
    next();
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;

    const user = config.users.find(u =>
        u.username === username && u.password === password
    );

    if (!user) {
        logger.warn('Mislykket login forsog', { username });
        return res.status(401).json({ error: 'Ugyldigt login' });
    }

    req.session.user = { username };
    logger.info('Bruger logget ind', { username });
    res.json({ success: true });
});

app.post('/logout', (req, res) => {
    const username = req.session.user?.username;
    req.session.destroy((err) => {
        if (err) {
            logger.error('Fejl ved logout', { error: err.message });
            return res.status(500).json({ error: 'Kunne ikke logge ud' });
        }
        logger.info('Bruger logget ud', { username });
        res.json({ success: true });
    });
});

app.get('/me', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Ikke logget ind' });
    }
    res.json({ username: req.session.user.username });
});
const authMiddleware = (req, res, next) => {
    if (req.session.user) {
        return next();
    }
    return res.redirect('/login.html');
};

app.get('/', authMiddleware, (req, res) => {
    res.sendFile(path.join(process.cwd(), 'protected', 'index.html'));
});

// =============================================================================
// API Routes
// =============================================================================

// Webhook endpoints - modtager events fra HubSpot og Rentman
app.use('/hubspot', hubspotRouter);    // POST /hubspot - HubSpot webhook events
app.use('/rentman', rentmanRouter);    // POST /rentman - Rentman webhook events

// Sync API endpoints - alle under /sync
// Dashboard:
// GET  /sync/status                 - Aktuel sync status
// GET  /sync/summary                - Dashboard opsummering
// GET  /sync/history                - Sync historik
// GET  /sync/integration-errors     - Fejlliste med filtrering
// POST /sync/run                    - Start manuel sync
// GET  /sync/dashboard              - Kombineret data til dashboard
app.use('/sync', syncDashboardRouter);


// =============================================================================
// Rentman DB Sync API - synkroniserer Rentman data til dedikeret database
// =============================================================================

// POST /rentman-db/sync - Start fuld sync af alle item types
app.post('/rentman-db/sync', (req, res) => {
    res.json({ status: 'started', message: 'Fuld Rentman DB sync startet' });
    syncAll().catch(err => logger.error('Fuld Rentman DB sync fejlede', { error: err.message }));
});

// POST /rentman-db/sync/:itemType - Sync en specifik item type
app.post('/rentman-db/sync/:itemType', (req, res) => {
    const { itemType } = req.params;
    res.json({ status: 'started', message: `Sync af ${itemType} startet` });
    syncItemType(itemType).catch(err => logger.error(`Sync af ${itemType} fejlede`, { error: err.message }));
});

// POST /rentman-db/sync/:itemType/:id - Sync et specifikt item by ID
app.post('/rentman-db/sync/:itemType/:id', async (req, res) => {
    const { itemType, id } = req.params;
    try {
        const success = await syncItemById(itemType, parseInt(id, 10));
        res.json({ status: success ? 'ok' : 'not_found', itemType, id });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// Sync status - antal rows pr. rentman_data tabel
app.get('/sync-count', async (req, res) => {
    const rentmanDb = require('./lib/rentman-db');
    const type = req.query.type || 'ProjectEquipment';
    const config = rentmanDb.getItemTypeConfig(type);
    if (!config) return res.status(400).json({ error: `Ukendt type: ${type}` });
    const rows = await rentmanDb.query(`SELECT COUNT(*) AS count FROM ${config.table}`);
    res.json({ type, table: config.table, count: rows[0].count });
});

// Sync count fra Rentman API (1 API kald, limit=1 for at få itemCount)
app.get('/sync-count-api', async (req, res) => {
    const endpoint = req.query.endpoint || '/projectequipment';
    const response = await fetch(`${config.rentman.baseUrl}${endpoint}?fields=id&limit=1`, {
        headers: {
            'Authorization': `Bearer ${config.rentman.token}`,
            'Content-Type': 'application/json'
        }
    });
    if (!response.ok) return res.status(502).json({ error: 'Rentman API fejl', status: response.status });
    const json = await response.json();
    res.json({ endpoint, itemCount: json.itemCount });
});

// Health check endpoint til load balancer/monitoring
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        environment: config.env,
        timestamp: new Date().toISOString()
    });
});

app.use((err, req, res, next) => {
    logger.error('Uhandlet fejl', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
    });

    res.status(500).json({
        error: config.isProduction ? 'Internal server error' : err.message
    });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

function gracefulShutdown(signal) {
    logger.info(`${signal} signal modtaget. Lukker ned...`);

    server.close(async () => {
        logger.info('HTTP server lukket');

        try {
            hubspot.stopRetryProcessor();
            rentman.stopRetryProcessor();
            await db.shutdown();
            await rentmanDb.shutdown();
            logger.info('Database forbindelser lukket');
            process.exit(0);
        } catch (err) {
            logger.error('Fejl ved lukning af database', { error: err.message });
            process.exit(1);
        }
    });

    setTimeout(() => {
        logger.error('Tvungen lukning efter timeout');
        process.exit(1);
    }, 30000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception', {
        error: err.message,
        stack: err.stack
    });
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', {
        reason: reason?.message || reason,
        stack: reason?.stack
    });
});

const server = app.listen(config.server.port, () => {
    logger.info(`Server startet`, {
        port: config.server.port,
        environment: config.env,
        nodeVersion: process.version
    });

    if (!config.validate()) {
        logger.warn('Konfiguration mangler nogle vaerdier');
    }

    // Start retry-processorer for fejlede API requests (kører hvert 10. minut)
    hubspot.startRetryProcessor();
    rentman.startRetryProcessor();
});

module.exports = app;

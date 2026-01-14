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

// Webhook route handlers
const hubspotRouter = require('./webhooks/routes/hubspot');
const rentmanRouter = require('./webhooks/routes/rentman');

// Sync API routes
// Dashboard API - giver overblik over sync status, fejl og historik
const syncDashboardRouter = require('./sync/dashboard-api');
// Line items API - manuel sync af Rentman finansdata til HubSpot line items
const lineItemsRouter = require('./sync/line-items-api');

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

// Line items manuel sync:
// GET  /sync/line-items/status      - Feature status
// GET  /sync/line-items/preview/:id - Preview uden at synce
// POST /sync/line-items/sync/:id    - Sync et projekt
// POST /sync/line-items/test/:id    - Test sync (ignorerer feature flag)
// POST /sync/line-items/sync-bulk   - Bulk sync flere projekter
app.use('/sync/line-items', lineItemsRouter);

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
            await db.shutdown();
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
});

module.exports = app;

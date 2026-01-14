/**
 * Error Logger Module
 *
 * Centraliseret fejlhåndtering og logging til database.
 * Alle fejl i integrationen logges til integration_errors tabellen
 * med kategorisering, severity og kontekst.
 *
 * Hovedfunktioner:
 * - logError(): Logger fejl med automatisk kategorisering
 * - logWebhookEvent(): Tracker webhook events med status
 * - logApiCall(): Logger API kald til fejlsøgning
 *
 * Query funktioner til dashboard:
 * - getRecentErrors(): Henter seneste fejl med filtrering
 * - getUnresolvedErrors(): Henter uløste fejl
 * - resolveError(): Markerer fejl som løst
 * - getErrorSummary(): Dashboard opsummering
 */

const mysql = require('mysql2/promise');
const config = require('../config');

let pool = null;
let isInitialized = false;
let initPromise = null;

async function getPool() {
    if (pool) return pool;

    if (initPromise) {
        await initPromise;
        return pool;
    }

    initPromise = (async () => {
        pool = mysql.createPool(config.database.main);
        isInitialized = true;
    })();

    await initPromise;
    return pool;
}

// =============================================================================
// Konstanter til fejlkategorisering
// =============================================================================

/**
 * Fejltyper bruges til automatisk kategorisering af fejl.
 * Hjælper med at identificere mønstre og prioritere løsninger.
 */
const ERROR_TYPES = {
    WEBHOOK: 'webhook_error',      // Fejl under webhook behandling
    API: 'api_error',              // Fejl ved API kald til HubSpot/Rentman
    DATABASE: 'database_error',    // MySQL forbindelses- eller query fejl
    VALIDATION: 'validation_error', // Ugyldig data fra API eller webhook
    SYNC: 'sync_error',            // Fejl under sync operationer
    TIMEOUT: 'timeout_error',      // API timeout
    RATE_LIMIT: 'rate_limit_error', // Rate limit ramt (429)
    AUTH: 'auth_error',            // Autentifikationsfejl (401/403)
    UNKNOWN: 'unknown'             // Ukendt fejltype
};

/**
 * Severity levels til prioritering af fejl.
 * CRITICAL og ERROR kræver øjeblikkelig handling.
 */
const SEVERITY = {
    DEBUG: 'debug',      // Debugging info
    INFO: 'info',        // Informativ besked
    WARN: 'warn',        // Advarsel, ikke kritisk
    ERROR: 'error',      // Fejl der kræver handling
    CRITICAL: 'critical' // Kritisk - integration nede
};

/**
 * Kildesystem til at identificere hvor fejlen opstod.
 */
const SOURCE_SYSTEM = {
    HUBSPOT: 'hubspot',   // Fejl fra HubSpot API
    RENTMAN: 'rentman',   // Fejl fra Rentman API
    DATABASE: 'database', // Fejl fra MySQL
    INTERNAL: 'internal', // Intern applikationsfejl
    WEBHOOK: 'webhook'    // Fejl under webhook modtagelse
};

// =============================================================================
// Hjælpefunktioner til automatisk kategorisering
// =============================================================================

/**
 * Kategoriserer en fejl automatisk baseret på fejlbesked, kode og kontekst.
 * Bruges til at gruppere fejl i dashboard og prioritere handling.
 */
function categorizeError(error, context = {}) {
    if (!error) return ERROR_TYPES.UNKNOWN;

    const message = error.message?.toLowerCase() || '';
    const code = error.code?.toLowerCase() || '';
    const status = error.response?.status || error.status;

    if (code === 'econnrefused' || code === 'enotfound' || code === 'econnreset') {
        return ERROR_TYPES.API;
    }

    if (code === 'etimedout' || code === 'esockettimedout' || message.includes('timeout')) {
        return ERROR_TYPES.TIMEOUT;
    }

    if (status === 429 || message.includes('rate limit')) {
        return ERROR_TYPES.RATE_LIMIT;
    }

    if (status === 401 || status === 403 || message.includes('unauthorized') || message.includes('forbidden')) {
        return ERROR_TYPES.AUTH;
    }

    if (message.includes('validation') || status === 400 || status === 422) {
        return ERROR_TYPES.VALIDATION;
    }

    if (code?.startsWith('er_') || message.includes('sql') || message.includes('mysql') || message.includes('database')) {
        return ERROR_TYPES.DATABASE;
    }

    if (context.isWebhook || context.webhookEventId) {
        return ERROR_TYPES.WEBHOOK;
    }

    if (context.isSync) {
        return ERROR_TYPES.SYNC;
    }

    if (status >= 400 && status < 600) {
        return ERROR_TYPES.API;
    }

    return ERROR_TYPES.UNKNOWN;
}

/**
 * Bestemmer severity baseret på fejltype og HTTP status.
 * Auth og database fejl er altid kritiske.
 */
function determineSeverity(error, errorType) {
    const status = error?.response?.status || error?.status;

    if (errorType === ERROR_TYPES.AUTH || errorType === ERROR_TYPES.DATABASE) {
        return SEVERITY.CRITICAL;
    }

    if (status >= 500) {
        return SEVERITY.ERROR;
    }

    if (errorType === ERROR_TYPES.RATE_LIMIT) {
        return SEVERITY.WARN;
    }

    if (errorType === ERROR_TYPES.VALIDATION) {
        return SEVERITY.WARN;
    }

    if (status >= 400) {
        return SEVERITY.ERROR;
    }

    return SEVERITY.ERROR;
}

/**
 * Bestemmer kildesystem fra kontekst.
 */
function determineSourceSystem(context = {}) {
    if (context.sourceSystem) return context.sourceSystem;

    if (context.isHubspot || context.endpoint?.includes('hubspot')) {
        return SOURCE_SYSTEM.HUBSPOT;
    }

    if (context.isRentman || context.endpoint?.includes('rentman')) {
        return SOURCE_SYSTEM.RENTMAN;
    }

    if (context.isWebhook) {
        return SOURCE_SYSTEM.WEBHOOK;
    }

    if (context.isDatabase) {
        return SOURCE_SYSTEM.DATABASE;
    }

    return SOURCE_SYSTEM.INTERNAL;
}

// =============================================================================
// Hovedfunktioner til logging
// =============================================================================

/**
 * Logger en fejl til integration_errors tabellen.
 *
 * @param {Error} error - Fejlobjektet
 * @param {Object} context - Kontekst information
 * @param {string} context.module - Modul hvor fejlen opstod
 * @param {string} context.sourceSystem - hubspot/rentman/database/internal
 * @param {string} context.hubspotId - Relateret HubSpot objekt ID
 * @param {string} context.rentmanId - Relateret Rentman objekt ID
 * @param {number} context.webhookEventId - Relateret webhook event ID
 * @param {Object} context.extra - Ekstra metadata
 * @returns {number|null} - Oprettet fejl ID eller null ved fejl
 */
async function logError(error, context = {}) {
    try {
        const dbPool = await getPool();

        const errorType = context.errorType || categorizeError(error, context);
        const severity = context.severity || determineSeverity(error, errorType);
        const sourceSystem = determineSourceSystem(context);

        const errorData = {
            error_type: errorType,
            severity: severity,
            source_module: context.module || context.sourceModule || 'unknown',
            source_function: context.function || context.sourceFunction || null,
            source_system: sourceSystem,
            error_message: error?.message || String(error) || 'Unknown error',
            error_code: error?.code || error?.response?.status?.toString() || null,
            stack_trace: error?.stack || null,
            request_method: context.method || null,
            request_path: context.path || context.endpoint || null,
            request_body: context.requestBody ? JSON.stringify(context.requestBody) : null,
            response_status: error?.response?.status || context.responseStatus || null,
            response_body: context.responseBody ? JSON.stringify(context.responseBody) : null,
            hubspot_id: context.hubspotId || null,
            rentman_id: context.rentmanId?.toString() || null,
            webhook_event_id: context.webhookEventId || null,
            context: context.extra ? JSON.stringify(context.extra) : null
        };

        const [result] = await dbPool.execute(
            `INSERT INTO integration_errors
             (error_type, severity, source_module, source_function, source_system,
              error_message, error_code, stack_trace,
              request_method, request_path, request_body,
              response_status, response_body,
              hubspot_id, rentman_id, webhook_event_id, context)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                errorData.error_type,
                errorData.severity,
                errorData.source_module,
                errorData.source_function,
                errorData.source_system,
                errorData.error_message,
                errorData.error_code,
                errorData.stack_trace,
                errorData.request_method,
                errorData.request_path,
                errorData.request_body,
                errorData.response_status,
                errorData.response_body,
                errorData.hubspot_id,
                errorData.rentman_id,
                errorData.webhook_event_id,
                errorData.context
            ]
        );

        await updateStatistics(dbPool, errorData);

        return result.insertId;
    } catch (dbError) {
        console.error('[error-logger] Failed to log error to database:', dbError.message);
        console.error('[error-logger] Original error:', error?.message);
        return null;
    }
}

/**
 * Logger et webhook event til webhook_events tabellen.
 * Bruges til at tracke webhook status (received → processing → completed/failed).
 *
 * @param {string} source - 'hubspot' eller 'rentman'
 * @param {Object} eventData - Event data fra webhook
 * @param {string} status - 'received', 'processing', 'completed', 'failed', 'ignored'
 * @returns {number|null} - Oprettet event ID eller null ved fejl
 */
async function logWebhookEvent(source, eventData, status = 'received') {
    try {
        const dbPool = await getPool();

        const [result] = await dbPool.execute(
            `INSERT INTO webhook_events
             (source, event_id, event_type, subscription_type, object_type, object_id, status, raw_payload)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                source,
                eventData.eventId || null,
                eventData.eventType || eventData.subscriptionType || 'unknown',
                eventData.subscriptionType || null,
                eventData.objectType || eventData.itemType || null,
                eventData.objectId || eventData.itemId || null,
                status,
                JSON.stringify(eventData)
            ]
        );

        return result.insertId;
    } catch (error) {
        console.error('[error-logger] Failed to log webhook event:', error.message);
        return null;
    }
}

/**
 * Opdaterer et eksisterende webhook event med ny status og metadata.
 *
 * @param {number} eventId - Webhook event ID
 * @param {Object} updates - Felter der skal opdateres
 * @param {string} updates.status - Ny status
 * @param {Date} updates.processingStartedAt - Behandling startet
 * @param {Date} updates.processingCompletedAt - Behandling afsluttet
 * @param {number} updates.errorId - Relateret fejl ID
 * @param {string} updates.errorMessage - Fejlbesked
 */
async function updateWebhookEvent(eventId, updates) {
    try {
        const dbPool = await getPool();

        const setClauses = [];
        const values = [];

        if (updates.status) {
            setClauses.push('status = ?');
            values.push(updates.status);
        }

        if (updates.processingStartedAt) {
            setClauses.push('processing_started_at = ?');
            values.push(updates.processingStartedAt);
        }

        if (updates.processingCompletedAt) {
            setClauses.push('processing_completed_at = ?');
            values.push(updates.processingCompletedAt);

            if (updates.processingStartedAt) {
                setClauses.push('processing_duration_ms = TIMESTAMPDIFF(MICROSECOND, processing_started_at, ?) / 1000');
                values.push(updates.processingCompletedAt);
            }
        }

        if (updates.errorId) {
            setClauses.push('error_id = ?');
            values.push(updates.errorId);
        }

        if (updates.errorMessage) {
            setClauses.push('error_message = ?');
            values.push(updates.errorMessage);
        }

        if (setClauses.length === 0) return;

        values.push(eventId);

        await dbPool.execute(
            `UPDATE webhook_events SET ${setClauses.join(', ')} WHERE id = ?`,
            values
        );
    } catch (error) {
        console.error('[error-logger] Failed to update webhook event:', error.message);
    }
}

/**
 * Logger et API kald til api_call_log tabellen.
 * Bruges til debugging og performance analyse.
 *
 * @param {string} targetSystem - 'hubspot' eller 'rentman'
 * @param {string} method - HTTP metode (GET, POST, etc.)
 * @param {string} endpoint - API endpoint
 * @param {Object} options - Request/response data
 */
async function logApiCall(targetSystem, method, endpoint, options = {}) {
    try {
        const dbPool = await getPool();

        const [result] = await dbPool.execute(
            `INSERT INTO api_call_log
             (target_system, method, endpoint, request_headers, request_body,
              response_status, response_body, duration_ms, webhook_event_id, error_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                targetSystem,
                method,
                endpoint,
                options.requestHeaders ? JSON.stringify(options.requestHeaders) : null,
                options.requestBody ? JSON.stringify(options.requestBody) : null,
                options.responseStatus || null,
                options.responseBody ? JSON.stringify(options.responseBody) : null,
                options.durationMs || null,
                options.webhookEventId || null,
                options.errorId || null
            ]
        );

        return result.insertId;
    } catch (error) {
        console.error('[error-logger] Failed to log API call:', error.message);
        return null;
    }
}

/**
 * Opdaterer daglig fejlstatistik i error_statistics tabellen.
 * Kaldes automatisk efter hver logError().
 */
async function updateStatistics(dbPool, errorData) {
    try {
        const today = new Date().toISOString().split('T')[0];

        const typeColumn = {
            'webhook_error': 'webhook_errors',
            'api_error': 'api_errors',
            'database_error': 'database_errors',
            'validation_error': 'validation_errors',
            'sync_error': 'sync_errors'
        }[errorData.error_type] || 'other_errors';

        const severityColumn = {
            'critical': 'critical_count',
            'error': 'error_count',
            'warn': 'warn_count'
        }[errorData.severity];

        const systemColumn = {
            'hubspot': 'hubspot_errors',
            'rentman': 'rentman_errors'
        }[errorData.source_system] || 'internal_errors';

        await dbPool.execute(
            `INSERT INTO error_statistics (date, ${typeColumn}, ${severityColumn || 'error_count'}, ${systemColumn}, unresolved_count)
             VALUES (?, 1, 1, 1, 1)
             ON DUPLICATE KEY UPDATE
                 ${typeColumn} = ${typeColumn} + 1,
                 ${severityColumn || 'error_count'} = ${severityColumn || 'error_count'} + 1,
                 ${systemColumn} = ${systemColumn} + 1,
                 unresolved_count = unresolved_count + 1`,
            [today]
        );
    } catch (error) {
        console.error('[error-logger] Failed to update statistics:', error.message);
    }
}

// =============================================================================
// Query funktioner til dashboard
// =============================================================================

/**
 * Henter seneste fejl med valgfri filtrering.
 *
 * @param {number} limit - Max antal fejl at returnere
 * @param {Object} filters - Filtreringsparametre
 * @param {boolean} filters.resolved - Filtrer på løst/uløst
 * @param {string} filters.severity - Filtrer på severity
 * @param {string} filters.errorType - Filtrer på fejltype
 * @param {string} filters.sourceSystem - Filtrer på kildesystem
 * @returns {Array} - Liste af fejl
 */
async function getRecentErrors(limit = 100, filters = {}) {
    try {
        const dbPool = await getPool();

        let query = 'SELECT * FROM integration_errors WHERE 1=1';
        const params = [];

        if (filters.resolved !== undefined) {
            query += ' AND resolved = ?';
            params.push(filters.resolved);
        }

        if (filters.severity) {
            query += ' AND severity = ?';
            params.push(filters.severity);
        }

        if (filters.errorType) {
            query += ' AND error_type = ?';
            params.push(filters.errorType);
        }

        if (filters.sourceSystem) {
            query += ' AND source_system = ?';
            params.push(filters.sourceSystem);
        }

        if (filters.sourceModule) {
            query += ' AND source_module = ?';
            params.push(filters.sourceModule);
        }

        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);

        const [rows] = await dbPool.execute(query, params);
        return rows;
    } catch (error) {
        console.error('[error-logger] Failed to get recent errors:', error.message);
        return [];
    }
}

/**
 * Henter uløste fejl (shortcut til getRecentErrors med resolved: false).
 */
async function getUnresolvedErrors(limit = 100) {
    return getRecentErrors(limit, { resolved: false });
}

/**
 * Markerer en fejl som løst med noter om løsningen.
 *
 * @param {number} errorId - Fejl ID
 * @param {string} resolvedBy - Hvem der løste fejlen
 * @param {string} notes - Noter om løsningen
 * @returns {boolean} - Success status
 */
async function resolveError(errorId, resolvedBy = 'system', notes = null) {
    try {
        const dbPool = await getPool();

        await dbPool.execute(
            `UPDATE integration_errors
             SET resolved = TRUE, resolved_at = CURRENT_TIMESTAMP, resolved_by = ?, resolution_notes = ?
             WHERE id = ?`,
            [resolvedBy, notes, errorId]
        );

        const today = new Date().toISOString().split('T')[0];
        await dbPool.execute(
            `UPDATE error_statistics
             SET resolved_count = resolved_count + 1, unresolved_count = GREATEST(0, unresolved_count - 1)
             WHERE date = ?`,
            [today]
        );

        return true;
    } catch (error) {
        console.error('[error-logger] Failed to resolve error:', error.message);
        return false;
    }
}

/**
 * Henter fejlstatistik for de seneste N dage.
 *
 * @param {number} days - Antal dage tilbage
 * @returns {Array} - Daglig statistik
 */
async function getErrorStatistics(days = 30) {
    try {
        const dbPool = await getPool();

        const [rows] = await dbPool.execute(
            `SELECT * FROM error_statistics
             WHERE date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
             ORDER BY date DESC`,
            [days]
        );

        return rows;
    } catch (error) {
        console.error('[error-logger] Failed to get error statistics:', error.message);
        return [];
    }
}

/**
 * Henter en opsummering til dashboard med uløste fejl og dagens statistik.
 *
 * @returns {Object} - Summary med unresolvedCount, criticalCount, recentErrors, todayStats
 */
async function getErrorSummary() {
    try {
        const dbPool = await getPool();

        const [[unresolvedCount]] = await dbPool.execute(
            'SELECT COUNT(*) as count FROM integration_errors WHERE resolved = FALSE'
        );

        const [[criticalCount]] = await dbPool.execute(
            `SELECT COUNT(*) as count FROM integration_errors
             WHERE resolved = FALSE AND severity IN ('critical', 'error')`
        );

        const [recentErrors] = await dbPool.execute(
            `SELECT * FROM integration_errors
             WHERE resolved = FALSE
             ORDER BY FIELD(severity, 'critical', 'error', 'warn', 'info', 'debug'), created_at DESC
             LIMIT 10`
        );

        const [todayStats] = await dbPool.execute(
            `SELECT * FROM error_statistics WHERE date = CURDATE()`
        );

        return {
            unresolvedCount: unresolvedCount.count,
            criticalCount: criticalCount.count,
            recentErrors,
            todayStats: todayStats[0] || null
        };
    } catch (error) {
        console.error('[error-logger] Failed to get error summary:', error.message);
        return {
            unresolvedCount: 0,
            criticalCount: 0,
            recentErrors: [],
            todayStats: null
        };
    }
}

/**
 * Henter webhook events med valgfri filtrering.
 *
 * @param {number} limit - Max antal events
 * @param {Object} filters - Filtreringsparametre
 * @returns {Array} - Liste af webhook events
 */
async function getWebhookEvents(limit = 100, filters = {}) {
    try {
        const dbPool = await getPool();

        let query = 'SELECT * FROM webhook_events WHERE 1=1';
        const params = [];

        if (filters.source) {
            query += ' AND source = ?';
            params.push(filters.source);
        }

        if (filters.status) {
            query += ' AND status = ?';
            params.push(filters.status);
        }

        if (filters.eventType) {
            query += ' AND event_type = ?';
            params.push(filters.eventType);
        }

        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);

        const [rows] = await dbPool.execute(query, params);
        return rows;
    } catch (error) {
        console.error('[error-logger] Failed to get webhook events:', error.message);
        return [];
    }
}

module.exports = {
    logError,
    logWebhookEvent,
    updateWebhookEvent,
    logApiCall,

    getRecentErrors,
    getUnresolvedErrors,
    resolveError,
    getErrorStatistics,
    getErrorSummary,
    getWebhookEvents,

    ERROR_TYPES,
    SEVERITY,
    SOURCE_SYSTEM,

    categorizeError,
    determineSeverity,
    determineSourceSystem
};

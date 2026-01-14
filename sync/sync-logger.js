const db = require('../lib/database');
const { createChildLogger } = require('../lib/logger');

const logger = createChildLogger('sync-logger');

class SyncLogger {
    constructor(syncType, direction, triggeredBy = 'system') {
        this.syncType = syncType;
        this.direction = direction;
        this.triggeredBy = triggeredBy;
        this.syncLogId = null;
        this.stats = {
            totalItems: 0,
            processedItems: 0,
            successCount: 0,
            errorCount: 0,
            skipCount: 0
        };
    }

    async start(metadata = {}) {
        try {
            const pool = db.getPool();
            const [result] = await pool.execute(
                `INSERT INTO sync_log (sync_type, direction, status, triggered_by, metadata)
                 VALUES (?, ?, 'started', ?, ?)`,
                [this.syncType, this.direction, this.triggeredBy, JSON.stringify(metadata)]
            );
            this.syncLogId = result.insertId;

            logger.info('Sync started', {
                syncLogId: this.syncLogId,
                syncType: this.syncType,
                direction: this.direction
            });

            return this.syncLogId;
        } catch (error) {
            logger.error('Failed to start sync log', { error: error.message });
            throw error;
        }
    }

    async updateProgress(processedItems, totalItems = null) {
        if (!this.syncLogId) return;

        this.stats.processedItems = processedItems;
        if (totalItems !== null) {
            this.stats.totalItems = totalItems;
        }

        try {
            const pool = db.getPool();
            await pool.execute(
                `UPDATE sync_log
                 SET status = 'in_progress',
                     processed_items = ?,
                     total_items = ?,
                     success_count = ?,
                     error_count = ?,
                     skip_count = ?
                 WHERE id = ?`,
                [
                    this.stats.processedItems,
                    this.stats.totalItems,
                    this.stats.successCount,
                    this.stats.errorCount,
                    this.stats.skipCount,
                    this.syncLogId
                ]
            );
        } catch (error) {
            logger.error('Failed to update sync progress', { error: error.message });
        }
    }

    async logItem(itemType, hubspotId, rentmanId, action, status, options = {}) {
        if (!this.syncLogId) return null;

        const { errorMessage, errorCode, dataBefore, dataAfter } = options;

        if (status === 'success') {
            this.stats.successCount++;
        } else if (status === 'failed') {
            this.stats.errorCount++;
        } else if (status === 'skipped') {
            this.stats.skipCount++;
        }
        this.stats.processedItems++;

        try {
            const pool = db.getPool();
            const [result] = await pool.execute(
                `INSERT INTO sync_item_log
                 (sync_log_id, item_type, hubspot_id, rentman_id, action, status, error_message, error_code, data_before, data_after)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    this.syncLogId,
                    itemType,
                    hubspotId || null,
                    rentmanId || null,
                    action,
                    status,
                    errorMessage || null,
                    errorCode || null,
                    dataBefore ? JSON.stringify(dataBefore) : null,
                    dataAfter ? JSON.stringify(dataAfter) : null
                ]
            );

            return result.insertId;
        } catch (error) {
            logger.error('Failed to log sync item', { error: error.message });
            return null;
        }
    }

    async logError(errorType, severity, sourceSystem, errorMessage, options = {}) {
        const { errorCode, stackTrace, context, syncItemLogId } = options;

        try {
            const pool = db.getPool();
            await pool.execute(
                `INSERT INTO sync_errors
                 (sync_log_id, sync_item_log_id, error_type, severity, source_system, error_message, error_code, stack_trace, context)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    this.syncLogId,
                    syncItemLogId || null,
                    errorType,
                    severity,
                    sourceSystem,
                    errorMessage,
                    errorCode || null,
                    stackTrace || null,
                    context ? JSON.stringify(context) : null
                ]
            );

            logger.error('Sync error logged', {
                syncLogId: this.syncLogId,
                errorType,
                severity,
                sourceSystem,
                errorMessage
            });
        } catch (error) {
            logger.error('Failed to log sync error', { error: error.message });
        }
    }

    async complete(status = null) {
        if (!this.syncLogId) return;

        const finalStatus = status || (this.stats.errorCount > 0 ? 'partial' : 'completed');

        try {
            const pool = db.getPool();
            await pool.execute(
                `UPDATE sync_log
                 SET status = ?,
                     total_items = ?,
                     processed_items = ?,
                     success_count = ?,
                     error_count = ?,
                     skip_count = ?,
                     completed_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [
                    finalStatus,
                    this.stats.totalItems,
                    this.stats.processedItems,
                    this.stats.successCount,
                    this.stats.errorCount,
                    this.stats.skipCount,
                    this.syncLogId
                ]
            );

            await this.updateStatistics();

            logger.info('Sync completed', {
                syncLogId: this.syncLogId,
                status: finalStatus,
                stats: this.stats
            });
        } catch (error) {
            logger.error('Failed to complete sync log', { error: error.message });
        }
    }

    async fail(errorMessage) {
        if (!this.syncLogId) return;

        try {
            const pool = db.getPool();
            await pool.execute(
                `UPDATE sync_log
                 SET status = 'failed',
                     total_items = ?,
                     processed_items = ?,
                     success_count = ?,
                     error_count = ?,
                     skip_count = ?,
                     completed_at = CURRENT_TIMESTAMP,
                     metadata = JSON_SET(COALESCE(metadata, '{}'), '$.failureReason', ?)
                 WHERE id = ?`,
                [
                    this.stats.totalItems,
                    this.stats.processedItems,
                    this.stats.successCount,
                    this.stats.errorCount,
                    this.stats.skipCount,
                    errorMessage,
                    this.syncLogId
                ]
            );

            await this.updateStatistics();

            logger.error('Sync failed', {
                syncLogId: this.syncLogId,
                errorMessage,
                stats: this.stats
            });
        } catch (error) {
            logger.error('Failed to mark sync as failed', { error: error.message });
        }
    }

    async updateStatistics() {
        try {
            const pool = db.getPool();
            const today = new Date().toISOString().split('T')[0];

            await pool.execute(
                `INSERT INTO sync_statistics (date, sync_type, total_syncs, successful_syncs, failed_syncs, total_items_processed, total_errors)
                 VALUES (?, ?, 1, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                     total_syncs = total_syncs + 1,
                     successful_syncs = successful_syncs + VALUES(successful_syncs),
                     failed_syncs = failed_syncs + VALUES(failed_syncs),
                     total_items_processed = total_items_processed + VALUES(total_items_processed),
                     total_errors = total_errors + VALUES(total_errors)`,
                [
                    today,
                    this.syncType,
                    this.stats.errorCount === 0 ? 1 : 0,
                    this.stats.errorCount > 0 ? 1 : 0,
                    this.stats.processedItems,
                    this.stats.errorCount
                ]
            );
        } catch (error) {
            logger.error('Failed to update sync statistics', { error: error.message });
        }
    }

    getStats() {
        return { ...this.stats };
    }

    getSyncLogId() {
        return this.syncLogId;
    }
}

async function getRecentSyncLogs(limit = 50, syncType = null) {
    try {
        const pool = db.getPool();
        let query = `SELECT * FROM sync_log ORDER BY started_at DESC LIMIT ?`;
        let params = [limit];

        if (syncType) {
            query = `SELECT * FROM sync_log WHERE sync_type = ? ORDER BY started_at DESC LIMIT ?`;
            params = [syncType, limit];
        }

        const [rows] = await pool.execute(query, params);
        return rows;
    } catch (error) {
        logger.error('Failed to get recent sync logs', { error: error.message });
        return [];
    }
}

async function getSyncLogDetails(syncLogId) {
    try {
        const pool = db.getPool();

        const [[syncLog]] = await pool.execute(
            'SELECT * FROM sync_log WHERE id = ?',
            [syncLogId]
        );

        if (!syncLog) return null;

        const [items] = await pool.execute(
            'SELECT * FROM sync_item_log WHERE sync_log_id = ? ORDER BY created_at',
            [syncLogId]
        );

        const [errors] = await pool.execute(
            'SELECT * FROM sync_errors WHERE sync_log_id = ? ORDER BY created_at',
            [syncLogId]
        );

        return { syncLog, items, errors };
    } catch (error) {
        logger.error('Failed to get sync log details', { error: error.message });
        return null;
    }
}

async function getUnresolvedErrors(limit = 100) {
    try {
        const pool = db.getPool();
        const [rows] = await pool.execute(
            `SELECT e.*, sl.sync_type, sl.direction
             FROM sync_errors e
             LEFT JOIN sync_log sl ON e.sync_log_id = sl.id
             WHERE e.resolved = FALSE
             ORDER BY e.severity DESC, e.created_at DESC
             LIMIT ?`,
            [limit]
        );
        return rows;
    } catch (error) {
        logger.error('Failed to get unresolved errors', { error: error.message });
        return [];
    }
}

async function resolveError(errorId, resolvedBy = 'system') {
    try {
        const pool = db.getPool();
        await pool.execute(
            `UPDATE sync_errors
             SET resolved = TRUE, resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
             WHERE id = ?`,
            [resolvedBy, errorId]
        );
        return true;
    } catch (error) {
        logger.error('Failed to resolve error', { error: error.message });
        return false;
    }
}

async function getStatistics(days = 30) {
    try {
        const pool = db.getPool();
        const [rows] = await pool.execute(
            `SELECT * FROM sync_statistics
             WHERE date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
             ORDER BY date DESC, sync_type`,
            [days]
        );
        return rows;
    } catch (error) {
        logger.error('Failed to get statistics', { error: error.message });
        return [];
    }
}

module.exports = {
    SyncLogger,
    getRecentSyncLogs,
    getSyncLogDetails,
    getUnresolvedErrors,
    resolveError,
    getStatistics
};

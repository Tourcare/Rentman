const { createChildLogger } = require('../lib/logger');
const { SyncLogger, getRecentSyncLogs, getSyncLogDetails, getUnresolvedErrors, getStatistics } = require('./sync-logger');
const { syncCompanies, syncSingleCompany } = require('./sync-companies');
const { syncContacts, syncSingleContact } = require('./sync-contacts');
const { syncDeals, syncSingleDeal, syncDealFinancials } = require('./sync-deals');
const { syncOrders, syncSingleOrder, syncOrderFinancials } = require('./sync-orders');
const db = require('../lib/database');

const logger = createChildLogger('sync-coordinator');

let isSyncRunning = false;
let currentSyncType = null;

async function runFullSync(options = {}) {
    if (isSyncRunning) {
        logger.warn('Sync already running', { currentType: currentSyncType });
        return { error: 'Sync already running', currentType: currentSyncType };
    }

    const {
        direction = 'bidirectional',
        batchSize = 100,
        triggeredBy = 'system',
        syncTypes = ['company', 'contact', 'deal', 'order']
    } = options;

    const syncLogger = new SyncLogger('full', direction, triggeredBy);
    await syncLogger.start({ batchSize, syncTypes });

    isSyncRunning = true;
    currentSyncType = 'full';

    const results = {
        companies: null,
        contacts: null,
        deals: null,
        orders: null,
        errors: []
    };

    try {
        if (syncTypes.includes('company')) {
            logger.info('Starting company sync');
            currentSyncType = 'company';
            try {
                results.companies = await syncCompanies({ direction, batchSize, triggeredBy });
            } catch (error) {
                results.errors.push({ type: 'company', error: error.message });
                logger.error('Company sync failed', { error: error.message });
            }
        }

        if (syncTypes.includes('contact')) {
            logger.info('Starting contact sync');
            currentSyncType = 'contact';
            try {
                results.contacts = await syncContacts({ direction, batchSize, triggeredBy });
            } catch (error) {
                results.errors.push({ type: 'contact', error: error.message });
                logger.error('Contact sync failed', { error: error.message });
            }
        }

        if (syncTypes.includes('deal')) {
            logger.info('Starting deal sync');
            currentSyncType = 'deal';
            try {
                results.deals = await syncDeals({ direction, batchSize, triggeredBy });
            } catch (error) {
                results.errors.push({ type: 'deal', error: error.message });
                logger.error('Deal sync failed', { error: error.message });
            }
        }

        if (syncTypes.includes('order')) {
            logger.info('Starting order sync');
            currentSyncType = 'order';
            try {
                results.orders = await syncOrders({ direction, batchSize, triggeredBy });
            } catch (error) {
                results.errors.push({ type: 'order', error: error.message });
                logger.error('Order sync failed', { error: error.message });
            }
        }

        const totalStats = calculateTotalStats(results);
        syncLogger.stats = totalStats;

        if (results.errors.length > 0) {
            await syncLogger.complete('partial');
        } else {
            await syncLogger.complete();
        }

        logger.info('Full sync completed', {
            syncLogId: syncLogger.getSyncLogId(),
            results: totalStats,
            errors: results.errors.length
        });

        return {
            syncLogId: syncLogger.getSyncLogId(),
            results,
            stats: totalStats
        };
    } catch (error) {
        await syncLogger.fail(error.message);
        throw error;
    } finally {
        isSyncRunning = false;
        currentSyncType = null;
    }
}

function calculateTotalStats(results) {
    const stats = {
        totalItems: 0,
        processedItems: 0,
        successCount: 0,
        errorCount: 0,
        skipCount: 0
    };

    for (const key of ['companies', 'contacts', 'deals', 'orders']) {
        if (results[key]) {
            stats.totalItems += results[key].totalItems || 0;
            stats.processedItems += results[key].processedItems || 0;
            stats.successCount += results[key].successCount || 0;
            stats.errorCount += results[key].errorCount || 0;
            stats.skipCount += results[key].skipCount || 0;
        }
    }

    return stats;
}

async function runSingleTypeSync(syncType, options = {}) {
    if (isSyncRunning) {
        logger.warn('Sync already running', { currentType: currentSyncType });
        return { error: 'Sync already running', currentType: currentSyncType };
    }

    isSyncRunning = true;
    currentSyncType = syncType;

    try {
        let result;
        switch (syncType) {
            case 'company':
                result = await syncCompanies(options);
                break;
            case 'contact':
                result = await syncContacts(options);
                break;
            case 'deal':
                result = await syncDeals(options);
                break;
            case 'order':
                result = await syncOrders(options);
                break;
            default:
                throw new Error(`Unknown sync type: ${syncType}`);
        }

        logger.info('Single type sync completed', { syncType, stats: result });
        return result;
    } finally {
        isSyncRunning = false;
        currentSyncType = null;
    }
}

async function getSyncStatus() {
    const recentLogs = await getRecentSyncLogs(10);
    const unresolvedErrors = await getUnresolvedErrors(20);
    const statistics = await getStatistics(7);

    return {
        isRunning: isSyncRunning,
        currentType: currentSyncType,
        recentSyncs: recentLogs,
        unresolvedErrors,
        weeklyStats: statistics
    };
}

async function getSyncHistory(options = {}) {
    const { limit = 50, syncType = null } = options;
    return getRecentSyncLogs(limit, syncType);
}

async function getSyncDetails(syncLogId) {
    return getSyncLogDetails(syncLogId);
}

async function getErrors(options = {}) {
    const { limit = 100, resolved = false } = options;

    if (resolved) {
        const pool = db.getPool();
        const [rows] = await pool.execute(
            `SELECT e.*, sl.sync_type, sl.direction
             FROM sync_errors e
             LEFT JOIN sync_log sl ON e.sync_log_id = sl.id
             ORDER BY e.created_at DESC
             LIMIT ?`,
            [limit]
        );
        return rows;
    }

    return getUnresolvedErrors(limit);
}

async function resolveError(errorId, resolvedBy = 'system') {
    const { resolveError: resolve } = require('./sync-logger');
    return resolve(errorId, resolvedBy);
}

async function getDashboardSummary() {
    const status = await getSyncStatus();
    const stats = await getStatistics(30);

    const summary = {
        currentStatus: {
            isRunning: status.isRunning,
            currentType: status.currentType
        },
        lastSync: status.recentSyncs[0] || null,
        unresolvedErrorCount: status.unresolvedErrors.length,
        criticalErrors: status.unresolvedErrors.filter(e => e.severity === 'critical' || e.severity === 'high'),
        monthlyStats: aggregateStatistics(stats)
    };

    return summary;
}

function aggregateStatistics(stats) {
    const aggregated = {
        totalSyncs: 0,
        successfulSyncs: 0,
        failedSyncs: 0,
        totalItemsProcessed: 0,
        totalErrors: 0,
        byType: {}
    };

    for (const stat of stats) {
        aggregated.totalSyncs += stat.total_syncs || 0;
        aggregated.successfulSyncs += stat.successful_syncs || 0;
        aggregated.failedSyncs += stat.failed_syncs || 0;
        aggregated.totalItemsProcessed += stat.total_items_processed || 0;
        aggregated.totalErrors += stat.total_errors || 0;

        if (!aggregated.byType[stat.sync_type]) {
            aggregated.byType[stat.sync_type] = {
                totalSyncs: 0,
                successfulSyncs: 0,
                failedSyncs: 0
            };
        }
        aggregated.byType[stat.sync_type].totalSyncs += stat.total_syncs || 0;
        aggregated.byType[stat.sync_type].successfulSyncs += stat.successful_syncs || 0;
        aggregated.byType[stat.sync_type].failedSyncs += stat.failed_syncs || 0;
    }

    return aggregated;
}

module.exports = {
    runFullSync,
    runSingleTypeSync,

    syncCompanies,
    syncContacts,
    syncDeals,
    syncOrders,

    syncSingleCompany,
    syncSingleContact,
    syncSingleDeal,
    syncSingleOrder,

    syncDealFinancials,
    syncOrderFinancials,

    getSyncStatus,
    getSyncHistory,
    getSyncDetails,
    getErrors,
    resolveError,
    getDashboardSummary,

    get isRunning() {
        return isSyncRunning;
    },
    get currentType() {
        return currentSyncType;
    }
};

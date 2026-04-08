/**
 * Daglig grænse for Rentman API kald fra sync-processer.
 *
 * Rentman tillader 50.000 req/dag. Vi reserverer en del til webhooks/integration
 * og begrænser sync til DAILY_LIMIT.
 *
 * Tæller gemmes i sync_daily_usage tabellen (atomisk increment).
 * In-memory cache for performance, flusher delta til DB periodisk.
 */

const { createChildLogger } = require('./logger');
const db = require('./database');

const logger = createChildLogger('sync-daily-limit');

const DAILY_LIMIT = 45_000;
const FLUSH_INTERVAL = 50;

let _syncMode = false;
let _cachedCount = 0;
let _pendingDelta = 0;
let _initialized = false;

function getToday() {
    return new Date().toISOString().slice(0, 10);
}

async function _init() {
    if (_initialized) return;
    try {
        await db.ensureSyncDailyTable();
        _cachedCount = await db.getSyncDailyCount(getToday());
        _initialized = true;
    } catch (err) {
        logger.warn('Kunne ikke initialisere sync-tæller fra DB', { error: err.message });
    }
}

async function _flush() {
    if (_pendingDelta === 0) return;
    try {
        await db.incrementSyncDailyCount(getToday(), _pendingDelta);
        _pendingDelta = 0;
    } catch (err) {
        logger.warn('Kunne ikke flushe sync-tæller til DB', { error: err.message });
    }
}

function increment(n = 1) {
    _cachedCount += n;
    _pendingDelta += n;

    if (_pendingDelta >= FLUSH_INTERVAL || _cachedCount >= DAILY_LIMIT) {
        _flush().catch(() => {});
    }

    return _cachedCount;
}

function canProceed(n = 1) {
    return _cachedCount + n <= DAILY_LIMIT;
}

function getRemaining() {
    return Math.max(0, DAILY_LIMIT - _cachedCount);
}

function getCount() {
    return _cachedCount;
}

async function enterSyncMode() {
    await _init();
    _syncMode = true;
    logger.info(`Sync mode aktiveret. Dagligt forbrug: ${_cachedCount}/${DAILY_LIMIT} (${getRemaining()} tilbage)`);
}

async function exitSyncMode() {
    _syncMode = false;
    await _flush();
    logger.info(`Sync mode deaktiveret. Dagligt forbrug: ${_cachedCount}/${DAILY_LIMIT}`);
}

function isSyncMode() {
    return _syncMode;
}

module.exports = {
    increment,
    canProceed,
    getRemaining,
    getCount,
    enterSyncMode,
    exitSyncMode,
    isSyncMode,
    DAILY_LIMIT
};

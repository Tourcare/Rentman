/**
 * Database Module
 *
 * Håndterer al database kommunikation med MySQL.
 * Bruger to connection pools:
 * - mainPool: Til sync tracking (synced_companies, synced_deals, etc.)
 * - dashboardPool: Til dashboard/planlægning (project_with_sp)
 *
 * Hovedfunktioner:
 * - query(): Generel SQL query
 * - queryDashboard(): Query til dashboard database
 *
 * Sync tracking funktioner:
 * - findSynced, upsertSynced, deleteSynced for companies, contacts, deals, orders
 * - Holder styr på mappings mellem Rentman og HubSpot IDs
 *
 * Dashboard funktioner:
 * - upsertDashboardSubproject(): Opdaterer planlægningsoversigt
 * - deleteDashboardSubproject(): Fjerner fra planlægning
 */

const mysql = require('mysql2/promise');
const config = require('../config');
const { createChildLogger } = require('./logger');

const logger = createChildLogger('database');

// Connection pools - oprettes ved modul load
const mainPool = mysql.createPool(config.database.main);
const dashboardPool = mysql.createPool(config.database.dashboard);

// Cache til synced users (5 min TTL)
let syncedUsersCache = null;
let usersCacheTimestamp = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

// =============================================================================
// Base query funktioner
// =============================================================================

/**
 * Udfører en SQL query med parametre og logging.
 */
async function query(sql, params = [], pool = mainPool) {
    const start = Date.now();
    try {
        const [rows] = await pool.execute(sql, params);
        logger.dbQuery('query', sql.split(' ')[0], Date.now() - start);
        return rows;
    } catch (error) {
        logger.dbError('query', sql.split(' ')[0], error, { sql, params });
        throw error;
    }
}

/**
 * Udfører query mod dashboard databasen.
 */
async function queryDashboard(sql, params = []) {
    return query(sql, params, dashboardPool);
}

// =============================================================================
// Synced Users (cached)
// =============================================================================

/**
 * Henter synced users med caching (5 min TTL).
 */
async function getSyncedUsers(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && syncedUsersCache && usersCacheTimestamp && (now - usersCacheTimestamp < CACHE_TTL_MS)) {
        return syncedUsersCache;
    }

    const users = await query('SELECT * FROM synced_users');
    syncedUsersCache = users;
    usersCacheTimestamp = now;
    return users;
}

// =============================================================================
// Synced Companies - mapper Rentman contacts til HubSpot companies
// =============================================================================

async function findSyncedCompanyByHubspotId(hubspotId) {
    const rows = await query('SELECT * FROM synced_companies WHERE hubspot_id = ?', [hubspotId]);
    return rows[0] || null;
}

async function findSyncedCompanyByRentmanId(rentmanId) {
    const rows = await query('SELECT * FROM synced_companies WHERE rentman_id = ?', [rentmanId]);
    return rows[0] || null;
}

async function findSyncedCompanyByName(name) {
    const rows = await query('SELECT * FROM synced_companies WHERE name = ?', [name]);
    return rows[0] || null;
}

async function upsertSyncedCompany(name, rentmanId, hubspotId) {
    await query(
        'INSERT INTO synced_companies (name, rentman_id, hubspot_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), hubspot_id=VALUES(hubspot_id)',
        [name, rentmanId, hubspotId]
    );
    return findSyncedCompanyByRentmanId(rentmanId);
}

async function updateSyncedCompanyName(hubspotId, name) {
    await query('UPDATE synced_companies SET name = ? WHERE hubspot_id = ?', [name, hubspotId]);
}

async function deleteSyncedCompany(rentmanId) {
    await query('DELETE FROM synced_companies WHERE rentman_id = ?', [rentmanId]);
}

// =============================================================================
// Synced Contacts - mapper Rentman contactpersons til HubSpot contacts
// =============================================================================

async function findSyncedContactByHubspotId(hubspotId) {
    const rows = await query('SELECT * FROM synced_contacts WHERE hubspot_id = ?', [hubspotId]);
    return rows[0] || null;
}

async function findSyncedContactByRentmanId(rentmanId) {
    const rows = await query('SELECT * FROM synced_contacts WHERE rentman_id = ?', [rentmanId]);
    return rows[0] || null;
}

async function findSyncedContactByHubspotIdAndCompany(hubspotId, companyHubspotId) {
    const rows = await query(
        'SELECT * FROM synced_contacts WHERE hubspot_id = ? AND hubspot_company_conntected = ?',
        [hubspotId, companyHubspotId]
    );
    return rows[0] || null;
}

async function upsertSyncedContact(name, rentmanId, hubspotId, companyHubspotId) {
    await query(
        'INSERT INTO synced_contacts (name, rentman_id, hubspot_id, hubspot_company_conntected) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), hubspot_id=VALUES(hubspot_id)',
        [name, rentmanId, hubspotId, companyHubspotId]
    );
}

async function insertSyncedContact(name, rentmanId, hubspotId, companyHubspotId) {
    await query(
        'INSERT INTO synced_contacts (name, rentman_id, hubspot_id, hubspot_company_conntected) VALUES (?, ?, ?, ?)',
        [name, rentmanId, hubspotId, companyHubspotId]
    );
}

async function updateSyncedContactName(rentmanId, name) {
    await query('UPDATE synced_contacts SET name = ? WHERE rentman_id = ?', [name, rentmanId]);
}

async function deleteSyncedContact(rentmanId) {
    await query('DELETE FROM synced_contacts WHERE rentman_id = ?', [rentmanId]);
}

async function deleteSyncedContactByHubspotIdAndCompany(hubspotId, companyHubspotId) {
    await query(
        'DELETE FROM synced_contacts WHERE hubspot_id = ? AND hubspot_company_conntected = ?',
        [hubspotId, companyHubspotId]
    );
}

// =============================================================================
// Synced Deals - mapper Rentman projects til HubSpot deals
// =============================================================================

async function findSyncedDealByHubspotId(hubspotId) {
    const rows = await query('SELECT * FROM synced_deals WHERE hubspot_project_id = ?', [hubspotId]);
    return rows[0] || null;
}

async function findSyncedDealByRentmanId(rentmanId) {
    const rows = await query('SELECT * FROM synced_deals WHERE rentman_project_id = ?', [rentmanId]);
    return rows[0] || null;
}

async function insertSyncedDeal(projectName, rentmanId, hubspotId, companyId = 0, contactId = 0) {
    await query(
        'INSERT INTO synced_deals (project_name, rentman_project_id, hubspot_project_id, synced_companies_id, synced_contact_id) VALUES (?, ?, ?, ?, ?)',
        [projectName || '', rentmanId || 0, hubspotId || 0, companyId || 0, contactId || 0]
    );
    return findSyncedDealByRentmanId(rentmanId);
}

async function updateSyncedDealCompany(hubspotId, companyId) {
    await query('UPDATE synced_deals SET synced_companies_id = ? WHERE hubspot_project_id = ?', [companyId, hubspotId]);
}

async function updateSyncedDealContact(hubspotId, contactId) {
    await query('UPDATE synced_deals SET synced_contact_id = ? WHERE hubspot_project_id = ?', [contactId, hubspotId]);
}

// =============================================================================
// Synced Orders - mapper Rentman subprojects til HubSpot orders
// =============================================================================

async function findSyncedOrderByRentmanId(rentmanSubprojectId) {
    const rows = await query('SELECT * FROM synced_order WHERE rentman_subproject_id = ?', [rentmanSubprojectId]);
    return rows[0] || null;
}

async function findSyncedOrderByHubspotId(hubspotOrderId) {
    const rows = await query('SELECT * FROM synced_order WHERE hubspot_order_id = ?', [hubspotOrderId]);
    return rows[0] || null;
}

async function insertSyncedOrder(name, rentmanSubprojectId, hubspotOrderId, companyId, contactId, dealId) {
    await query(
        'INSERT IGNORE INTO synced_order (subproject_name, rentman_subproject_id, hubspot_order_id, synced_companies_id, synced_contact_id, synced_deals_id) VALUES (?, ?, ?, ?, ?, ?)',
        [name || '', rentmanSubprojectId || 0, hubspotOrderId || 0, companyId || 0, contactId || 0, dealId || 0]
    );
}

async function updateSyncedOrderName(rentmanSubprojectId, name) {
    await query('UPDATE synced_order SET subproject_name = ? WHERE rentman_subproject_id = ?', [name, rentmanSubprojectId]);
}

/**
 * Finder HubSpot deal ID for en order via join.
 */
async function getHubspotDealIdForOrder(rentmanSubprojectId) {
    const rows = await query(`
        SELECT deals.hubspot_project_id
        FROM synced_order AS od
        JOIN synced_deals AS deals ON od.synced_deals_id = deals.id
        WHERE od.rentman_subproject_id = ?
    `, [rentmanSubprojectId]);
    return rows[0]?.hubspot_project_id || null;
}


// =============================================================================
// Line Items - Opretter en line item
// =============================================================================

async function insertLineItemForOrder(type, lineItemId, dbOrderId) {
    await query(
        'INSERT INTO order_line_items (type, hubspot_line_item_id, synced_order_id) VALUES (?, ?, ?)',
        [type, lineItemId, dbOrderId]
    );
}

async function deleteLineItemFromOrder(lineItemId) {
    await query('DELETE FROM order_line_items WHERE hubspot_line_item_id = ?', [lineItemId])
}

// =============================================================================
// Price Line Items - tracker prisberegnings-line items for deals og orders
// =============================================================================

async function upsertPriceLineItem(hubspotLineItemId, lineItemType, parentType, rentmanProjectId, rentmanSubprojectId, hubspotParentId, price) {
    await query(
        `INSERT INTO price_line_items (hubspot_line_item_id, line_item_type, parent_type, rentman_project_id, rentman_subproject_id, hubspot_parent_id, price)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE hubspot_line_item_id = VALUES(hubspot_line_item_id), price = VALUES(price), updated_at = NOW()`,
        [hubspotLineItemId, lineItemType, parentType, rentmanProjectId, rentmanSubprojectId || null, hubspotParentId, price]
    );
}

async function findPriceLineItemsByProject(rentmanProjectId, parentType = 'deal') {
    return query(
        'SELECT * FROM price_line_items WHERE rentman_project_id = ? AND parent_type = ?',
        [rentmanProjectId, parentType]
    );
}

async function findPriceLineItemsBySubproject(rentmanSubprojectId) {
    return query(
        'SELECT * FROM price_line_items WHERE rentman_subproject_id = ? AND parent_type = ?',
        [rentmanSubprojectId, 'order']
    );
}

async function findPriceLineItem(hubspotParentId, lineItemType, parentType) {
    const rows = await query(
        'SELECT * FROM price_line_items WHERE hubspot_parent_id = ? AND line_item_type = ? AND parent_type = ?',
        [hubspotParentId, lineItemType, parentType]
    );
    return rows[0] || null;
}

async function deletePriceLineItem(hubspotLineItemId) {
    await query('DELETE FROM price_line_items WHERE hubspot_line_item_id = ?', [hubspotLineItemId]);
}

async function deletePriceLineItemsByParent(hubspotParentId, parentType) {
    await query('DELETE FROM price_line_items WHERE hubspot_parent_id = ? AND parent_type = ?', [hubspotParentId, parentType]);
}

// =============================================================================
// Synced Requests - mapper HubSpot deals til Rentman rental requests
// =============================================================================

async function findSyncedRequestByHubspotDealId(hubspotDealId) {
    const rows = await query('SELECT * FROM synced_request WHERE hubspot_deal_id = ?', [hubspotDealId]);
    return rows[0] || null;
}

async function findSyncedRequestByRentmanId(rentmanRequestId) {
    const rows = await query('SELECT * FROM synced_request WHERE rentman_request_id = ?', [rentmanRequestId]);
    return rows[0] || null;
}

async function insertSyncedRequest(rentmanRequestId, hubspotDealId, companyId = 0) {
    await query(
        'INSERT INTO synced_request (rentman_request_id, hubspot_deal_id, synced_companies_id) VALUES (?, ?, ?)',
        [rentmanRequestId || 0, hubspotDealId || 0, companyId || 0]
    );
}

async function deleteSyncedRequest(rentmanRequestId) {
    await query('DELETE FROM synced_request WHERE rentman_request_id = ?', [rentmanRequestId]);
}

// =============================================================================
// Failed Requests - retry kø for HubSpot API fejl
// =============================================================================

async function insertFailedRequest(api, method, endpoint, body, errorMessage) {
    await query(
        'INSERT INTO failed_requests (api, method, endpoint, body, error_message) VALUES (?, ?, ?, ?, ?)',
        [api, method, endpoint, body ? JSON.stringify(body) : null, errorMessage]
    );
}

async function getFailedRequests(api) {
    return query('SELECT * FROM failed_requests WHERE api = ? ORDER BY created_at ASC', [api]);
}

async function updateFailedRequestRetry(id, errorMessage) {
    await query(
        'UPDATE failed_requests SET retry_count = retry_count + 1, last_retry_at = NOW(), error_message = ? WHERE id = ?',
        [errorMessage, id]
    );
}

async function deleteFailedRequest(id) {
    await query('DELETE FROM failed_requests WHERE id = ?', [id]);
}

// =============================================================================
// Circuit breaker
// =============================================================================

async function getCircuitBreaker(api) {
    const rows = await query('SELECT paused_until FROM circuit_breaker WHERE api = ?', [api]);
    return rows[0]?.paused_until || null;
}

async function setCircuitBreaker(api, pausedUntil) {
    await query(
        'INSERT INTO circuit_breaker (api, paused_until) VALUES (?, ?) ON DUPLICATE KEY UPDATE paused_until = ?',
        [api, pausedUntil, pausedUntil]
    );
}

async function clearCircuitBreaker(api) {
    await query('DELETE FROM circuit_breaker WHERE api = ?', [api]);
}

// =============================================================================
// Sync daglig grænse
// =============================================================================

async function ensureSyncDailyTable() {
    await query(`
        CREATE TABLE IF NOT EXISTS sync_daily_usage (
            date_key DATE PRIMARY KEY,
            call_count INT DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
}

async function getSyncDailyCount(dateKey) {
    const rows = await query('SELECT call_count FROM sync_daily_usage WHERE date_key = ?', [dateKey]);
    return rows[0]?.call_count || 0;
}

async function incrementSyncDailyCount(dateKey, n = 1) {
    await query(
        'INSERT INTO sync_daily_usage (date_key, call_count) VALUES (?, ?) ON DUPLICATE KEY UPDATE call_count = call_count + ?',
        [dateKey, n, n]
    );
}

// =============================================================================
// Dashboard funktioner - til planlægningsoversigt
// =============================================================================

/**
 * Opdaterer eller indsætter et subprojekt i dashboard databasen.
 * Bruges til planlægningsoversigten i eksternt dashboard.
 */
async function upsertDashboardSubproject(subprojectData, projectData) {
    const sp = subprojectData.data;
    const proj = projectData.data;

    const statusId = sp.status ? parseInt(sp.status.split('/').pop()) : 0;

    const formatDateTime = (dateString) => {
        if (!dateString) return null;
        const date = new Date(dateString);
        date.setHours(date.getHours() + 1); // Sommertid CEST (UTC+2)
        return date.toISOString().slice(0, 19).replace('T', ' ');
    };

    await queryDashboard(`
        INSERT INTO project_with_sp (
            project_name, project_id, mp_start_pp, mp_end_pp,
            subproject_name, subproject_id, sp_start_pp, sp_end_pp,
            sp_start_up, sp_end_up, sp_status, is_planning, wh_out, wh_in
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            project_name = VALUES(project_name),
            mp_start_pp = VALUES(mp_start_pp),
            mp_end_pp = VALUES(mp_end_pp),
            subproject_name = VALUES(subproject_name),
            sp_start_pp = VALUES(sp_start_pp),
            sp_end_pp = VALUES(sp_end_pp),
            sp_start_up = VALUES(sp_start_up),
            sp_end_up = VALUES(sp_end_up),
            sp_status = VALUES(sp_status),
            is_planning = VALUES(is_planning),
            wh_out = VALUES(wh_out),
            wh_in = VALUES(wh_in)
    `, [
        proj.name || '',
        proj.id,
        formatDateTime(proj.planperiod_start),
        formatDateTime(proj.planperiod_end),
        sp.name || '',
        sp.id,
        formatDateTime(sp.planperiod_start),
        formatDateTime(sp.planperiod_end),
        formatDateTime(sp.usageperiod_start),
        formatDateTime(sp.usageperiod_end),
        statusId,
        sp.in_planning ? 1 : 0,
        sp.custom?.custom_11 || null,
        sp.custom?.custom_12 || null
    ]);
}

async function deleteDashboardSubproject(subprojectId) {
    await queryDashboard('DELETE FROM project_with_sp WHERE subproject_id = ?', [subprojectId]);
}

// =============================================================================
// Hjælpefunktioner
// =============================================================================

/**
 * Kører en operation med retry ved fejl.
 */
async function withRetry(operation, maxRetries = 3, delayMs = 3000) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const result = await operation();
            if (result !== null && result !== undefined) {
                return result;
            }
        } catch (error) {
            lastError = error;
        }

        if (i < maxRetries - 1) {
            logger.debug(`Forsog ${i + 1} fejlede, venter ${delayMs}ms for retry...`);
            await new Promise(r => setTimeout(r, delayMs));
        }
    }

    return null;
}

/**
 * Returnerer main database pool.
 * Bruges af error-logger til direkte database adgang.
 */
function getPool() {
    return mainPool;
}

/**
 * Returnerer dashboard database pool.
 */
function getDashboardPool() {
    return dashboardPool;
}

// =============================================================================
// Simple add funktioner (til sync scripts)
// =============================================================================

async function addSyncedCompany(rentmanId, hubspotId) {
    await query(
        'INSERT INTO synced_companies (rentman_id, hubspot_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE hubspot_id = VALUES(hubspot_id)',
        [rentmanId, hubspotId]
    );
    return findSyncedCompanyByRentmanId(rentmanId);
}

async function addSyncedContact(rentmanId, hubspotId) {
    await query(
        'INSERT INTO synced_contacts (rentman_id, hubspot_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE hubspot_id = VALUES(hubspot_id)',
        [rentmanId, hubspotId]
    );
    return findSyncedContactByRentmanId(rentmanId);
}

async function addSyncedDeal(rentmanId, hubspotId) {
    await query(
        'INSERT INTO synced_deals (rentman_project_id, hubspot_project_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE hubspot_project_id = VALUES(hubspot_project_id)',
        [rentmanId, hubspotId]
    );
    return findSyncedDealByRentmanId(rentmanId);
}

async function addSyncedOrder(rentmanSubprojectId, hubspotOrderId, hubspotDealId) {
    const dealSync = await findSyncedDealByHubspotId(hubspotDealId);
    await query(
        'INSERT INTO synced_order (rentman_subproject_id, hubspot_order_id, synced_deals_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE hubspot_order_id = VALUES(hubspot_order_id)',
        [rentmanSubprojectId, hubspotOrderId, dealSync?.id || 0]
    );
    return findSyncedOrderByRentmanId(rentmanSubprojectId);
}

/**
 * Finder alle orders tilknyttet en deal.
 */
async function findSyncedOrdersByDealId(hubspotDealId) {
    const dealSync = await findSyncedDealByHubspotId(hubspotDealId);
    if (!dealSync) return [];

    const rows = await query('SELECT * FROM synced_order WHERE synced_deals_id = ?', [dealSync.id]);
    return rows;
}

async function deleteSyncedOrder(rentmanSubprojectId) {
    await query('DELETE FROM synced_order WHERE rentman_subproject_id = ?', [rentmanSubprojectId]);
}

async function deleteSyncedDeal(rentmanProjectId) {
    await query('DELETE FROM synced_deals WHERE rentman_project_id = ?', [rentmanProjectId]);
}

// =============================================================================
// Project Equipment / Functions / Costs / Crew / Subprojects
// =============================================================================
// Disse tabeller lever nu kun i rentman_data databasen og populeres af
// webhooks/services/rentman-save-all.js (saveWebhookToDb) og sync/sync-rentman-db.js.
// crm_sync skal ikke skrive til dem. Læsninger fra sync/sync-prices.js og
// sync/sync-line-items.js sker via lib/rentman-db.js.


/**
 * Lukker database forbindelser gracefully.
 * Kaldes ved server shutdown.
 */
async function shutdown() {
    logger.info('Lukker database forbindelser...');
    await mainPool.end();
    await dashboardPool.end();
    logger.info('Database forbindelser lukket');
}

module.exports = {
    query,
    queryDashboard,
    getPool,
    getDashboardPool,
    getSyncedUsers,

    findSyncedCompanyByHubspotId,
    findSyncedCompanyByRentmanId,
    findSyncedCompanyByName,
    upsertSyncedCompany,
    addSyncedCompany,
    updateSyncedCompanyName,
    deleteSyncedCompany,

    findSyncedContactByHubspotId,
    findSyncedContactByRentmanId,
    findSyncedContactByHubspotIdAndCompany,
    upsertSyncedContact,
    insertSyncedContact,
    addSyncedContact,
    updateSyncedContactName,
    deleteSyncedContact,
    deleteSyncedContactByHubspotIdAndCompany,

    findSyncedDealByHubspotId,
    findSyncedDealByRentmanId,
    insertSyncedDeal,
    addSyncedDeal,
    updateSyncedDealCompany,
    updateSyncedDealContact,
    deleteSyncedDeal,

    findSyncedOrderByRentmanId,
    findSyncedOrderByHubspotId,
    findSyncedOrdersByDealId,
    insertSyncedOrder,
    addSyncedOrder,
    updateSyncedOrderName,
    getHubspotDealIdForOrder,
    deleteSyncedOrder,

    insertLineItemForOrder,
    deleteLineItemFromOrder,

    upsertPriceLineItem,
    findPriceLineItemsByProject,
    findPriceLineItemsBySubproject,
    findPriceLineItem,
    deletePriceLineItem,
    deletePriceLineItemsByParent,

    findSyncedRequestByHubspotDealId,
    findSyncedRequestByRentmanId,
    insertSyncedRequest,
    deleteSyncedRequest,

    upsertDashboardSubproject,
    deleteDashboardSubproject,

    insertFailedRequest,
    getFailedRequests,
    updateFailedRequestRetry,
    deleteFailedRequest,

    getCircuitBreaker,
    setCircuitBreaker,
    clearCircuitBreaker,

    ensureSyncDailyTable,
    getSyncDailyCount,
    incrementSyncDailyCount,

    withRetry,
    shutdown
};

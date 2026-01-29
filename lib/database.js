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

async function insertSyncedDeal(projectName, rentmanId, hubspotId, companyId = null, contactId = null) {
    await query(
        'INSERT INTO synced_deals (project_name, rentman_project_id, hubspot_project_id, synced_companies_id, synced_contact_id) VALUES (?, ?, ?, ?, ?)',
        [projectName, rentmanId, hubspotId, companyId, contactId]
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
        'INSERT INTO synced_order (subproject_name, rentman_subproject_id, hubspot_order_id, synced_companies_id, synced_contact_id, synced_deals_id) VALUES (?, ?, ?, ?, ?, ?)',
        [name, rentmanSubprojectId, hubspotOrderId, companyId, contactId, dealId]
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

async function insertSyncedRequest(rentmanRequestId, hubspotDealId, companyId = null) {
    await query(
        'INSERT INTO synced_request (rentman_request_id, hubspot_deal_id, synced_companies_id) VALUES (?, ?, ?)',
        [rentmanRequestId, hubspotDealId, companyId]
    );
}

async function deleteSyncedRequest(rentmanRequestId) {
    await query('DELETE FROM synced_request WHERE rentman_request_id = ?', [rentmanRequestId]);
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
        [rentmanSubprojectId, hubspotOrderId, dealSync?.id || null]
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
// Project Equipment - synkroniserer Rentman projectequipment
// =============================================================================

const formatDateTime = (dateString) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toISOString().slice(0, 19).replace('T', ' ');
};

async function upsertProjectEquipment(data) {
    await query(`
        INSERT INTO project_equipment (
            id, created, modified, creator, displayname, equipment, parent, ledger,
            quantity, quantity_total, equipment_group, discount, is_option, factor,
            \`order\`, unit_price, name, external_remark, internal_remark, delay_notified,
            planperiod_start, planperiod_end, has_missings, warehouse_reservations,
            subrent_reservations, serial_number_ids
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            modified = VALUES(modified),
            creator = VALUES(creator),
            displayname = VALUES(displayname),
            equipment = VALUES(equipment),
            parent = VALUES(parent),
            ledger = VALUES(ledger),
            quantity = VALUES(quantity),
            quantity_total = VALUES(quantity_total),
            equipment_group = VALUES(equipment_group),
            discount = VALUES(discount),
            is_option = VALUES(is_option),
            factor = VALUES(factor),
            \`order\` = VALUES(\`order\`),
            unit_price = VALUES(unit_price),
            name = VALUES(name),
            external_remark = VALUES(external_remark),
            internal_remark = VALUES(internal_remark),
            delay_notified = VALUES(delay_notified),
            planperiod_start = VALUES(planperiod_start),
            planperiod_end = VALUES(planperiod_end),
            has_missings = VALUES(has_missings),
            warehouse_reservations = VALUES(warehouse_reservations),
            subrent_reservations = VALUES(subrent_reservations),
            serial_number_ids = VALUES(serial_number_ids)
    `, [
        data.id,
        formatDateTime(data.created),
        formatDateTime(data.modified),
        data.creator || null,
        data.displayname || null,
        data.equipment || null,
        data.parent || null,
        data.ledger || null,
        data.quantity || null,
        data.quantity_total || null,
        data.equipment_group || null,
        data.discount || null,
        data.is_option ? 1 : 0,
        data.factor || null,
        data.order || null,
        data.unit_price || null,
        data.name || null,
        data.external_remark || null,
        data.internal_remark || null,
        data.delay_notified ? 1 : 0,
        formatDateTime(data.planperiod_start),
        formatDateTime(data.planperiod_end),
        data.has_missings ? 1 : 0,
        data.warehouse_reservations || null,
        data.subrent_reservations || null,
        data.serial_number_ids || null
    ]);
}

async function deleteProjectEquipment(id) {
    await query('DELETE FROM project_equipment WHERE id = ?', [id]);
}

// =============================================================================
// Project Equipment Group - synkroniserer Rentman projectequipmentgroup
// =============================================================================

async function upsertProjectEquipmentGroup(data) {
    await query(`
        INSERT INTO project_equipment_group (
            id, created, modified, creator, displayname, project, subproject,
            additional_scanned, name, usageperiod_start, usageperiod_end, duration,
            planperiod_start, planperiod_end, is_delayed, \`order\`, in_price_calculation,
            remark, weight, power, \`current\`, volume, total_new_price
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            modified = VALUES(modified),
            creator = VALUES(creator),
            displayname = VALUES(displayname),
            project = VALUES(project),
            subproject = VALUES(subproject),
            additional_scanned = VALUES(additional_scanned),
            name = VALUES(name),
            usageperiod_start = VALUES(usageperiod_start),
            usageperiod_end = VALUES(usageperiod_end),
            duration = VALUES(duration),
            planperiod_start = VALUES(planperiod_start),
            planperiod_end = VALUES(planperiod_end),
            is_delayed = VALUES(is_delayed),
            \`order\` = VALUES(\`order\`),
            in_price_calculation = VALUES(in_price_calculation),
            remark = VALUES(remark),
            weight = VALUES(weight),
            power = VALUES(power),
            \`current\` = VALUES(\`current\`),
            volume = VALUES(volume),
            total_new_price = VALUES(total_new_price)
    `, [
        data.id,
        formatDateTime(data.created),
        formatDateTime(data.modified),
        data.creator || null,
        data.displayname || null,
        data.project || null,
        data.subproject || null,
        data.additional_scanned ? 1 : 0,
        data.name || null,
        formatDateTime(data.usageperiod_start),
        formatDateTime(data.usageperiod_end),
        data.duration || null,
        formatDateTime(data.planperiod_start),
        formatDateTime(data.planperiod_end),
        data.is_delayed ? 1 : 0,
        data.order || null,
        data.in_price_calculation ? 1 : 0,
        data.remark || null,
        data.weight || null,
        data.power || null,
        data.current || null,
        data.volume || null,
        data.total_new_price || null
    ]);
}

async function deleteProjectEquipmentGroup(id) {
    await query('DELETE FROM project_equipment_group WHERE id = ?', [id]);
}

// =============================================================================
// Subprojects - synkroniserer Rentman subprojects
// =============================================================================

async function upsertSubproject(data) {
    await query(`
        INSERT INTO subprojects (
            id, created, modified, creator, displayname, project, \`order\`, name,
            status, is_template, location, loc_contact, insurance_rate,
            discount_rental, discount_sale, discount_crew, discount_transport,
            discount_additional_costs, discount_subproject, discount_fixed,
            discount_fixed_amount, fixed_price, in_planning, in_financial,
            asset_location_from, project_total_price, project_total_price_cancelled,
            project_rental_price, project_sale_price, project_crew_price,
            project_transport_price, project_other_price, project_insurance_price,
            already_invoiced, usageperiod_start, usageperiod_end, planperiod_start,
            planperiod_end, weight, power, \`current\`, purchasecosts, volume,
            equipment_period_from, equipment_period_to
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            modified = VALUES(modified),
            creator = VALUES(creator),
            displayname = VALUES(displayname),
            project = VALUES(project),
            \`order\` = VALUES(\`order\`),
            name = VALUES(name),
            status = VALUES(status),
            is_template = VALUES(is_template),
            location = VALUES(location),
            loc_contact = VALUES(loc_contact),
            insurance_rate = VALUES(insurance_rate),
            discount_rental = VALUES(discount_rental),
            discount_sale = VALUES(discount_sale),
            discount_crew = VALUES(discount_crew),
            discount_transport = VALUES(discount_transport),
            discount_additional_costs = VALUES(discount_additional_costs),
            discount_subproject = VALUES(discount_subproject),
            discount_fixed = VALUES(discount_fixed),
            discount_fixed_amount = VALUES(discount_fixed_amount),
            fixed_price = VALUES(fixed_price),
            in_planning = VALUES(in_planning),
            in_financial = VALUES(in_financial),
            asset_location_from = VALUES(asset_location_from),
            project_total_price = VALUES(project_total_price),
            project_total_price_cancelled = VALUES(project_total_price_cancelled),
            project_rental_price = VALUES(project_rental_price),
            project_sale_price = VALUES(project_sale_price),
            project_crew_price = VALUES(project_crew_price),
            project_transport_price = VALUES(project_transport_price),
            project_other_price = VALUES(project_other_price),
            project_insurance_price = VALUES(project_insurance_price),
            already_invoiced = VALUES(already_invoiced),
            usageperiod_start = VALUES(usageperiod_start),
            usageperiod_end = VALUES(usageperiod_end),
            planperiod_start = VALUES(planperiod_start),
            planperiod_end = VALUES(planperiod_end),
            weight = VALUES(weight),
            power = VALUES(power),
            \`current\` = VALUES(\`current\`),
            purchasecosts = VALUES(purchasecosts),
            volume = VALUES(volume),
            equipment_period_from = VALUES(equipment_period_from),
            equipment_period_to = VALUES(equipment_period_to)
    `, [
        data.id,
        formatDateTime(data.created),
        formatDateTime(data.modified),
        data.creator || null,
        data.displayname || null,
        data.project || null,
        data.order || null,
        data.name || null,
        data.status || null,
        data.is_template ? 1 : 0,
        data.location || null,
        data.loc_contact || null,
        data.insurance_rate || null,
        data.discount_rental || null,
        data.discount_sale || null,
        data.discount_crew || null,
        data.discount_transport || null,
        data.discount_additional_costs || null,
        data.discount_subproject || null,
        data.discount_fixed ? 1 : 0,
        data.discount_fixed_amount || null,
        data.fixed_price ? 1 : 0,
        data.in_planning ? 1 : 0,
        data.in_financial ? 1 : 0,
        data.asset_location_from || null,
        data.project_total_price || null,
        data.project_total_price_cancelled || null,
        data.project_rental_price || null,
        data.project_sale_price || null,
        data.project_crew_price || null,
        data.project_transport_price || null,
        data.project_other_price || null,
        data.project_insurance_price || null,
        data.already_invoiced || null,
        formatDateTime(data.usageperiod_start),
        formatDateTime(data.usageperiod_end),
        formatDateTime(data.planperiod_start),
        formatDateTime(data.planperiod_end),
        data.weight || null,
        data.power || null,
        data.current || null,
        data.purchasecosts || null,
        data.volume || null,
        formatDateTime(data.equipment_period_from),
        formatDateTime(data.equipment_period_to)
    ]);
}

async function deleteSubproject(id) {
    await query('DELETE FROM subprojects WHERE id = ?', [id]);
}

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

    findSyncedRequestByHubspotDealId,
    findSyncedRequestByRentmanId,
    insertSyncedRequest,
    deleteSyncedRequest,

    upsertDashboardSubproject,
    deleteDashboardSubproject,

    upsertProjectEquipment,
    deleteProjectEquipment,
    upsertProjectEquipmentGroup,
    deleteProjectEquipmentGroup,
    upsertSubproject,
    deleteSubproject,

    withRetry,
    shutdown
};

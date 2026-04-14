/**
 * Rentman Database Module
 *
 * Håndterer al database kommunikation med den dedikerede Rentman database.
 * Gemmer komplet data for alle Rentman item types modtaget via webhooks og sync.
 *
 * Bruger en generisk config-drevet tilgang:
 * - ITEM_TYPES definerer tabel, endpoint og kolonner for hver type
 * - upsertItem() bygger SQL dynamisk fra config
 * - deleteItem() sletter fra korrekt tabel
 */

const mysql = require('mysql2/promise');
const config = require('../config');
const { createChildLogger } = require('./logger');

const logger = createChildLogger('rentman-db');

const pool = mysql.createPool(config.database.rentman);

// =============================================================================
// Hjælpefunktioner
// =============================================================================

async function query(sql, params = []) {
    const start = Date.now();
    try {
        const [rows] = await pool.query(sql, params);
        logger.dbQuery('rentman-db', sql.split(' ')[0], Date.now() - start);
        return rows;
    } catch (error) {
        logger.dbError('rentman-db', sql.split(' ')[0], error, { sql: sql.substring(0, 200) });
        throw error;
    }
}

const formatDateTime = (dateString) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 19).replace('T', ' ');
};

function formatValue(value, type) {
    if (value === undefined || value === null) return null;
    switch (type) {
        case 'datetime':
            return formatDateTime(value);
        case 'date':
            if (!value) return null;
            const d = new Date(value);
            return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
        case 'bool':
            return value ? 1 : 0;
        case 'json':
            return value ? JSON.stringify(value) : null;
        case 'int': {
            const n = parseInt(value, 10);
            return Number.isFinite(n) ? n : null;
        }
        case 'decimal': {
            const n = parseFloat(value);
            return Number.isFinite(n) ? n : null;
        }
        case 'text':
        case 'string':
        default:
            return value != null ? String(value) : null;
    }
}

// =============================================================================
// Item Type konfiguration
// Hver type definerer: tabel, API endpoint, og kolonner med typer
// Kolonne-format: [api_field_name, db_column_name, type]
// Hvis db_column_name er null, bruges api_field_name
// =============================================================================

const ITEM_TYPES = {
    Project: {
        table: 'projects',
        endpoint: '/projects',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['location', null, 'string'], ['refundabledeposit', null, 'decimal'], ['deposit_status', null, 'string'],
            ['customer', null, 'string'], ['loc_contact', null, 'string'], ['cust_contact', null, 'string'],
            ['project_type', null, 'string'], ['name', null, 'string'], ['reference', null, 'string'], ['number', null, 'string'],
            ['account_manager', null, 'string'], ['color', null, 'string'], ['conditions', null, 'text'],
            ['project_total_price', null, 'decimal'], ['project_total_price_cancelled', null, 'decimal'],
            ['project_rental_price', null, 'decimal'], ['project_sale_price', null, 'decimal'],
            ['project_crew_price', null, 'decimal'], ['project_transport_price', null, 'decimal'],
            ['project_other_price', null, 'decimal'], ['project_insurance_price', null, 'decimal'],
            ['already_invoiced', null, 'decimal'], ['tags', null, 'text'],
            ['usageperiod_start', null, 'datetime'], ['usageperiod_end', null, 'datetime'],
            ['planperiod_start', null, 'datetime'], ['planperiod_end', null, 'datetime'],
            ['weight', null, 'decimal'], ['power', null, 'decimal'], ['current', null, 'decimal'],
            ['equipment_period_from', null, 'datetime'], ['equipment_period_to', null, 'datetime'],
            ['purchasecosts', null, 'decimal'], ['volume', null, 'decimal'], ['custom', null, 'json']
        ]
    },
    Subproject: {
        table: 'subprojects',
        endpoint: '/subprojects',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['project', null, 'string'], ['order', null, 'string'], ['name', null, 'string'], ['status', null, 'string'],
            ['is_template', null, 'bool'], ['location', null, 'string'], ['loc_contact', null, 'string'],
            ['insurance_rate', null, 'decimal'], ['discount_rental', null, 'decimal'], ['discount_sale', null, 'decimal'],
            ['discount_crew', null, 'decimal'], ['discount_transport', null, 'decimal'],
            ['discount_additional_costs', null, 'decimal'], ['discount_subproject', null, 'decimal'],
            ['discount_fixed', null, 'bool'], ['discount_fixed_amount', null, 'decimal'],
            ['fixed_price', null, 'bool'], ['in_planning', null, 'bool'], ['in_financial', null, 'bool'],
            ['asset_location_from', null, 'string'],
            ['project_total_price', null, 'decimal'], ['project_total_price_cancelled', null, 'decimal'],
            ['project_rental_price', null, 'decimal'], ['project_sale_price', null, 'decimal'],
            ['project_crew_price', null, 'decimal'], ['project_transport_price', null, 'decimal'],
            ['project_other_price', null, 'decimal'], ['project_insurance_price', null, 'decimal'],
            ['already_invoiced', null, 'decimal'],
            ['usageperiod_start', null, 'datetime'], ['usageperiod_end', null, 'datetime'],
            ['planperiod_start', null, 'datetime'], ['planperiod_end', null, 'datetime'],
            ['weight', null, 'decimal'], ['power', null, 'decimal'], ['current', null, 'decimal'],
            ['purchasecosts', null, 'decimal'], ['volume', null, 'decimal'],
            ['equipment_period_from', null, 'datetime'], ['equipment_period_to', null, 'datetime'],
            ['custom', null, 'json']
        ]
    },
    Contact: {
        table: 'contacts',
        endpoint: '/contacts',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['folder', null, 'string'], ['type', null, 'string'], ['ext_name_line', null, 'string'],
            ['firstname', null, 'string'], ['distance', null, 'decimal'], ['travel_time', null, 'decimal'],
            ['surfix', null, 'string'], ['surname', null, 'string'], ['longitude', null, 'decimal'], ['latitude', null, 'decimal'],
            ['code', null, 'string'], ['accounting_code', null, 'string'], ['vendor_accounting_code', null, 'string'],
            ['name', null, 'string'], ['gender', null, 'string'],
            ['mailing_city', null, 'string'], ['mailing_street', null, 'string'], ['mailing_number', null, 'string'],
            ['mailing_unit_number', null, 'string'], ['mailing_district', null, 'string'],
            ['mailing_extra_address_line', null, 'string'], ['mailing_postalcode', null, 'string'],
            ['mailing_state', null, 'string'], ['mailing_country', null, 'string'],
            ['visit_city', null, 'string'], ['visit_street', null, 'string'], ['visit_number', null, 'string'],
            ['visit_unit_number', null, 'string'], ['visit_district', null, 'string'],
            ['visit_extra_address_line', null, 'string'], ['visit_postalcode', null, 'string'],
            ['visit_state', null, 'string'], ['country', null, 'string'],
            ['invoice_city', null, 'string'], ['invoice_street', null, 'string'], ['invoice_number', null, 'string'],
            ['invoice_unit_number', null, 'string'], ['invoice_district', null, 'string'],
            ['invoice_extra_address_line', null, 'string'], ['invoice_postalcode', null, 'string'],
            ['invoice_state', null, 'string'], ['invoice_country', null, 'string'],
            ['phone_1', null, 'string'], ['phone_2', null, 'string'], ['email_1', null, 'string'], ['email_2', null, 'string'],
            ['website', null, 'string'], ['VAT_code', null, 'string'], ['fiscal_code', null, 'string'],
            ['commerce_code', null, 'string'], ['purchase_number', null, 'string'],
            ['bic', null, 'string'], ['bank_account', null, 'string'],
            ['default_person', null, 'string'], ['admin_contactperson', null, 'string'],
            ['discount_crew', null, 'decimal'], ['discount_transport', null, 'decimal'],
            ['discount_rental', null, 'decimal'], ['discount_sale', null, 'decimal'],
            ['discount_total', null, 'decimal'],
            ['projectnote', null, 'text'], ['projectnote_title', null, 'string'],
            ['contact_warning', null, 'text'], ['discount_subrent', null, 'decimal'],
            ['image', null, 'string'], ['tags', null, 'text'], ['custom', null, 'json']
        ]
    },
    ContactPerson: {
        table: 'contact_persons',
        endpoint: '/contactpersons',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['contact', null, 'string'], ['firstname', null, 'string'], ['middle_name', null, 'string'],
            ['lastname', null, 'string'], ['function', null, 'string'], ['phone', null, 'string'],
            ['street', null, 'string'], ['number', null, 'string'], ['postalcode', null, 'string'],
            ['city', null, 'string'], ['state', null, 'string'], ['country', null, 'string'],
            ['mobilephone', null, 'string'], ['email', null, 'string'], ['tags', null, 'text'], ['custom', null, 'json']
        ]
    },
    Equipment: {
        table: 'equipment',
        endpoint: '/equipment',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['folder', null, 'string'], ['code', null, 'string'], ['factor_group', null, 'string'],
            ['name', null, 'string'], ['internal_remark', null, 'text'], ['external_remark', null, 'text'],
            ['unit', null, 'string'], ['in_shop', null, 'bool'], ['surface_article', null, 'bool'],
            ['shop_description_short', null, 'text'], ['shop_description_long', null, 'text'],
            ['shop_seo_title', null, 'string'], ['shop_seo_keyword', null, 'string'], ['shop_seo_description', null, 'text'],
            ['shop_featured', null, 'bool'], ['price', null, 'decimal'], ['subrental_costs', null, 'decimal'],
            ['critical_stock_level', null, 'int'], ['type', null, 'string'], ['rental_sales', null, 'bool'],
            ['temporary', null, 'bool'], ['in_planner', null, 'bool'], ['in_archive', null, 'bool'],
            ['stock_management', null, 'bool'], ['taxclass', null, 'string'], ['list_price', null, 'decimal'],
            ['volume', null, 'decimal'], ['packed_per', null, 'int'],
            ['height', null, 'decimal'], ['width', null, 'decimal'], ['length', null, 'decimal'],
            ['weight', null, 'decimal'], ['empty_weight', null, 'decimal'],
            ['power', null, 'decimal'], ['current', null, 'decimal'],
            ['country_of_origin', null, 'string'], ['image', null, 'string'],
            ['ledger', null, 'string'], ['ledger_debit', null, 'string'], ['defaultgroup', null, 'string'],
            ['is_combination', null, 'bool'], ['is_physical', null, 'bool'],
            ['can_edit_content_during_planning', null, 'bool'], ['strict_container_content', null, 'bool'],
            ['qrcodes', null, 'text'], ['qrcodes_of_serial_numbers', null, 'text'], ['tags', null, 'text'],
            ['current_quantity_excl_cases', null, 'int'], ['current_quantity', null, 'int'],
            ['quantity_in_cases', null, 'int'], ['location_in_warehouse', null, 'string'],
            ['custom', null, 'json']
        ]
    },
    Crew: {
        table: 'crew',
        endpoint: '/crew',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['folder', null, 'string'], ['street', null, 'string'], ['housenumber', null, 'string'],
            ['unit_number', null, 'string'], ['district', null, 'string'], ['city', null, 'string'],
            ['postal_code', null, 'string'], ['addressline2', null, 'string'], ['extraaddressline', null, 'string'],
            ['state', null, 'string'], ['country', null, 'string'], ['birthdate', null, 'date'],
            ['passport_number', null, 'string'], ['emergency_contact', null, 'string'], ['remark', null, 'text'],
            ['driving_license', null, 'string'], ['contract', null, 'string'], ['bank', null, 'string'],
            ['contract_date', null, 'date'], ['company_name', null, 'string'], ['vat_code', null, 'string'],
            ['coc_code', null, 'string'], ['firstname', null, 'string'], ['middle_name', null, 'string'],
            ['lastname', null, 'string'], ['email', null, 'string'], ['phone', null, 'string'],
            ['active', null, 'bool'], ['avatar', null, 'string'], ['vt_fullname', null, 'string'],
            ['default_warehouse', null, 'string'], ['external_reference', null, 'string'],
            ['tags', null, 'text'], ['custom', null, 'json']
        ]
    },
    ProjectEquipment: {
        table: 'project_equipment',
        endpoint: '/projectequipment',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['equipment', null, 'string'], ['parent', null, 'string'], ['ledger', null, 'string'], ['ledger_debit', null, 'string'],
            ['quantity', null, 'string'], ['quantity_total', null, 'int'], ['equipment_group', null, 'string'],
            ['discount', null, 'decimal'], ['is_option', null, 'bool'], ['factor', null, 'string'],
            ['order', null, 'string'], ['unit_price', null, 'decimal'], ['name', null, 'string'],
            ['external_remark', null, 'text'], ['internal_remark', null, 'text'],
            ['delay_notified', null, 'bool'], ['planperiod_start', null, 'datetime'], ['planperiod_end', null, 'datetime'],
            ['has_missings', null, 'bool'], ['warehouse_reservations', null, 'int'],
            ['subrent_reservations', null, 'int'], ['serial_number_ids', null, 'text'],
            ['custom', null, 'json']
        ]
    },
    ProjectEquipmentGroup: {
        table: 'project_equipment_groups',
        endpoint: '/projectequipmentgroup',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['project', null, 'string'], ['subproject', null, 'string'], ['additional_scanned', null, 'bool'],
            ['name', null, 'string'], ['usageperiod_start', null, 'datetime'], ['usageperiod_end', null, 'datetime'],
            ['duration', null, 'decimal'], ['planperiod_start', null, 'datetime'], ['planperiod_end', null, 'datetime'],
            ['is_delayed', null, 'bool'], ['order', null, 'string'], ['in_price_calculation', null, 'bool'],
            ['remark', null, 'text'], ['weight', null, 'decimal'], ['power', null, 'decimal'],
            ['current', null, 'decimal'], ['volume', null, 'decimal'], ['total_new_price', null, 'decimal']
        ]
    },
    ProjectFunction: {
        table: 'project_functions',
        endpoint: '/projectfunctions',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['cost_rate', null, 'string'], ['cost_accommodation', null, 'decimal'], ['cost_catering', null, 'decimal'],
            ['cost_travel', null, 'decimal'], ['cost_other', null, 'decimal'],
            ['price_rate', null, 'string'], ['price_accommodation', null, 'decimal'], ['price_catering', null, 'decimal'],
            ['price_travel', null, 'decimal'], ['price_other', null, 'decimal'],
            ['project', null, 'string'], ['subproject', null, 'string'], ['is_template', null, 'bool'],
            ['group', null, 'string'], ['name_external', null, 'string'], ['name', null, 'string'],
            ['travel_time_before', null, 'decimal'], ['travel_time_after', null, 'decimal'],
            ['usageperiod_start', null, 'datetime'],
            ['planperiod_start_schedule_is_start', null, 'bool'], ['usageperiod_start_schedule_is_start', null, 'bool'],
            ['planperiod_end_schedule_is_start', null, 'bool'], ['usageperiod_end_schedule_is_start', null, 'bool'],
            ['usageperiod_end', null, 'datetime'], ['planperiod_start', null, 'datetime'], ['planperiod_end', null, 'datetime'],
            ['type', null, 'string'], ['duration', null, 'decimal'], ['amount', null, 'int'],
            ['break', null, 'decimal'], ['distance', null, 'decimal'], ['twoway', null, 'bool'],
            ['taxclass', null, 'string'], ['ledger', null, 'string'], ['ledger_debit', null, 'string'],
            ['order', null, 'string'], ['remark_client', null, 'text'], ['remark_planner', null, 'text'],
            ['remark_crew', null, 'text'], ['in_financial', null, 'bool'], ['in_planning', null, 'bool'],
            ['is_plannable', null, 'bool'], ['recurrence_group', null, 'int'], ['recurrence_enddate', null, 'datetime'],
            ['recurrence_interval_unit', null, 'string'], ['recurrence_interval', null, 'int'],
            ['recurrence_weekdays', null, 'string'],
            ['price_fixed', null, 'decimal'], ['price_variable', null, 'decimal'],
            ['costs_fixed', null, 'decimal'], ['costs_variable', null, 'decimal'],
            ['price_total', null, 'decimal'], ['costs_total', null, 'decimal'],
            ['tags', null, 'text'], ['custom', null, 'json']
        ]
    },
    ProjectFunctionGroup: {
        table: 'project_function_groups',
        endpoint: '/projectfunctiongroups',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['name', null, 'string'], ['project', null, 'string'], ['subproject', null, 'string'],
            ['duration', null, 'decimal'],
            ['planperiod_start_schedule_is_start', null, 'bool'], ['usageperiod_start_schedule_is_start', null, 'bool'],
            ['planperiod_end_schedule_is_start', null, 'bool'], ['usageperiod_end_schedule_is_start', null, 'bool'],
            ['usageperiod_start', null, 'datetime'], ['usageperiod_end', null, 'datetime'],
            ['planperiod_start', null, 'datetime'], ['planperiod_end', null, 'datetime'],
            ['remark', null, 'text']
        ]
    },
    ProjectCost: {
        table: 'project_costs',
        endpoint: '/costs',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['name', null, 'string'], ['remark', null, 'text'], ['project', null, 'string'],
            ['quantity', null, 'int'], ['discount', null, 'decimal'], ['order', null, 'string'],
            ['subproject', null, 'string'], ['is_template', null, 'bool'], ['taxclass', null, 'string'],
            ['ledger', null, 'string'], ['ledger_debit', null, 'string'],
            ['sale_price', null, 'decimal'], ['purchase_price', null, 'decimal'], ['custom', null, 'json']
        ]
    },
    ProjectCrew: {
        table: 'project_crew',
        endpoint: '/projectcrew',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['cost_rate', null, 'string'], ['cost_accommodation', null, 'decimal'], ['cost_catering', null, 'decimal'],
            ['cost_travel', null, 'decimal'], ['cost_other', null, 'decimal'],
            ['function', null, 'string'], ['crewmember', null, 'string'], ['visible', null, 'bool'],
            ['planperiod_start', null, 'datetime'], ['planperiod_end', null, 'datetime'],
            ['transport', null, 'string'], ['remark', null, 'text'], ['remark_planner', null, 'text'],
            ['invoice_reference', null, 'string'], ['project_leader', null, 'bool'],
            ['is_visible_on_dashboard', null, 'bool'],
            ['costs', null, 'decimal'], ['cost_actual', null, 'decimal'],
            ['hours_registered', null, 'decimal'], ['hours_planned', null, 'decimal'],
            ['cost_planned', null, 'decimal'], ['diff_cost', null, 'decimal'], ['diff_hours', null, 'decimal'],
            ['activity_status', null, 'string'], ['custom', null, 'json']
        ]
    },
    ProjectVehicle: {
        table: 'project_vehicles',
        endpoint: '/projectvehicles',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['cost_rate', null, 'string'], ['function', null, 'string'], ['transport', null, 'string'],
            ['vehicle', null, 'string'], ['planningperiod_start', null, 'datetime'], ['planningperiod_end', null, 'datetime'],
            ['remark', null, 'text'], ['remark_planner', null, 'text'], ['costs', null, 'decimal'], ['custom', null, 'json']
        ]
    },
    Appointment: {
        table: 'appointments',
        endpoint: '/appointments',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['name', null, 'string'], ['start', null, 'datetime'], ['end', null, 'datetime'],
            ['color', null, 'string'], ['location', null, 'string'], ['remark', null, 'text'],
            ['is_public', null, 'bool'], ['is_plannable', null, 'bool'],
            ['recurrence_interval_unit', null, 'string'], ['recurrence_enddate', null, 'datetime'],
            ['recurrence_interval', null, 'int'], ['recurrence_group', null, 'int'],
            ['recurrence_weekdays', null, 'string'],
            ['synchronization_id', null, 'string'], ['synchronisation_uri', null, 'string']
        ]
    },
    AppointmentCrew: {
        table: 'appointment_crew',
        endpoint: '/appointmentcrew',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['appointment', null, 'string'], ['crew', null, 'string']
        ]
    },
    Accessory: {
        table: 'accessories',
        endpoint: '/accessories',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['parent_equipment', null, 'string'], ['equipment', null, 'string'], ['quantity', null, 'int'],
            ['automatic', null, 'bool'], ['skip', null, 'bool'], ['is_free', null, 'bool'],
            ['order', null, 'string'], ['add_as_new_line', null, 'bool']
        ]
    },
    StockLocation: {
        table: 'stock_locations',
        endpoint: '/stocklocations',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['name', null, 'string'], ['city', null, 'string'], ['street', null, 'string'],
            ['house_number', null, 'string'], ['postal_code', null, 'string'], ['state_province', null, 'string'],
            ['country', null, 'string'], ['active', null, 'bool'], ['type', null, 'string'],
            ['color', null, 'string'], ['in_archive', null, 'bool']
        ]
    },
    CrewAvailability: {
        table: 'crew_availability',
        endpoint: '/crewavailability',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['last_updater', null, 'string'], ['last_updated', null, 'datetime'],
            ['start', null, 'datetime'], ['end', null, 'datetime'], ['crewmember', null, 'string'],
            ['status', null, 'string'], ['remark', null, 'text'],
            ['recurrence_interval_unit', null, 'string'], ['recurrence_enddate', null, 'datetime'],
            ['recurrence_interval', null, 'int'], ['recurrent_group', null, 'int'],
            ['recurrence_weekdays', null, 'string']
        ]
    },
    InvoiceLine: {
        table: 'invoice_lines',
        endpoint: '/invoicelines',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['item', null, 'string'], ['base', null, 'decimal'], ['ledger', null, 'string'],
            ['vatrate', null, 'decimal'], ['vatamount', null, 'decimal'],
            ['priceincl', null, 'decimal'], ['ledgercode', null, 'string']
        ]
    },
    Contract: {
        table: 'contracts',
        endpoint: '/contracts',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['number', null, 'string'], ['customer', null, 'string'], ['contact', null, 'string'],
            ['date', null, 'date'], ['expiration_date', null, 'date'], ['version', null, 'int'],
            ['subject', null, 'string'], ['show_tax', null, 'bool'], ['project', null, 'string'],
            ['filename', null, 'string'],
            ['project_total_price', null, 'decimal'], ['project_total_price_cancelled', null, 'decimal'],
            ['project_rental_price', null, 'decimal'], ['project_sale_price', null, 'decimal'],
            ['project_crew_price', null, 'decimal'], ['project_transport_price', null, 'decimal'],
            ['project_other_price', null, 'decimal'], ['project_insurance_price', null, 'decimal'],
            ['price', null, 'decimal'], ['price_invat', null, 'decimal'], ['vat_amount', null, 'decimal']
        ]
    },
    SerialNumber: {
        table: 'serial_numbers',
        endpoint: '/serialnumbers',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['equipment', null, 'string'], ['serial', null, 'string'], ['purchasedate', null, 'date'],
            ['depreciation_monthly', null, 'decimal'], ['book_value', null, 'decimal'],
            ['residual_value', null, 'decimal'], ['purchase_costs', null, 'decimal'],
            ['active', null, 'bool'], ['remark', null, 'text'], ['ref', null, 'string'],
            ['asset_location', null, 'string'], ['image', null, 'string'],
            ['current_book_value', null, 'decimal'], ['next_inspection', null, 'datetime'],
            ['qrcodes', null, 'text'], ['tags', null, 'text'], ['last_subproject', null, 'string'],
            ['sealed', null, 'bool'], ['custom', null, 'json']
        ]
    },
    Factuur: {
        table: 'invoices',
        endpoint: '/invoices',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['customer', null, 'string'], ['account_manager', null, 'string'], ['contact', null, 'string'],
            ['expiration', null, 'date'], ['date', null, 'date'], ['number', null, 'string'],
            ['procent', null, 'decimal'], ['from_project', null, 'bool'], ['subject', null, 'string'],
            ['finalized', null, 'bool'], ['integration_reference_id', null, 'string'],
            ['project', null, 'string'], ['filename', null, 'string'],
            ['project_total_price', null, 'decimal'], ['project_total_price_cancelled', null, 'decimal'],
            ['project_rental_price', null, 'decimal'], ['project_sale_price', null, 'decimal'],
            ['project_crew_price', null, 'decimal'], ['project_transport_price', null, 'decimal'],
            ['project_other_price', null, 'decimal'], ['project_insurance_price', null, 'decimal'],
            ['sum_factuurregels', null, 'decimal'], ['price', null, 'decimal'],
            ['price_invat', null, 'decimal'], ['vat_amount', null, 'decimal'],
            ['invoicetype', null, 'string'], ['outstanding_balance', null, 'decimal'],
            ['total_paid', null, 'decimal'], ['is_paid', null, 'bool'],
            ['date_sent', null, 'datetime'], ['payment_reminder_sent', null, 'int'],
            ['final_payment_reminder_sent', null, 'datetime'], ['payment_date', null, 'datetime'],
            ['days_after_expiry', null, 'int'], ['tags', null, 'text']
        ]
    },
    File: {
        table: 'files',
        endpoint: '/files',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['readable_name', null, 'string'], ['expiration', null, 'datetime'], ['size', null, 'int'],
            ['image', null, 'bool'], ['item', null, 'string'], ['itemtype', null, 'int'],
            ['description', null, 'text'], ['in_documents', null, 'bool'], ['in_webshop', null, 'bool'],
            ['classified', null, 'bool'], ['public', null, 'bool'], ['type', null, 'string'],
            ['preview_of', null, 'string'], ['previewstatus', null, 'string'],
            ['file_item', null, 'int'], ['file_itemtype', null, 'string'], ['folder', null, 'string'],
            ['path', null, 'text'], ['path_without_file_name', null, 'text'],
            ['path_with_file_folders', null, 'text'], ['name_without_extension', null, 'string'],
            ['friendly_name_without_extension', null, 'string'], ['extension', null, 'string'],
            ['url', null, 'text'], ['proxy_url', null, 'text']
        ]
    },
    Folder: {
        table: 'folders',
        endpoint: '/folders',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['parent', null, 'string'], ['name', null, 'string'], ['order', null, 'string'],
            ['itemtype', null, 'string'], ['path', null, 'text']
        ]
    },
    TimeRegistrationActivity: {
        table: 'time_registration_activities',
        endpoint: '/timeregistrationactivities',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['time_registration', null, 'string'], ['project_function', null, 'string'],
            ['subproject_function', null, 'string'], ['description', null, 'text'],
            ['duration', null, 'decimal'], ['is_activity', null, 'bool'],
            ['from', null, 'datetime'], ['to', null, 'datetime']
        ]
    },
    Ledger: {
        table: 'ledgers',
        endpoint: '/ledgercodes',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['code', null, 'string'], ['is_credit', null, 'bool'], ['is_debit', null, 'bool']
        ]
    },
    Subrental: {
        table: 'subrentals',
        endpoint: '/subrentals',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['name', null, 'string'], ['accountmanager', null, 'string'], ['reference', null, 'string'],
            ['supplier', null, 'string'], ['number', null, 'string'], ['contactperson', null, 'string'],
            ['location', null, 'string'], ['location_contact', null, 'string'],
            ['usageperiod_start', null, 'datetime'], ['usageperiod_end', null, 'datetime'],
            ['planperiod_start', null, 'datetime'], ['planperiod_end', null, 'datetime'],
            ['delivery_in', null, 'datetime'], ['delivery_out', null, 'datetime'],
            ['equipment_cost', null, 'decimal'], ['price', null, 'decimal'], ['extra_cost', null, 'decimal'],
            ['auto_update_costs', null, 'bool'], ['remark', null, 'text'], ['type', null, 'string'],
            ['status', null, 'string'], ['sent', null, 'datetime'],
            ['asset_location_to', null, 'string'], ['asset_location_from', null, 'string'],
            ['is_internal', null, 'bool'], ['supplier_project', null, 'string'],
            ['tags', null, 'text'], ['custom', null, 'json']
        ]
    },
    SubrentalEquipmentGroup: {
        table: 'subrental_equipment_groups',
        endpoint: '/subrentalequipmentgroup',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['subrental', null, 'string'], ['name', null, 'string'], ['order', null, 'string'],
            ['supplier_category', null, 'string']
        ]
    },
    SubrentalEquipment: {
        table: 'subrental_equipment',
        endpoint: '/subrentalequipment',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['subrental_group', null, 'string'], ['equipment', null, 'string'], ['parent', null, 'string'],
            ['planperiod_start', null, 'datetime'], ['planperiod_end', null, 'datetime'],
            ['name', null, 'string'], ['quantity', null, 'int'], ['quantity_total', null, 'int'],
            ['unit_price', null, 'decimal'], ['discount', null, 'decimal'], ['factor', null, 'string'],
            ['order', null, 'string'], ['remark', null, 'text'], ['lineprice', null, 'decimal'],
            ['supplier_planningmateriaal', null, 'string']
        ]
    },
    Quotation: {
        table: 'quotations',
        endpoint: '/quotes',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['number', null, 'string'], ['customer', null, 'string'], ['contact', null, 'string'],
            ['date', null, 'date'], ['expiration_date', null, 'date'], ['version', null, 'int'],
            ['subject', null, 'string'], ['show_tax', null, 'bool'], ['project', null, 'string'],
            ['filename', null, 'string'],
            ['project_total_price', null, 'decimal'], ['project_total_price_cancelled', null, 'decimal'],
            ['project_rental_price', null, 'decimal'], ['project_sale_price', null, 'decimal'],
            ['project_crew_price', null, 'decimal'], ['project_transport_price', null, 'decimal'],
            ['project_other_price', null, 'decimal'], ['project_insurance_price', null, 'decimal'],
            ['price', null, 'decimal'], ['price_invat', null, 'decimal'], ['vat_amount', null, 'decimal'],
            ['tags', null, 'text']
        ]
    },
    ProjectRequest: {
        table: 'project_requests',
        endpoint: '/projectrequests',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['linked_contact', null, 'string'], ['contact_mailing_number', null, 'string'],
            ['contact_mailing_country', null, 'string'], ['contact_name', null, 'string'],
            ['contact_mailing_postalcode', null, 'string'], ['contact_phone', null, 'string'],
            ['contact_mailing_city', null, 'string'], ['contact_mailing_street', null, 'string'],
            ['linked_contact_person', null, 'string'], ['contact_person_lastname', null, 'string'],
            ['contact_person_email', null, 'string'], ['contact_person_middle_name', null, 'string'],
            ['contact_person_first_name', null, 'string'],
            ['usageperiod_end', null, 'datetime'], ['usageperiod_start', null, 'datetime'],
            ['is_paid', null, 'bool'], ['language', null, 'string'],
            ['in', null, 'datetime'], ['out', null, 'datetime'],
            ['linked_location', null, 'string'], ['location_mailing_number', null, 'string'],
            ['location_mailing_country', null, 'string'], ['location_name', null, 'string'],
            ['location_mailing_postalcode', null, 'string'], ['location_mailing_city', null, 'string'],
            ['location_mailing_street', null, 'string'], ['location_phone', null, 'string'],
            ['name', null, 'string'], ['external_reference', null, 'int'], ['remark', null, 'text'],
            ['planperiod_end', null, 'datetime'], ['planperiod_start', null, 'datetime'],
            ['price', null, 'decimal'], ['linked_project', null, 'string'],
            ['source', null, 'string'], ['status', null, 'string']
        ]
    },
    ProjectRequestEquipment: {
        table: 'project_request_equipment',
        endpoint: '/projectrequestequipment',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['quantity', null, 'int'], ['quantity_total', null, 'int'], ['is_comment', null, 'bool'],
            ['is_kit', null, 'bool'], ['discount', null, 'decimal'], ['linked_equipment', null, 'string'],
            ['name', null, 'string'], ['external_remark', null, 'text'], ['parent', null, 'string'],
            ['unit_price', null, 'decimal'], ['project_request', null, 'string'],
            ['factor', null, 'string'], ['order', null, 'string']
        ]
    },
    CrewRate: {
        table: 'crew_rates',
        endpoint: '/crewrates',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['name', null, 'string'], ['archived', null, 'bool'], ['type', null, 'string'], ['subtype', null, 'string']
        ]
    },
    CrewRateFactor: {
        table: 'crew_rate_factors',
        endpoint: '/ratefactors',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['rate_id', null, 'string'], ['from', null, 'decimal'], ['to', null, 'decimal'],
            ['variable', null, 'decimal'], ['fixed', null, 'decimal']
        ]
    },
    Repair: {
        table: 'repairs',
        endpoint: '/repairs',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['internal_name', null, 'string'], ['equipment', null, 'string'], ['serialnumber', null, 'string'],
            ['reporter', null, 'string'], ['assignee', null, 'string'], ['external_repairer', null, 'string'],
            ['number', null, 'string'], ['repairperiod_start', null, 'datetime'], ['repairperiod_end', null, 'datetime'],
            ['amount', null, 'int'], ['remark', null, 'text'], ['repair_costs', null, 'decimal'],
            ['is_usable', null, 'bool'], ['costs_charged_to_customer', null, 'string'],
            ['subproject', null, 'string'], ['stock_location', null, 'string'],
            ['tags', null, 'text'], ['custom', null, 'json']
        ]
    },
    EquipmentSetContent: {
        table: 'equipment_set_content',
        endpoint: '/equipmentsetscontent',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['quantity', null, 'string'], ['parent_equipment', null, 'string'], ['order', null, 'string'],
            ['equipment', null, 'string'], ['is_fixed', null, 'bool'], ['is_physically_connected', null, 'bool']
        ]
    },
    Status: {
        table: 'statuses',
        endpoint: '/statuses',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['name', null, 'string']
        ]
    },
    TaxClass: {
        table: 'tax_classes',
        endpoint: '/taxclasses',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['name', null, 'string'], ['code', null, 'string'], ['type', null, 'string']
        ]
    },
    ProjectType: {
        table: 'project_types',
        endpoint: '/projecttypes',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['name', null, 'string'], ['color', null, 'string'], ['type', null, 'string']
        ]
    },
    TimeRegistration: {
        table: 'time_registrations',
        endpoint: '/timeregistration',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['crewmember', null, 'string'], ['start', null, 'datetime'], ['end', null, 'datetime'],
            ['distance', null, 'decimal'], ['is_lunch_included', null, 'bool'],
            ['leavetype', null, 'string'], ['leaverequest', null, 'string'],
            ['duration', null, 'decimal'], ['break_duration', null, 'decimal'],
            ['travel_time', null, 'decimal'], ['correction_duration', null, 'decimal'],
            ['remark', null, 'text'], ['status', null, 'string'],
            ['break_duration_with_start_end', null, 'decimal'], ['custom', null, 'json']
        ]
    },
    Vehicle: {
        table: 'vehicles',
        endpoint: '/vehicles',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['folder', null, 'string'], ['name', null, 'string'], ['cost_rate', null, 'string'],
            ['in_planner', null, 'bool'], ['height', null, 'decimal'], ['length', null, 'decimal'],
            ['width', null, 'decimal'], ['seats', null, 'int'], ['inspection_date', null, 'date'],
            ['licenseplate', null, 'string'], ['remark', null, 'text'], ['payload_capacity', null, 'decimal'],
            ['surface_area', null, 'string'], ['multiple', null, 'bool'], ['image', null, 'string'],
            ['asset_location', null, 'string'], ['tags', null, 'text'],
            ['distance_cost', null, 'decimal'], ['fixed_cost', null, 'decimal'], ['custom', null, 'json']
        ]
    },
    StockMovement: {
        table: 'stock_movements',
        endpoint: '/stockmovements',
        columns: [
            ['created', null, 'datetime'], ['modified', null, 'datetime'], ['creator', null, 'string'], ['displayname', null, 'string'],
            ['amount', null, 'int'], ['equipment', null, 'string'], ['projectequipment', null, 'string'],
            ['description', null, 'text'], ['details', null, 'text'], ['date', null, 'datetime'],
            ['type', null, 'string'], ['stock_location', null, 'string'], ['api_client', null, 'string']
        ]
    }
};

// Webhook itemType "TimeRegistartion" (typo i Rentman) → mapper til TimeRegistration
ITEM_TYPES['TimeRegistartion'] = ITEM_TYPES.TimeRegistration;

// MySQL reserverede ord der skal escapes med backticks
const RESERVED_WORDS = new Set([
    'order', 'group', 'function', 'current', 'break', 'from', 'to',
    'in', 'out', 'conditions', 'read', 'index', 'key', 'status'
]);

function escapeColumn(col) {
    return RESERVED_WORDS.has(col) ? `\`${col}\`` : col;
}

// =============================================================================
// Generisk upsert/delete
// =============================================================================

/**
 * Upsert et item til den korrekte tabel baseret på itemType.
 * Bygger INSERT ... ON DUPLICATE KEY UPDATE dynamisk fra config.
 */
async function upsertItem(itemType, data) {
    const config = ITEM_TYPES[itemType];
    if (!config) {
        logger.warn('Ukendt itemType for upsert', { itemType });
        return;
    }

    const columns = ['id'];
    const placeholders = ['?'];
    const values = [data.id];
    const updates = [];

    for (const [apiField, dbColumn, type] of config.columns) {
        const col = dbColumn || apiField;
        const val = formatValue(data[apiField], type);
        columns.push(escapeColumn(col));
        placeholders.push('?');
        values.push(val);
        updates.push(`${escapeColumn(col)} = VALUES(${escapeColumn(col)})`);
    }

    const sql = `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) ON DUPLICATE KEY UPDATE ${updates.join(', ')}`;

    await query(sql, values);
    logger.debug(`Upserted ${itemType} id=${data.id} til ${config.table}`);
}

/**
 * Batch upsert af flere items til den korrekte tabel.
 * Bygger én multi-row INSERT ... ON DUPLICATE KEY UPDATE.
 */
async function upsertBatch(itemType, items) {
    if (!items || items.length === 0) return;

    const config = ITEM_TYPES[itemType];
    if (!config) {
        logger.warn('Ukendt itemType for batch upsert', { itemType });
        return;
    }

    // Byg kolonne-liste fra første item (alle items har samme struktur)
    const columnNames = ['id'];
    const updates = [];

    for (const [apiField, dbColumn] of config.columns) {
        const col = dbColumn || apiField;
        columnNames.push(escapeColumn(col));
        updates.push(`${escapeColumn(col)} = VALUES(${escapeColumn(col)})`);
    }

    // Byg values for alle rows
    const allValues = [];
    const rowPlaceholders = [];

    for (const data of items) {
        const rowValues = [data.id];
        for (const [apiField, dbColumn, type] of config.columns) {
            rowValues.push(formatValue(data[apiField], type));
        }
        allValues.push(...rowValues);
        rowPlaceholders.push(`(${rowValues.map(() => '?').join(', ')})`);
    }

    const sql = `INSERT INTO ${config.table} (${columnNames.join(', ')}) VALUES ${rowPlaceholders.join(', ')} ON DUPLICATE KEY UPDATE ${updates.join(', ')}`;

    await query(sql, allValues);
    logger.debug(`Batch upserted ${items.length} ${itemType} til ${config.table}`);
}

/**
 * Slet et item fra den korrekte tabel baseret på itemType.
 */
async function deleteItem(itemType, id) {
    const config = ITEM_TYPES[itemType];
    if (!config) {
        logger.warn('Ukendt itemType for delete', { itemType });
        return;
    }

    await query(`DELETE FROM ${config.table} WHERE id = ?`, [id]);
    logger.debug(`Slettet ${itemType} id=${id} fra ${config.table}`);
}

/**
 * Hent et item fra databasen.
 */
async function getItem(itemType, id) {
    const config = ITEM_TYPES[itemType];
    if (!config) return null;

    const rows = await query(`SELECT * FROM ${config.table} WHERE id = ?`, [id]);
    return rows[0] || null;
}

/**
 * Hent alle items af en given type.
 */
async function getAllItems(itemType) {
    const config = ITEM_TYPES[itemType];
    if (!config) return [];

    return query(`SELECT * FROM ${config.table}`);
}

/**
 * Returnerer config for en itemType (tabel, endpoint, kolonner).
 */
function getItemTypeConfig(itemType) {
    return ITEM_TYPES[itemType] || null;
}

/**
 * Returnerer alle kendte itemTypes.
 */
function getAllItemTypes() {
    return Object.keys(ITEM_TYPES).filter(k => k !== 'TimeRegistartion');
}

/**
 * Lukker database pool.
 */
async function shutdown() {
    await pool.end();
    logger.info('Rentman database pool lukket');
}

module.exports = {
    query,
    upsertItem,
    upsertBatch,
    deleteItem,
    getItem,
    getAllItems,
    getItemTypeConfig,
    getAllItemTypes,
    ITEM_TYPES,
    shutdown
};

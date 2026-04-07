-- =============================================================================
-- Rentman Database Schema
-- Opretter en komplet spejling af Rentman data modtaget via webhooks og sync.
-- Kør dette script for at oprette databasen og alle tabeller.
-- =============================================================================

CREATE DATABASE IF NOT EXISTS rentman_data
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE rentman_data;

-- =============================================================================
-- Projects
-- =============================================================================

CREATE TABLE IF NOT EXISTS projects (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    location        VARCHAR(100) NULL,
    refundabledeposit DECIMAL(20,6) NULL,
    deposit_status  VARCHAR(50) NULL,
    customer        VARCHAR(100) NULL,
    loc_contact     VARCHAR(100) NULL,
    cust_contact    VARCHAR(100) NULL,
    project_type    VARCHAR(100) NULL,
    name            VARCHAR(255) NULL,
    reference       VARCHAR(255) NULL,
    number          VARCHAR(100) NULL,
    account_manager VARCHAR(100) NULL,
    color           VARCHAR(50) NULL,
    `conditions`    TEXT NULL,
    project_total_price DECIMAL(20,6) NULL,
    project_total_price_cancelled DECIMAL(20,6) NULL,
    project_rental_price DECIMAL(20,6) NULL,
    project_sale_price DECIMAL(20,6) NULL,
    project_crew_price DECIMAL(20,6) NULL,
    project_transport_price DECIMAL(20,6) NULL,
    project_other_price DECIMAL(20,6) NULL,
    project_insurance_price DECIMAL(20,6) NULL,
    already_invoiced DECIMAL(20,6) NULL,
    tags            TEXT NULL,
    usageperiod_start DATETIME NULL,
    usageperiod_end DATETIME NULL,
    planperiod_start DATETIME NULL,
    planperiod_end  DATETIME NULL,
    weight          DECIMAL(20,6) NULL,
    power           DECIMAL(20,6) NULL,
    `current`       DECIMAL(20,6) NULL,
    equipment_period_from DATETIME NULL,
    equipment_period_to DATETIME NULL,
    purchasecosts   DECIMAL(20,6) NULL,
    volume          DECIMAL(20,6) NULL,
    custom          JSON NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_name (name),
    INDEX idx_customer (customer)
);

-- =============================================================================
-- Subprojects
-- =============================================================================

CREATE TABLE IF NOT EXISTS subprojects (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    project         VARCHAR(100) NULL,
    `order`         VARCHAR(50) NULL,
    name            VARCHAR(255) NULL,
    status          VARCHAR(100) NULL,
    is_template     TINYINT(1) NULL,
    location        VARCHAR(100) NULL,
    loc_contact     VARCHAR(100) NULL,
    insurance_rate  DECIMAL(20,6) NULL,
    discount_rental DECIMAL(20,6) NULL,
    discount_sale   DECIMAL(20,6) NULL,
    discount_crew   DECIMAL(20,6) NULL,
    discount_transport DECIMAL(20,6) NULL,
    discount_additional_costs DECIMAL(20,6) NULL,
    discount_subproject DECIMAL(20,6) NULL,
    discount_fixed  TINYINT(1) NULL,
    discount_fixed_amount DECIMAL(20,6) NULL,
    fixed_price     TINYINT(1) NULL,
    in_planning     TINYINT(1) NULL,
    in_financial    TINYINT(1) NULL,
    asset_location_from VARCHAR(100) NULL,
    project_total_price DECIMAL(20,6) NULL,
    project_total_price_cancelled DECIMAL(20,6) NULL,
    project_rental_price DECIMAL(20,6) NULL,
    project_sale_price DECIMAL(20,6) NULL,
    project_crew_price DECIMAL(20,6) NULL,
    project_transport_price DECIMAL(20,6) NULL,
    project_other_price DECIMAL(20,6) NULL,
    project_insurance_price DECIMAL(20,6) NULL,
    already_invoiced DECIMAL(20,6) NULL,
    usageperiod_start DATETIME NULL,
    usageperiod_end DATETIME NULL,
    planperiod_start DATETIME NULL,
    planperiod_end  DATETIME NULL,
    weight          DECIMAL(20,6) NULL,
    power           DECIMAL(20,6) NULL,
    `current`       DECIMAL(20,6) NULL,
    purchasecosts   DECIMAL(20,6) NULL,
    volume          DECIMAL(20,6) NULL,
    equipment_period_from DATETIME NULL,
    equipment_period_to DATETIME NULL,
    custom          JSON NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_project (project(50)),
    INDEX idx_name (name)
);

-- =============================================================================
-- Contacts (virksomheder i Rentman)
-- =============================================================================

CREATE TABLE IF NOT EXISTS contacts (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    folder          VARCHAR(100) NULL,
    type            VARCHAR(50) NULL,
    ext_name_line   VARCHAR(255) NULL,
    firstname       VARCHAR(255) NULL,
    distance        DECIMAL(20,6) NULL,
    travel_time     DECIMAL(20,6) NULL,
    surfix          VARCHAR(100) NULL,
    surname         VARCHAR(255) NULL,
    longitude       DECIMAL(20,10) NULL,
    latitude        DECIMAL(20,10) NULL,
    code            VARCHAR(100) NULL,
    accounting_code VARCHAR(100) NULL,
    vendor_accounting_code VARCHAR(100) NULL,
    name            VARCHAR(255) NULL,
    gender          VARCHAR(20) NULL,
    mailing_city    VARCHAR(255) NULL,
    mailing_street  VARCHAR(255) NULL,
    mailing_number  VARCHAR(50) NULL,
    mailing_unit_number VARCHAR(50) NULL,
    mailing_district VARCHAR(255) NULL,
    mailing_extra_address_line VARCHAR(255) NULL,
    mailing_postalcode VARCHAR(50) NULL,
    mailing_state   VARCHAR(100) NULL,
    mailing_country VARCHAR(100) NULL,
    visit_city      VARCHAR(255) NULL,
    visit_street    VARCHAR(255) NULL,
    visit_number    VARCHAR(50) NULL,
    visit_unit_number VARCHAR(50) NULL,
    visit_district  VARCHAR(255) NULL,
    visit_extra_address_line VARCHAR(255) NULL,
    visit_postalcode VARCHAR(50) NULL,
    visit_state     VARCHAR(100) NULL,
    country         VARCHAR(100) NULL,
    invoice_city    VARCHAR(255) NULL,
    invoice_street  VARCHAR(255) NULL,
    invoice_number  VARCHAR(50) NULL,
    invoice_unit_number VARCHAR(50) NULL,
    invoice_district VARCHAR(255) NULL,
    invoice_extra_address_line VARCHAR(255) NULL,
    invoice_postalcode VARCHAR(50) NULL,
    invoice_state   VARCHAR(100) NULL,
    invoice_country VARCHAR(100) NULL,
    phone_1         VARCHAR(50) NULL,
    phone_2         VARCHAR(50) NULL,
    email_1         VARCHAR(255) NULL,
    email_2         VARCHAR(255) NULL,
    website         VARCHAR(500) NULL,
    VAT_code        VARCHAR(100) NULL,
    fiscal_code     VARCHAR(100) NULL,
    commerce_code   VARCHAR(100) NULL,
    purchase_number VARCHAR(100) NULL,
    bic             VARCHAR(50) NULL,
    bank_account    VARCHAR(100) NULL,
    default_person  VARCHAR(100) NULL,
    admin_contactperson VARCHAR(100) NULL,
    discount_crew   DECIMAL(20,6) NULL,
    discount_transport DECIMAL(20,6) NULL,
    discount_rental DECIMAL(20,6) NULL,
    discount_sale   DECIMAL(20,6) NULL,
    discount_total  DECIMAL(20,6) NULL,
    projectnote     TEXT NULL,
    projectnote_title VARCHAR(255) NULL,
    contact_warning TEXT NULL,
    discount_subrent DECIMAL(20,6) NULL,
    image           VARCHAR(255) NULL,
    tags            TEXT NULL,
    custom          JSON NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_name (name),
    INDEX idx_code (code)
);

-- =============================================================================
-- ContactPersons
-- =============================================================================

CREATE TABLE IF NOT EXISTS contact_persons (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    contact         VARCHAR(100) NULL,
    firstname       VARCHAR(255) NULL,
    middle_name     VARCHAR(255) NULL,
    lastname        VARCHAR(255) NULL,
    `function`      VARCHAR(255) NULL,
    phone           VARCHAR(50) NULL,
    street          VARCHAR(255) NULL,
    number          VARCHAR(50) NULL,
    postalcode      VARCHAR(50) NULL,
    city            VARCHAR(255) NULL,
    state           VARCHAR(100) NULL,
    country         VARCHAR(100) NULL,
    mobilephone     VARCHAR(50) NULL,
    email           VARCHAR(255) NULL,
    tags            TEXT NULL,
    custom          JSON NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_contact (contact(50)),
    INDEX idx_email (email)
);

-- =============================================================================
-- Equipment
-- =============================================================================

CREATE TABLE IF NOT EXISTS equipment (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    folder          VARCHAR(100) NULL,
    code            VARCHAR(100) NULL,
    factor_group    VARCHAR(100) NULL,
    name            VARCHAR(255) NULL,
    internal_remark TEXT NULL,
    external_remark TEXT NULL,
    unit            VARCHAR(50) NULL,
    in_shop         TINYINT(1) NULL,
    surface_article TINYINT(1) NULL,
    shop_description_short TEXT NULL,
    shop_description_long TEXT NULL,
    shop_seo_title  VARCHAR(255) NULL,
    shop_seo_keyword VARCHAR(255) NULL,
    shop_seo_description TEXT NULL,
    shop_featured   TINYINT(1) NULL,
    price           DECIMAL(20,6) NULL,
    subrental_costs DECIMAL(20,6) NULL,
    critical_stock_level INT NULL,
    type            VARCHAR(50) NULL,
    rental_sales    TINYINT(1) NULL,
    temporary       TINYINT(1) NULL,
    in_planner      TINYINT(1) NULL,
    in_archive      TINYINT(1) NULL,
    stock_management TINYINT(1) NULL,
    taxclass        VARCHAR(100) NULL,
    list_price      DECIMAL(20,6) NULL,
    volume          DECIMAL(20,6) NULL,
    packed_per      INT NULL,
    height          DECIMAL(20,6) NULL,
    width           DECIMAL(20,6) NULL,
    length          DECIMAL(20,6) NULL,
    weight          DECIMAL(20,6) NULL,
    empty_weight    DECIMAL(20,6) NULL,
    power           DECIMAL(20,6) NULL,
    `current`       DECIMAL(20,6) NULL,
    country_of_origin VARCHAR(100) NULL,
    image           VARCHAR(255) NULL,
    ledger          VARCHAR(100) NULL,
    ledger_debit    VARCHAR(100) NULL,
    defaultgroup    VARCHAR(255) NULL,
    is_combination  TINYINT(1) NULL,
    is_physical     TINYINT(1) NULL,
    can_edit_content_during_planning TINYINT(1) NULL,
    strict_container_content TINYINT(1) NULL,
    qrcodes         TEXT NULL,
    qrcodes_of_serial_numbers TEXT NULL,
    tags            TEXT NULL,
    current_quantity_excl_cases INT NULL,
    current_quantity INT NULL,
    quantity_in_cases INT NULL,
    location_in_warehouse VARCHAR(255) NULL,
    custom          JSON NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_name (name),
    INDEX idx_code (code)
);

-- =============================================================================
-- Crew
-- =============================================================================

CREATE TABLE IF NOT EXISTS crew (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    folder          VARCHAR(100) NULL,
    street          VARCHAR(255) NULL,
    housenumber     VARCHAR(50) NULL,
    unit_number     VARCHAR(50) NULL,
    district        VARCHAR(255) NULL,
    city            VARCHAR(255) NULL,
    postal_code     VARCHAR(50) NULL,
    addressline2    VARCHAR(255) NULL,
    extraaddressline VARCHAR(255) NULL,
    state           VARCHAR(100) NULL,
    country         VARCHAR(100) NULL,
    birthdate       DATE NULL,
    passport_number VARCHAR(100) NULL,
    emergency_contact VARCHAR(255) NULL,
    remark          TEXT NULL,
    driving_license VARCHAR(100) NULL,
    contract        VARCHAR(255) NULL,
    bank            VARCHAR(100) NULL,
    contract_date   DATE NULL,
    company_name    VARCHAR(255) NULL,
    vat_code        VARCHAR(100) NULL,
    coc_code        VARCHAR(100) NULL,
    firstname       VARCHAR(255) NULL,
    middle_name     VARCHAR(255) NULL,
    lastname        VARCHAR(255) NULL,
    email           VARCHAR(255) NULL,
    phone           VARCHAR(50) NULL,
    active          TINYINT(1) NULL,
    avatar          VARCHAR(255) NULL,
    vt_fullname     VARCHAR(255) NULL,
    default_warehouse VARCHAR(100) NULL,
    external_reference VARCHAR(255) NULL,
    tags            TEXT NULL,
    custom          JSON NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_name (lastname, firstname)
);

-- =============================================================================
-- ProjectEquipment
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_equipment (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    equipment       VARCHAR(100) NULL,
    parent          VARCHAR(100) NULL,
    ledger          VARCHAR(100) NULL,
    ledger_debit    VARCHAR(100) NULL,
    quantity        VARCHAR(50) NULL,
    quantity_total  INT NULL,
    equipment_group VARCHAR(100) NULL,
    discount        DECIMAL(20,6) NULL,
    is_option       TINYINT(1) NULL,
    factor          VARCHAR(50) NULL,
    `order`         VARCHAR(50) NULL,
    unit_price      DECIMAL(20,6) NULL,
    name            VARCHAR(255) NULL,
    external_remark TEXT NULL,
    internal_remark TEXT NULL,
    delay_notified  TINYINT(1) NULL,
    planperiod_start DATETIME NULL,
    planperiod_end  DATETIME NULL,
    has_missings    TINYINT(1) NULL,
    warehouse_reservations INT NULL,
    subrent_reservations INT NULL,
    serial_number_ids TEXT NULL,
    custom          JSON NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_equipment_group (equipment_group(50))
);

-- =============================================================================
-- ProjectEquipmentGroups
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_equipment_groups (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    project         VARCHAR(100) NULL,
    subproject      VARCHAR(100) NULL,
    additional_scanned TINYINT(1) NULL,
    name            VARCHAR(255) NULL,
    usageperiod_start DATETIME NULL,
    usageperiod_end DATETIME NULL,
    duration        DECIMAL(20,6) NULL,
    planperiod_start DATETIME NULL,
    planperiod_end  DATETIME NULL,
    is_delayed      TINYINT(1) NULL,
    `order`         VARCHAR(50) NULL,
    in_price_calculation TINYINT(1) NULL,
    remark          TEXT NULL,
    weight          DECIMAL(20,6) NULL,
    power           DECIMAL(20,6) NULL,
    `current`       DECIMAL(20,6) NULL,
    volume          DECIMAL(20,6) NULL,
    total_new_price DECIMAL(20,6) NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_project (project(50)),
    INDEX idx_subproject (subproject(50))
);

-- =============================================================================
-- ProjectFunctions
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_functions (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    cost_rate       VARCHAR(100) NULL,
    cost_accommodation DECIMAL(20,6) NULL,
    cost_catering   DECIMAL(20,6) NULL,
    cost_travel     DECIMAL(20,6) NULL,
    cost_other      DECIMAL(20,6) NULL,
    price_rate      VARCHAR(100) NULL,
    price_accommodation DECIMAL(20,6) NULL,
    price_catering  DECIMAL(20,6) NULL,
    price_travel    DECIMAL(20,6) NULL,
    price_other     DECIMAL(20,6) NULL,
    project         VARCHAR(100) NULL,
    subproject      VARCHAR(100) NULL,
    is_template     TINYINT(1) NULL,
    `group`         VARCHAR(100) NULL,
    name_external   VARCHAR(255) NULL,
    name            VARCHAR(255) NULL,
    travel_time_before DECIMAL(20,6) NULL,
    travel_time_after DECIMAL(20,6) NULL,
    usageperiod_start DATETIME NULL,
    planperiod_start_schedule_is_start TINYINT(1) NULL,
    usageperiod_start_schedule_is_start TINYINT(1) NULL,
    planperiod_end_schedule_is_start TINYINT(1) NULL,
    usageperiod_end_schedule_is_start TINYINT(1) NULL,
    usageperiod_end DATETIME NULL,
    planperiod_start DATETIME NULL,
    planperiod_end  DATETIME NULL,
    type            VARCHAR(50) NULL,
    duration        DECIMAL(20,6) NULL,
    amount          INT NULL,
    `break`         DECIMAL(20,6) NULL,
    distance        DECIMAL(20,6) NULL,
    twoway          TINYINT(1) NULL,
    taxclass        VARCHAR(100) NULL,
    ledger          VARCHAR(100) NULL,
    ledger_debit    VARCHAR(100) NULL,
    `order`         VARCHAR(50) NULL,
    remark_client   TEXT NULL,
    remark_planner  TEXT NULL,
    remark_crew     TEXT NULL,
    in_financial    TINYINT(1) NULL,
    in_planning     TINYINT(1) NULL,
    is_plannable    TINYINT(1) NULL,
    recurrence_group INT NULL,
    recurrence_enddate DATETIME NULL,
    recurrence_interval_unit VARCHAR(20) NULL,
    recurrence_interval INT NULL,
    recurrence_weekdays VARCHAR(50) NULL,
    price_fixed     DECIMAL(20,6) NULL,
    price_variable  DECIMAL(20,6) NULL,
    costs_fixed     DECIMAL(20,6) NULL,
    costs_variable  DECIMAL(20,6) NULL,
    price_total     DECIMAL(20,6) NULL,
    costs_total     DECIMAL(20,6) NULL,
    tags            TEXT NULL,
    custom          JSON NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_project (project(50)),
    INDEX idx_subproject (subproject(50))
);

-- =============================================================================
-- ProjectFunctionGroups
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_function_groups (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    name            VARCHAR(255) NULL,
    project         VARCHAR(100) NULL,
    subproject      VARCHAR(100) NULL,
    duration        DECIMAL(20,6) NULL,
    planperiod_start_schedule_is_start TINYINT(1) NULL,
    usageperiod_start_schedule_is_start TINYINT(1) NULL,
    planperiod_end_schedule_is_start TINYINT(1) NULL,
    usageperiod_end_schedule_is_start TINYINT(1) NULL,
    usageperiod_start DATETIME NULL,
    usageperiod_end DATETIME NULL,
    planperiod_start DATETIME NULL,
    planperiod_end  DATETIME NULL,
    remark          TEXT NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_project (project(50)),
    INDEX idx_subproject (subproject(50))
);

-- =============================================================================
-- ProjectCosts
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_costs (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    name            VARCHAR(255) NULL,
    remark          TEXT NULL,
    project         VARCHAR(100) NULL,
    quantity        INT NULL,
    discount        DECIMAL(20,6) NULL,
    `order`         VARCHAR(50) NULL,
    subproject      VARCHAR(100) NULL,
    is_template     TINYINT(1) NULL,
    taxclass        VARCHAR(100) NULL,
    ledger          VARCHAR(100) NULL,
    ledger_debit    VARCHAR(100) NULL,
    sale_price      DECIMAL(20,6) NULL,
    purchase_price  DECIMAL(20,6) NULL,
    custom          JSON NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_project (project(50)),
    INDEX idx_subproject (subproject(50))
);

-- =============================================================================
-- ProjectCrew
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_crew (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    cost_rate       VARCHAR(100) NULL,
    cost_accommodation DECIMAL(20,6) NULL,
    cost_catering   DECIMAL(20,6) NULL,
    cost_travel     DECIMAL(20,6) NULL,
    cost_other      DECIMAL(20,6) NULL,
    `function`      VARCHAR(100) NULL,
    crewmember      VARCHAR(100) NULL,
    visible         TINYINT(1) NULL,
    planperiod_start DATETIME NULL,
    planperiod_end  DATETIME NULL,
    transport       VARCHAR(100) NULL,
    remark          TEXT NULL,
    remark_planner  TEXT NULL,
    invoice_reference VARCHAR(255) NULL,
    project_leader  TINYINT(1) NULL,
    is_visible_on_dashboard TINYINT(1) NULL,
    costs           DECIMAL(20,6) NULL,
    cost_actual     DECIMAL(20,6) NULL,
    hours_registered DECIMAL(20,6) NULL,
    hours_planned   DECIMAL(20,6) NULL,
    cost_planned    DECIMAL(20,6) NULL,
    diff_cost       DECIMAL(20,6) NULL,
    diff_hours      DECIMAL(20,6) NULL,
    activity_status VARCHAR(50) NULL,
    custom          JSON NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_function (`function`(50)),
    INDEX idx_crewmember (crewmember(50))
);

-- =============================================================================
-- ProjectVehicles
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_vehicles (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    cost_rate       VARCHAR(100) NULL,
    `function`      VARCHAR(100) NULL,
    transport       VARCHAR(100) NULL,
    vehicle         VARCHAR(100) NULL,
    planningperiod_start DATETIME NULL,
    planningperiod_end DATETIME NULL,
    remark          TEXT NULL,
    remark_planner  TEXT NULL,
    costs           DECIMAL(20,6) NULL,
    custom          JSON NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified)
);

-- =============================================================================
-- Appointments
-- =============================================================================

CREATE TABLE IF NOT EXISTS appointments (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    name            VARCHAR(255) NULL,
    start           DATETIME NULL,
    end             DATETIME NULL,
    color           VARCHAR(50) NULL,
    location        VARCHAR(255) NULL,
    remark          TEXT NULL,
    is_public       TINYINT(1) NULL,
    is_plannable    TINYINT(1) NULL,
    recurrence_interval_unit VARCHAR(20) NULL,
    recurrence_enddate DATETIME NULL,
    recurrence_interval INT NULL,
    recurrence_group INT NULL,
    recurrence_weekdays VARCHAR(50) NULL,
    synchronization_id VARCHAR(255) NULL,
    synchronisation_uri VARCHAR(500) NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_start (start)
);

-- =============================================================================
-- AppointmentCrew
-- =============================================================================

CREATE TABLE IF NOT EXISTS appointment_crew (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    appointment     VARCHAR(100) NULL,
    crew            VARCHAR(100) NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_appointment (appointment(50))
);

-- =============================================================================
-- Accessories
-- =============================================================================

CREATE TABLE IF NOT EXISTS accessories (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    parent_equipment VARCHAR(100) NULL,
    equipment       VARCHAR(100) NULL,
    quantity        INT NULL,
    automatic       TINYINT(1) NULL,
    skip            TINYINT(1) NULL,
    is_free         TINYINT(1) NULL,
    `order`         VARCHAR(50) NULL,
    add_as_new_line TINYINT(1) NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified)
);

-- =============================================================================
-- StockLocations
-- =============================================================================

CREATE TABLE IF NOT EXISTS stock_locations (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    name            VARCHAR(255) NULL,
    city            VARCHAR(255) NULL,
    street          VARCHAR(255) NULL,
    house_number    VARCHAR(50) NULL,
    postal_code     VARCHAR(50) NULL,
    state_province  VARCHAR(100) NULL,
    country         VARCHAR(100) NULL,
    active          TINYINT(1) NULL,
    type            VARCHAR(50) NULL,
    color           VARCHAR(50) NULL,
    in_archive      TINYINT(1) NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified)
);

-- =============================================================================
-- CrewAvailability
-- =============================================================================

CREATE TABLE IF NOT EXISTS crew_availability (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    last_updater    VARCHAR(100) NULL,
    last_updated    DATETIME NULL,
    start           DATETIME NULL,
    end             DATETIME NULL,
    crewmember      VARCHAR(100) NULL,
    status          VARCHAR(10) NULL,
    remark          TEXT NULL,
    recurrence_interval_unit VARCHAR(20) NULL,
    recurrence_enddate DATETIME NULL,
    recurrence_interval INT NULL,
    recurrent_group INT NULL,
    recurrence_weekdays VARCHAR(50) NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_crewmember (crewmember(50)),
    INDEX idx_start (start)
);

-- =============================================================================
-- InvoiceLines
-- =============================================================================

CREATE TABLE IF NOT EXISTS invoice_lines (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    item            VARCHAR(100) NULL,
    base            DECIMAL(20,6) NULL,
    ledger          VARCHAR(100) NULL,
    vatrate         DECIMAL(20,6) NULL,
    vatamount       DECIMAL(20,6) NULL,
    priceincl       DECIMAL(20,6) NULL,
    ledgercode      VARCHAR(100) NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified)
);

-- =============================================================================
-- Contracts
-- =============================================================================

CREATE TABLE IF NOT EXISTS contracts (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    number          VARCHAR(100) NULL,
    customer        VARCHAR(100) NULL,
    contact         VARCHAR(100) NULL,
    date            DATE NULL,
    expiration_date DATE NULL,
    version         INT NULL,
    subject         VARCHAR(255) NULL,
    show_tax        TINYINT(1) NULL,
    project         VARCHAR(100) NULL,
    filename        VARCHAR(500) NULL,
    project_total_price DECIMAL(20,6) NULL,
    project_total_price_cancelled DECIMAL(20,6) NULL,
    project_rental_price DECIMAL(20,6) NULL,
    project_sale_price DECIMAL(20,6) NULL,
    project_crew_price DECIMAL(20,6) NULL,
    project_transport_price DECIMAL(20,6) NULL,
    project_other_price DECIMAL(20,6) NULL,
    project_insurance_price DECIMAL(20,6) NULL,
    price           DECIMAL(20,6) NULL,
    price_invat     DECIMAL(20,6) NULL,
    vat_amount      DECIMAL(20,6) NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_project (project(50))
);

-- =============================================================================
-- SerialNumbers
-- =============================================================================

CREATE TABLE IF NOT EXISTS serial_numbers (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    equipment       VARCHAR(100) NULL,
    serial          VARCHAR(255) NULL,
    purchasedate    DATE NULL,
    depreciation_monthly DECIMAL(20,6) NULL,
    book_value      DECIMAL(20,6) NULL,
    residual_value  DECIMAL(20,6) NULL,
    purchase_costs  DECIMAL(20,6) NULL,
    active          TINYINT(1) NULL,
    remark          TEXT NULL,
    ref             VARCHAR(255) NULL,
    asset_location  VARCHAR(100) NULL,
    image           VARCHAR(255) NULL,
    current_book_value DECIMAL(20,6) NULL,
    next_inspection DATETIME NULL,
    qrcodes         TEXT NULL,
    tags            TEXT NULL,
    last_subproject VARCHAR(100) NULL,
    sealed          TINYINT(1) NULL,
    custom          JSON NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_equipment (equipment(50)),
    INDEX idx_serial (serial)
);

-- =============================================================================
-- Invoices (Factuur)
-- =============================================================================

CREATE TABLE IF NOT EXISTS invoices (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    customer        VARCHAR(100) NULL,
    account_manager VARCHAR(100) NULL,
    contact         VARCHAR(100) NULL,
    expiration      DATE NULL,
    date            DATE NULL,
    number          VARCHAR(100) NULL,
    procent         DECIMAL(20,6) NULL,
    from_project    TINYINT(1) NULL,
    subject         VARCHAR(255) NULL,
    finalized       TINYINT(1) NULL,
    integration_reference_id VARCHAR(255) NULL,
    project         VARCHAR(100) NULL,
    filename        VARCHAR(500) NULL,
    project_total_price DECIMAL(20,6) NULL,
    project_total_price_cancelled DECIMAL(20,6) NULL,
    project_rental_price DECIMAL(20,6) NULL,
    project_sale_price DECIMAL(20,6) NULL,
    project_crew_price DECIMAL(20,6) NULL,
    project_transport_price DECIMAL(20,6) NULL,
    project_other_price DECIMAL(20,6) NULL,
    project_insurance_price DECIMAL(20,6) NULL,
    sum_factuurregels DECIMAL(20,6) NULL,
    price           DECIMAL(20,6) NULL,
    price_invat     DECIMAL(20,6) NULL,
    vat_amount      DECIMAL(20,6) NULL,
    invoicetype     VARCHAR(50) NULL,
    outstanding_balance DECIMAL(20,6) NULL,
    total_paid      DECIMAL(20,6) NULL,
    is_paid         TINYINT(1) NULL,
    date_sent       DATETIME NULL,
    payment_reminder_sent INT NULL,
    final_payment_reminder_sent DATETIME NULL,
    payment_date    DATETIME NULL,
    days_after_expiry INT NULL,
    tags            TEXT NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_project (project(50)),
    INDEX idx_number (number)
);

-- =============================================================================
-- Files
-- =============================================================================

CREATE TABLE IF NOT EXISTS files (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    readable_name   VARCHAR(500) NULL,
    expiration      DATETIME NULL,
    size            INT NULL,
    image           TINYINT(1) NULL,
    item            VARCHAR(100) NULL,
    itemtype        INT NULL,
    description     TEXT NULL,
    in_documents    TINYINT(1) NULL,
    in_webshop      TINYINT(1) NULL,
    classified      TINYINT(1) NULL,
    public          TINYINT(1) NULL,
    type            VARCHAR(100) NULL,
    preview_of      VARCHAR(100) NULL,
    previewstatus   VARCHAR(50) NULL,
    file_item       INT NULL,
    file_itemtype   VARCHAR(100) NULL,
    folder          VARCHAR(100) NULL,
    path            TEXT NULL,
    path_without_file_name TEXT NULL,
    path_with_file_folders TEXT NULL,
    name_without_extension VARCHAR(500) NULL,
    friendly_name_without_extension VARCHAR(500) NULL,
    extension       VARCHAR(20) NULL,
    url             TEXT NULL,
    proxy_url       TEXT NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified)
);

-- =============================================================================
-- Folders
-- =============================================================================

CREATE TABLE IF NOT EXISTS folders (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    parent          VARCHAR(100) NULL,
    name            VARCHAR(255) NULL,
    `order`         VARCHAR(50) NULL,
    itemtype        VARCHAR(50) NULL,
    path            TEXT NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified)
);

-- =============================================================================
-- TimeRegistrationActivities
-- =============================================================================

CREATE TABLE IF NOT EXISTS time_registration_activities (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    time_registration VARCHAR(100) NULL,
    project_function VARCHAR(100) NULL,
    subproject_function VARCHAR(100) NULL,
    description     TEXT NULL,
    duration        DECIMAL(20,6) NULL,
    is_activity     TINYINT(1) NULL,
    `from`          DATETIME NULL,
    `to`            DATETIME NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified)
);

-- =============================================================================
-- Ledgers
-- =============================================================================

CREATE TABLE IF NOT EXISTS ledgers (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    code            VARCHAR(100) NULL,
    is_credit       TINYINT(1) NULL,
    is_debit        TINYINT(1) NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified)
);

-- =============================================================================
-- Subrentals
-- =============================================================================

CREATE TABLE IF NOT EXISTS subrentals (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    name            VARCHAR(255) NULL,
    accountmanager  VARCHAR(100) NULL,
    reference       VARCHAR(255) NULL,
    supplier        VARCHAR(100) NULL,
    number          VARCHAR(100) NULL,
    contactperson   VARCHAR(100) NULL,
    location        VARCHAR(100) NULL,
    location_contact VARCHAR(100) NULL,
    usageperiod_start DATETIME NULL,
    usageperiod_end DATETIME NULL,
    planperiod_start DATETIME NULL,
    planperiod_end  DATETIME NULL,
    delivery_in     DATETIME NULL,
    delivery_out    DATETIME NULL,
    equipment_cost  DECIMAL(20,6) NULL,
    price           DECIMAL(20,6) NULL,
    extra_cost      DECIMAL(20,6) NULL,
    auto_update_costs TINYINT(1) NULL,
    remark          TEXT NULL,
    type            VARCHAR(50) NULL,
    status          VARCHAR(50) NULL,
    sent            DATETIME NULL,
    asset_location_to VARCHAR(100) NULL,
    asset_location_from VARCHAR(100) NULL,
    is_internal     TINYINT(1) NULL,
    supplier_project VARCHAR(100) NULL,
    tags            TEXT NULL,
    custom          JSON NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_supplier (supplier(50))
);

-- =============================================================================
-- SubrentalEquipmentGroups
-- =============================================================================

CREATE TABLE IF NOT EXISTS subrental_equipment_groups (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    subrental       VARCHAR(100) NULL,
    name            VARCHAR(255) NULL,
    `order`         VARCHAR(50) NULL,
    supplier_category VARCHAR(100) NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified)
);

-- =============================================================================
-- SubrentalEquipment
-- =============================================================================

CREATE TABLE IF NOT EXISTS subrental_equipment (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    subrental_group VARCHAR(100) NULL,
    equipment       VARCHAR(100) NULL,
    parent          VARCHAR(100) NULL,
    planperiod_start DATETIME NULL,
    planperiod_end  DATETIME NULL,
    name            VARCHAR(255) NULL,
    quantity        INT NULL,
    quantity_total  INT NULL,
    unit_price      DECIMAL(20,6) NULL,
    discount        DECIMAL(20,6) NULL,
    factor          VARCHAR(50) NULL,
    `order`         VARCHAR(50) NULL,
    remark          TEXT NULL,
    lineprice       DECIMAL(20,6) NULL,
    supplier_planningmateriaal VARCHAR(100) NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified)
);

-- =============================================================================
-- Quotations
-- =============================================================================

CREATE TABLE IF NOT EXISTS quotations (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    number          VARCHAR(100) NULL,
    customer        VARCHAR(100) NULL,
    contact         VARCHAR(100) NULL,
    date            DATE NULL,
    expiration_date DATE NULL,
    version         INT NULL,
    subject         VARCHAR(255) NULL,
    show_tax        TINYINT(1) NULL,
    project         VARCHAR(100) NULL,
    filename        VARCHAR(500) NULL,
    project_total_price DECIMAL(20,6) NULL,
    project_total_price_cancelled DECIMAL(20,6) NULL,
    project_rental_price DECIMAL(20,6) NULL,
    project_sale_price DECIMAL(20,6) NULL,
    project_crew_price DECIMAL(20,6) NULL,
    project_transport_price DECIMAL(20,6) NULL,
    project_other_price DECIMAL(20,6) NULL,
    project_insurance_price DECIMAL(20,6) NULL,
    price           DECIMAL(20,6) NULL,
    price_invat     DECIMAL(20,6) NULL,
    vat_amount      DECIMAL(20,6) NULL,
    tags            TEXT NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_project (project(50))
);

-- =============================================================================
-- ProjectRequests
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_requests (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    linked_contact  VARCHAR(100) NULL,
    contact_mailing_number VARCHAR(50) NULL,
    contact_mailing_country VARCHAR(100) NULL,
    contact_name    VARCHAR(255) NULL,
    contact_mailing_postalcode VARCHAR(50) NULL,
    contact_phone   VARCHAR(50) NULL,
    contact_mailing_city VARCHAR(255) NULL,
    contact_mailing_street VARCHAR(255) NULL,
    linked_contact_person VARCHAR(100) NULL,
    contact_person_lastname VARCHAR(255) NULL,
    contact_person_email VARCHAR(255) NULL,
    contact_person_middle_name VARCHAR(255) NULL,
    contact_person_first_name VARCHAR(255) NULL,
    usageperiod_end DATETIME NULL,
    usageperiod_start DATETIME NULL,
    is_paid         TINYINT(1) NULL,
    language        VARCHAR(20) NULL,
    `in`            DATETIME NULL,
    `out`           DATETIME NULL,
    linked_location VARCHAR(100) NULL,
    location_mailing_number VARCHAR(50) NULL,
    location_mailing_country VARCHAR(100) NULL,
    location_name   VARCHAR(255) NULL,
    location_mailing_postalcode VARCHAR(50) NULL,
    location_mailing_city VARCHAR(255) NULL,
    location_mailing_street VARCHAR(255) NULL,
    location_phone  VARCHAR(50) NULL,
    name            VARCHAR(255) NULL,
    external_reference INT NULL,
    remark          TEXT NULL,
    planperiod_end  DATETIME NULL,
    planperiod_start DATETIME NULL,
    price           DECIMAL(20,6) NULL,
    linked_project  VARCHAR(100) NULL,
    source          VARCHAR(100) NULL,
    status          VARCHAR(50) NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_status (status)
);

-- =============================================================================
-- ProjectRequestEquipment
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_request_equipment (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    quantity        INT NULL,
    quantity_total  INT NULL,
    is_comment      TINYINT(1) NULL,
    is_kit          TINYINT(1) NULL,
    discount        DECIMAL(20,6) NULL,
    linked_equipment VARCHAR(100) NULL,
    name            VARCHAR(255) NULL,
    external_remark TEXT NULL,
    parent          VARCHAR(100) NULL,
    unit_price      DECIMAL(20,6) NULL,
    project_request VARCHAR(100) NULL,
    factor          VARCHAR(50) NULL,
    `order`         VARCHAR(50) NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_project_request (project_request(50))
);

-- =============================================================================
-- CrewRates
-- =============================================================================

CREATE TABLE IF NOT EXISTS crew_rates (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    name            VARCHAR(255) NULL,
    archived        TINYINT(1) NULL,
    type            VARCHAR(50) NULL,
    subtype         VARCHAR(50) NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified)
);

-- =============================================================================
-- CrewRateFactors
-- =============================================================================

CREATE TABLE IF NOT EXISTS crew_rate_factors (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    rate_id         VARCHAR(100) NULL,
    `from`          DECIMAL(20,6) NULL,
    `to`            DECIMAL(20,6) NULL,
    variable        DECIMAL(20,6) NULL,
    fixed           DECIMAL(20,6) NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified)
);

-- =============================================================================
-- Repairs
-- =============================================================================

CREATE TABLE IF NOT EXISTS repairs (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    internal_name   VARCHAR(255) NULL,
    equipment       VARCHAR(100) NULL,
    serialnumber    VARCHAR(100) NULL,
    reporter        VARCHAR(100) NULL,
    assignee        VARCHAR(100) NULL,
    external_repairer VARCHAR(100) NULL,
    number          VARCHAR(100) NULL,
    repairperiod_start DATETIME NULL,
    repairperiod_end DATETIME NULL,
    amount          INT NULL,
    remark          TEXT NULL,
    repair_costs    DECIMAL(20,6) NULL,
    is_usable       TINYINT(1) NULL,
    costs_charged_to_customer VARCHAR(100) NULL,
    subproject      VARCHAR(100) NULL,
    stock_location  VARCHAR(100) NULL,
    tags            TEXT NULL,
    custom          JSON NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_equipment (equipment(50))
);

-- =============================================================================
-- EquipmentSetContent
-- =============================================================================

CREATE TABLE IF NOT EXISTS equipment_set_content (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    quantity        VARCHAR(50) NULL,
    parent_equipment VARCHAR(100) NULL,
    `order`         VARCHAR(50) NULL,
    equipment       VARCHAR(100) NULL,
    is_fixed        TINYINT(1) NULL,
    is_physically_connected TINYINT(1) NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified)
);

-- =============================================================================
-- Statuses
-- =============================================================================

CREATE TABLE IF NOT EXISTS statuses (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    name            VARCHAR(255) NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified)
);

-- =============================================================================
-- TaxClasses
-- =============================================================================

CREATE TABLE IF NOT EXISTS tax_classes (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    name            VARCHAR(255) NULL,
    code            VARCHAR(100) NULL,
    type            VARCHAR(50) NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified)
);

-- =============================================================================
-- ProjectTypes
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_types (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    name            VARCHAR(255) NULL,
    color           VARCHAR(50) NULL,
    type            VARCHAR(50) NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified)
);

-- =============================================================================
-- TimeRegistrations
-- =============================================================================

CREATE TABLE IF NOT EXISTS time_registrations (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    crewmember      VARCHAR(100) NULL,
    start           DATETIME NULL,
    end             DATETIME NULL,
    distance        DECIMAL(20,6) NULL,
    is_lunch_included TINYINT(1) NULL,
    leavetype       VARCHAR(100) NULL,
    leaverequest    VARCHAR(100) NULL,
    duration        DECIMAL(20,6) NULL,
    break_duration  DECIMAL(20,6) NULL,
    travel_time     DECIMAL(20,6) NULL,
    correction_duration DECIMAL(20,6) NULL,
    remark          TEXT NULL,
    status          VARCHAR(50) NULL,
    break_duration_with_start_end DECIMAL(20,6) NULL,
    custom          JSON NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_crewmember (crewmember(50)),
    INDEX idx_start (start)
);

-- =============================================================================
-- Vehicles
-- =============================================================================

CREATE TABLE IF NOT EXISTS vehicles (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    folder          VARCHAR(100) NULL,
    name            VARCHAR(255) NULL,
    cost_rate       VARCHAR(100) NULL,
    in_planner      TINYINT(1) NULL,
    height          DECIMAL(20,6) NULL,
    length          DECIMAL(20,6) NULL,
    width           DECIMAL(20,6) NULL,
    seats           INT NULL,
    inspection_date DATE NULL,
    licenseplate    VARCHAR(50) NULL,
    remark          TEXT NULL,
    payload_capacity DECIMAL(20,6) NULL,
    surface_area    VARCHAR(50) NULL,
    multiple        TINYINT(1) NULL,
    image           VARCHAR(255) NULL,
    asset_location  VARCHAR(100) NULL,
    tags            TEXT NULL,
    distance_cost   DECIMAL(20,6) NULL,
    fixed_cost      DECIMAL(20,6) NULL,
    custom          JSON NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified)
);

-- =============================================================================
-- StockMovements
-- =============================================================================

CREATE TABLE IF NOT EXISTS stock_movements (
    id              INT PRIMARY KEY,
    created         DATETIME NULL,
    modified        DATETIME NULL,
    creator         VARCHAR(100) NULL,
    displayname     VARCHAR(255) NULL,
    amount          INT NULL,
    equipment       VARCHAR(100) NULL,
    projectequipment VARCHAR(100) NULL,
    description     TEXT NULL,
    details         TEXT NULL,
    date            DATETIME NULL,
    type            VARCHAR(50) NULL,
    stock_location  VARCHAR(100) NULL,
    api_client      VARCHAR(255) NULL,
    synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_modified (modified),
    INDEX idx_equipment (equipment(50))
);

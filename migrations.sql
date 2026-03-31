-- =============================================================================
-- Retry-kø til fejlede API requests (HubSpot + Rentman)
-- Kør dette mod main databasen (DB_NAME) før deploy
-- =============================================================================

CREATE TABLE IF NOT EXISTS failed_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    api VARCHAR(20) NOT NULL COMMENT 'hubspot eller rentman',
    method VARCHAR(10) NOT NULL,
    endpoint VARCHAR(500) NOT NULL,
    body TEXT,
    error_message TEXT,
    retry_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_retry_at TIMESTAMP NULL,
    INDEX idx_api (api)
);

-- =============================================================================
-- Forhindrer dubletter i synced_order ved concurrent writes
-- Kør mod main databasen (DB_NAME) hvis constraint ikke allerede eksisterer
-- =============================================================================

ALTER TABLE synced_order
    ADD UNIQUE INDEX uq_rentman_subproject_id (rentman_subproject_id);

-- =============================================================================
-- Rentman line item sync tabeller
-- Project Functions, Function Groups og Costs
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_function_groups (
    id              INT PRIMARY KEY,
    created         DATETIME,
    modified        DATETIME,
    creator         VARCHAR(50),
    displayname     VARCHAR(255),
    project         VARCHAR(50),
    subproject      VARCHAR(50),
    name            VARCHAR(255),
    `order`         INT,
    usageperiod_start DATETIME,
    usageperiod_end   DATETIME,
    planperiod_start  DATETIME,
    planperiod_end    DATETIME
);

CREATE TABLE IF NOT EXISTS project_functions (
    id                  INT PRIMARY KEY,
    created             DATETIME,
    modified            DATETIME,
    creator             VARCHAR(50),
    displayname         VARCHAR(255),
    project             VARCHAR(50),
    subproject          VARCHAR(50),
    function_group      VARCHAR(50),
    name                VARCHAR(255),
    `order`             INT,
    price               DECIMAL(20,10),
    quantity            DECIMAL(20,10),
    discount            DECIMAL(20,10),
    unit_price          DECIMAL(20,10),
    usageperiod_start   DATETIME,
    usageperiod_end     DATETIME,
    planperiod_start    DATETIME,
    planperiod_end      DATETIME,
    ledger              VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS project_costs (
    id          INT PRIMARY KEY,
    created     DATETIME,
    modified    DATETIME,
    creator     VARCHAR(50),
    displayname VARCHAR(255),
    project     VARCHAR(50),
    subproject  VARCHAR(50),
    name        VARCHAR(255),
    `order`     INT,
    price       DECIMAL(20,10),
    quantity    DECIMAL(20,10),
    discount    DECIMAL(20,10),
    unit_price  DECIMAL(20,10),
    ledger      VARCHAR(50),
    factor      DECIMAL(20,10)
);

-- =============================================================================
-- Price line items tracking tabel
-- Tracker HubSpot line items oprettet fra prisberegninger
-- Bruges til at opdatere eksisterende line items via webhooks
-- Kør mod main databasen (DB_NAME)
-- =============================================================================

CREATE TABLE IF NOT EXISTS price_line_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hubspot_line_item_id VARCHAR(50) NOT NULL,
    line_item_type VARCHAR(50) NOT NULL COMMENT 'Salg med moms, Salg uden moms, Ydelse med moms, Ydelse uden moms, Insurance',
    parent_type ENUM('deal', 'order') NOT NULL,
    rentman_project_id INT NOT NULL,
    rentman_subproject_id INT NULL COMMENT 'Kun sat for orders',
    hubspot_parent_id VARCHAR(50) NOT NULL COMMENT 'HubSpot deal eller order ID',
    price DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE INDEX uq_parent_type (hubspot_parent_id, line_item_type, parent_type),
    INDEX idx_rentman_project (rentman_project_id),
    INDEX idx_rentman_subproject (rentman_subproject_id),
    INDEX idx_hubspot_parent (hubspot_parent_id),
    INDEX idx_line_item (hubspot_line_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

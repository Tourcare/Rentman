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

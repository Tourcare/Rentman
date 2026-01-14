-- Sync tables for HubSpot-Rentman integration
-- Run this script to create the necessary tables for sync logging and dashboard integration

-- Table for logging all sync operations
CREATE TABLE IF NOT EXISTS sync_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sync_type ENUM('company', 'contact', 'deal', 'order', 'full') NOT NULL,
    direction ENUM('hubspot_to_rentman', 'rentman_to_hubspot', 'bidirectional') NOT NULL,
    status ENUM('started', 'in_progress', 'completed', 'failed', 'partial') NOT NULL,
    total_items INT DEFAULT 0,
    processed_items INT DEFAULT 0,
    success_count INT DEFAULT 0,
    error_count INT DEFAULT 0,
    skip_count INT DEFAULT 0,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    triggered_by VARCHAR(100) DEFAULT 'system',
    metadata JSON,
    INDEX idx_sync_type (sync_type),
    INDEX idx_status (status),
    INDEX idx_started_at (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table for logging individual item sync results
CREATE TABLE IF NOT EXISTS sync_item_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sync_log_id INT NOT NULL,
    item_type ENUM('company', 'contact', 'deal', 'order') NOT NULL,
    hubspot_id VARCHAR(50),
    rentman_id VARCHAR(50),
    action ENUM('create', 'update', 'delete', 'skip', 'error') NOT NULL,
    status ENUM('success', 'failed', 'skipped') NOT NULL,
    error_message TEXT,
    error_code VARCHAR(50),
    data_before JSON,
    data_after JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sync_log_id) REFERENCES sync_log(id) ON DELETE CASCADE,
    INDEX idx_sync_log_id (sync_log_id),
    INDEX idx_item_type (item_type),
    INDEX idx_status (status),
    INDEX idx_hubspot_id (hubspot_id),
    INDEX idx_rentman_id (rentman_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table for tracking sync errors (for dashboard alerts)
CREATE TABLE IF NOT EXISTS sync_errors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sync_log_id INT,
    sync_item_log_id INT,
    error_type ENUM('api_error', 'validation_error', 'connection_error', 'timeout', 'rate_limit', 'unknown') NOT NULL,
    severity ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',
    source_system ENUM('hubspot', 'rentman', 'database', 'internal') NOT NULL,
    error_message TEXT NOT NULL,
    error_code VARCHAR(100),
    stack_trace TEXT,
    context JSON,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMP NULL,
    resolved_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sync_log_id) REFERENCES sync_log(id) ON DELETE SET NULL,
    FOREIGN KEY (sync_item_log_id) REFERENCES sync_item_log(id) ON DELETE SET NULL,
    INDEX idx_error_type (error_type),
    INDEX idx_severity (severity),
    INDEX idx_resolved (resolved),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table for sync schedule configuration
CREATE TABLE IF NOT EXISTS sync_schedule (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sync_type ENUM('company', 'contact', 'deal', 'order', 'full') NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    cron_expression VARCHAR(100) NOT NULL,
    last_run_at TIMESTAMP NULL,
    next_run_at TIMESTAMP NULL,
    last_status ENUM('success', 'failed', 'running') NULL,
    config JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_sync_type (sync_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table for sync statistics (aggregated for dashboard)
CREATE TABLE IF NOT EXISTS sync_statistics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    date DATE NOT NULL,
    sync_type ENUM('company', 'contact', 'deal', 'order', 'full') NOT NULL,
    total_syncs INT DEFAULT 0,
    successful_syncs INT DEFAULT 0,
    failed_syncs INT DEFAULT 0,
    total_items_processed INT DEFAULT 0,
    total_errors INT DEFAULT 0,
    avg_duration_seconds DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_date_type (date, sync_type),
    INDEX idx_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default sync schedules
INSERT INTO sync_schedule (sync_type, cron_expression, config) VALUES
    ('company', '0 */4 * * *', '{"batchSize": 100, "direction": "bidirectional"}'),
    ('contact', '0 */4 * * *', '{"batchSize": 100, "direction": "bidirectional"}'),
    ('deal', '0 */2 * * *', '{"batchSize": 50, "direction": "bidirectional"}'),
    ('order', '0 */2 * * *', '{"batchSize": 50, "direction": "bidirectional"}'),
    ('full', '0 2 * * 0', '{"batchSize": 100, "direction": "bidirectional"}')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;

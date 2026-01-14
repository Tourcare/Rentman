-- Error logging tables for HubSpot-Rentman integration
-- Run this script to create the necessary tables for error logging

-- Table for logging all integration errors
CREATE TABLE IF NOT EXISTS integration_errors (
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- Error classification
    error_type ENUM(
        'webhook_error',
        'api_error',
        'database_error',
        'validation_error',
        'sync_error',
        'timeout_error',
        'rate_limit_error',
        'auth_error',
        'unknown'
    ) NOT NULL DEFAULT 'unknown',

    severity ENUM('debug', 'info', 'warn', 'error', 'critical') NOT NULL DEFAULT 'error',

    -- Source information
    source_module VARCHAR(100) NOT NULL,
    source_function VARCHAR(100),
    source_system ENUM('hubspot', 'rentman', 'database', 'internal', 'webhook') NOT NULL DEFAULT 'internal',

    -- Error details
    error_message TEXT NOT NULL,
    error_code VARCHAR(100),
    stack_trace TEXT,

    -- Context information
    request_method VARCHAR(10),
    request_path VARCHAR(500),
    request_body JSON,
    response_status INT,
    response_body JSON,

    -- Related IDs
    hubspot_id VARCHAR(50),
    rentman_id VARCHAR(50),
    webhook_event_id VARCHAR(100),

    -- Additional context
    context JSON,

    -- Resolution tracking
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMP NULL,
    resolved_by VARCHAR(100),
    resolution_notes TEXT,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Indexes
    INDEX idx_error_type (error_type),
    INDEX idx_severity (severity),
    INDEX idx_source_module (source_module),
    INDEX idx_source_system (source_system),
    INDEX idx_resolved (resolved),
    INDEX idx_created_at (created_at),
    INDEX idx_hubspot_id (hubspot_id),
    INDEX idx_rentman_id (rentman_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table for webhook event logging
CREATE TABLE IF NOT EXISTS webhook_events (
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- Event source
    source ENUM('hubspot', 'rentman') NOT NULL,

    -- Event details
    event_id VARCHAR(100),
    event_type VARCHAR(100) NOT NULL,
    subscription_type VARCHAR(100),

    -- Object information
    object_type VARCHAR(50),
    object_id VARCHAR(50),

    -- Processing status
    status ENUM('received', 'processing', 'completed', 'failed', 'ignored') NOT NULL DEFAULT 'received',

    -- Payload
    raw_payload JSON,

    -- Processing info
    processing_started_at TIMESTAMP NULL,
    processing_completed_at TIMESTAMP NULL,
    processing_duration_ms INT,

    -- Error reference
    error_id INT,
    error_message TEXT,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Indexes
    INDEX idx_source (source),
    INDEX idx_event_type (event_type),
    INDEX idx_object_type (object_type),
    INDEX idx_object_id (object_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at),

    FOREIGN KEY (error_id) REFERENCES integration_errors(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table for API call logging
CREATE TABLE IF NOT EXISTS api_call_log (
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- API target
    target_system ENUM('hubspot', 'rentman') NOT NULL,

    -- Request details
    method VARCHAR(10) NOT NULL,
    endpoint VARCHAR(500) NOT NULL,
    request_headers JSON,
    request_body JSON,

    -- Response details
    response_status INT,
    response_body JSON,

    -- Performance
    duration_ms INT,

    -- Related webhook
    webhook_event_id INT,

    -- Error reference
    error_id INT,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Indexes
    INDEX idx_target_system (target_system),
    INDEX idx_method (method),
    INDEX idx_response_status (response_status),
    INDEX idx_created_at (created_at),

    FOREIGN KEY (webhook_event_id) REFERENCES webhook_events(id) ON DELETE SET NULL,
    FOREIGN KEY (error_id) REFERENCES integration_errors(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table for error statistics (aggregated daily)
CREATE TABLE IF NOT EXISTS error_statistics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    date DATE NOT NULL,

    -- Counts by type
    webhook_errors INT DEFAULT 0,
    api_errors INT DEFAULT 0,
    database_errors INT DEFAULT 0,
    validation_errors INT DEFAULT 0,
    sync_errors INT DEFAULT 0,
    other_errors INT DEFAULT 0,

    -- Counts by severity
    critical_count INT DEFAULT 0,
    error_count INT DEFAULT 0,
    warn_count INT DEFAULT 0,

    -- Counts by system
    hubspot_errors INT DEFAULT 0,
    rentman_errors INT DEFAULT 0,
    internal_errors INT DEFAULT 0,

    -- Resolution stats
    resolved_count INT DEFAULT 0,
    unresolved_count INT DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY unique_date (date),
    INDEX idx_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- View for recent unresolved errors (for dashboard)
CREATE OR REPLACE VIEW v_unresolved_errors AS
SELECT
    id,
    error_type,
    severity,
    source_module,
    source_system,
    error_message,
    error_code,
    hubspot_id,
    rentman_id,
    created_at,
    TIMESTAMPDIFF(MINUTE, created_at, NOW()) as minutes_ago
FROM integration_errors
WHERE resolved = FALSE
ORDER BY
    FIELD(severity, 'critical', 'error', 'warn', 'info', 'debug'),
    created_at DESC;

-- View for error summary (for dashboard)
CREATE OR REPLACE VIEW v_error_summary AS
SELECT
    DATE(created_at) as date,
    error_type,
    severity,
    source_system,
    COUNT(*) as error_count,
    SUM(CASE WHEN resolved = TRUE THEN 1 ELSE 0 END) as resolved_count
FROM integration_errors
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(created_at), error_type, severity, source_system
ORDER BY date DESC, error_count DESC;

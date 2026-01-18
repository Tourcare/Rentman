-- phpMyAdmin SQL Dump
-- version 5.2.1deb1
-- https://www.phpmyadmin.net/
--
-- Vært: mysql11.gigahost.dk
-- Genereringstid: 15. 01 2026 kl. 09:09:48
-- Serverversion: 5.7.16
-- PHP-version: 8.2.26

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `maestromedia_crm_sync`
--

-- --------------------------------------------------------

--
-- Struktur-dump for tabellen `api_call_log`
--

CREATE TABLE `api_call_log` (
  `id` int(11) NOT NULL,
  `target_system` enum('hubspot','rentman') COLLATE utf8mb4_unicode_ci NOT NULL,
  `method` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `endpoint` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `request_headers` json DEFAULT NULL,
  `request_body` json DEFAULT NULL,
  `response_status` int(11) DEFAULT NULL,
  `response_body` json DEFAULT NULL,
  `duration_ms` int(11) DEFAULT NULL,
  `webhook_event_id` int(11) DEFAULT NULL,
  `error_id` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur-dump for tabellen `error_statistics`
--

CREATE TABLE `error_statistics` (
  `id` int(11) NOT NULL,
  `date` date NOT NULL,
  `webhook_errors` int(11) DEFAULT '0',
  `api_errors` int(11) DEFAULT '0',
  `database_errors` int(11) DEFAULT '0',
  `validation_errors` int(11) DEFAULT '0',
  `sync_errors` int(11) DEFAULT '0',
  `other_errors` int(11) DEFAULT '0',
  `critical_count` int(11) DEFAULT '0',
  `error_count` int(11) DEFAULT '0',
  `warn_count` int(11) DEFAULT '0',
  `hubspot_errors` int(11) DEFAULT '0',
  `rentman_errors` int(11) DEFAULT '0',
  `internal_errors` int(11) DEFAULT '0',
  `resolved_count` int(11) DEFAULT '0',
  `unresolved_count` int(11) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Data dump for tabellen `error_statistics`
--

INSERT INTO `error_statistics` (`id`, `date`, `webhook_errors`, `api_errors`, `database_errors`, `validation_errors`, `sync_errors`, `other_errors`, `critical_count`, `error_count`, `warn_count`, `hubspot_errors`, `rentman_errors`, `internal_errors`, `resolved_count`, `unresolved_count`, `created_at`, `updated_at`) VALUES
(1, '2026-01-15', 4, 0, 8, 548, 0, 187, 8, 191, 548, 0, 367, 380, 1, 746, '2026-01-15 07:57:53', '2026-01-15 09:06:19');

-- --------------------------------------------------------

--
-- Struktur-dump for tabellen `integration_errors`
--

CREATE TABLE `integration_errors` (
  `id` int(11) NOT NULL,
  `error_type` enum('webhook_error','api_error','database_error','validation_error','sync_error','timeout_error','rate_limit_error','auth_error','unknown') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unknown',
  `severity` enum('debug','info','warn','error','critical') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'error',
  `source_module` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_function` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_system` enum('hubspot','rentman','database','internal','webhook') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'internal',
  `error_message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `error_code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `stack_trace` text COLLATE utf8mb4_unicode_ci,
  `request_method` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `request_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `request_body` json DEFAULT NULL,
  `response_status` int(11) DEFAULT NULL,
  `response_body` json DEFAULT NULL,
  `hubspot_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `rentman_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `webhook_event_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `context` json DEFAULT NULL,
  `resolved` tinyint(1) DEFAULT '0',
  `resolved_at` timestamp NULL DEFAULT NULL,
  `resolved_by` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `resolution_notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur-dump for tabellen `medarbejder`
--

CREATE TABLE `medarbejder` (
  `id` int(11) NOT NULL,
  `navn` varchar(255) NOT NULL,
  `Fornavn` varchar(255) NOT NULL,
  `Efternavn` varchar(255) NOT NULL,
  `e_mail` varchar(255) NOT NULL,
  `job_title` varchar(255) NOT NULL,
  `telefon` varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

--
-- Struktur-dump for tabellen `synced_companies`
--

CREATE TABLE `synced_companies` (
  `id` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `rentman_id` varchar(255) NOT NULL,
  `hubspot_id` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

--
-- Struktur-dump for tabellen `synced_contacts`
--

CREATE TABLE `synced_contacts` (
  `id` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `rentman_id` varchar(255) NOT NULL,
  `hubspot_id` varchar(255) NOT NULL,
  `hubspot_company_conntected` varchar(500) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

--
-- Struktur-dump for tabellen `synced_deals`
--

CREATE TABLE `synced_deals` (
  `id` int(11) NOT NULL,
  `project_name` varchar(255) NOT NULL,
  `rentman_project_id` int(11) NOT NULL,
  `hubspot_project_id` varchar(50) NOT NULL,
  `synced_companies_id` varchar(255) NOT NULL,
  `synced_contact_id` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1;


--
-- Struktur-dump for tabellen `synced_order`
--

CREATE TABLE `synced_order` (
  `id` int(11) NOT NULL,
  `subproject_name` varchar(255) NOT NULL,
  `rentman_subproject_id` int(11) NOT NULL,
  `hubspot_order_id` varchar(50) NOT NULL,
  `synced_companies_id` varchar(255) NOT NULL,
  `synced_contact_id` varchar(255) NOT NULL,
  `synced_deals_id` varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

--
-- Struktur-dump for tabellen `synced_request`
--

CREATE TABLE `synced_request` (
  `id` int(11) NOT NULL,
  `rentman_request_id` varchar(50) NOT NULL,
  `hubspot_deal_id` varchar(50) NOT NULL,
  `synced_companies_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

--
-- Data dump for tabellen `synced_request`
--

INSERT INTO `synced_request` (`id`, `rentman_request_id`, `hubspot_deal_id`, `synced_companies_id`) VALUES
(24, '48', '395210392819', 1),
(28, '52', '404189206773', 133),
(29, '53', '405224954079', 10),
(30, '54', '405654833393', 245),
(32, '56', '409102825714', 0),
(39, '63', '420931727562', 284),
(40, '65', '420368792812', 284),
(41, '66', '420370950366', 284),
(55, '80', '435542116570', 0);

-- --------------------------------------------------------

--
-- Struktur-dump for tabellen `synced_users`
--

CREATE TABLE `synced_users` (
  `id` int(11) NOT NULL,
  `navn` varchar(255) NOT NULL,
  `hubspot_id` varchar(500) NOT NULL,
  `rentman_id` varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

--
-- Data dump for tabellen `synced_users`
--

INSERT INTO `synced_users` (`id`, `navn`, `hubspot_id`, `rentman_id`) VALUES
(1, 'Sylvester Erbs Ledet', '83337430', '262'),
(2, 'Thor Friis', '30392556', '33'),
(3, 'Lucas Kastrup', '31014107', '247'),
(4, 'Emil Pallisgaard', '31004074', '253'),
(5, 'Morten Riis', '31014081', '255'),
(6, 'Theo Henckel', '31014095', '249'),
(7, 'Carl Nilsson', '31014096', '248'),
(8, 'Lars Madsen', '31029656', '250');

-- --------------------------------------------------------

--
-- Struktur-dump for tabellen `sync_errors`
--

CREATE TABLE `sync_errors` (
  `id` int(11) NOT NULL,
  `sync_log_id` int(11) DEFAULT NULL,
  `sync_item_log_id` int(11) DEFAULT NULL,
  `error_type` enum('api_error','validation_error','connection_error','timeout','rate_limit','unknown') COLLATE utf8mb4_unicode_ci NOT NULL,
  `severity` enum('low','medium','high','critical') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'medium',
  `source_system` enum('hubspot','rentman','database','internal') COLLATE utf8mb4_unicode_ci NOT NULL,
  `error_message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `error_code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `stack_trace` text COLLATE utf8mb4_unicode_ci,
  `context` json DEFAULT NULL,
  `resolved` tinyint(1) DEFAULT '0',
  `resolved_at` timestamp NULL DEFAULT NULL,
  `resolved_by` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


--
-- Struktur-dump for tabellen `sync_item_log`
--

CREATE TABLE `sync_item_log` (
  `id` int(11) NOT NULL,
  `sync_log_id` int(11) NOT NULL,
  `item_type` enum('company','contact','deal','order') COLLATE utf8mb4_unicode_ci NOT NULL,
  `hubspot_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `rentman_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action` enum('create','update','delete','skip','error') COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('success','failed','skipped') COLLATE utf8mb4_unicode_ci NOT NULL,
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `error_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `data_before` json DEFAULT NULL,
  `data_after` json DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


--
-- Struktur-dump for tabellen `sync_log`
--

CREATE TABLE `sync_log` (
  `id` int(11) NOT NULL,
  `sync_type` enum('company','contact','deal','order','full') COLLATE utf8mb4_unicode_ci NOT NULL,
  `direction` enum('hubspot_to_rentman','rentman_to_hubspot','bidirectional') COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('started','in_progress','completed','failed','partial') COLLATE utf8mb4_unicode_ci NOT NULL,
  `total_items` int(11) DEFAULT '0',
  `processed_items` int(11) DEFAULT '0',
  `success_count` int(11) DEFAULT '0',
  `error_count` int(11) DEFAULT '0',
  `skip_count` int(11) DEFAULT '0',
  `started_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  `triggered_by` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT 'system',
  `metadata` json DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Data dump for tabellen `sync_log`
--

-- --------------------------------------------------------

--
-- Struktur-dump for tabellen `sync_schedule`
--

CREATE TABLE `sync_schedule` (
  `id` int(11) NOT NULL,
  `sync_type` enum('company','contact','deal','order','full') COLLATE utf8mb4_unicode_ci NOT NULL,
  `enabled` tinyint(1) DEFAULT '1',
  `cron_expression` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_run_at` timestamp NULL DEFAULT NULL,
  `next_run_at` timestamp NULL DEFAULT NULL,
  `last_status` enum('success','failed','running') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `config` json DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Data dump for tabellen `sync_schedule`
--
--
-- Struktur-dump for tabellen `sync_statistics`
--

CREATE TABLE `sync_statistics` (
  `id` int(11) NOT NULL,
  `date` date NOT NULL,
  `sync_type` enum('company','contact','deal','order','full') COLLATE utf8mb4_unicode_ci NOT NULL,
  `total_syncs` int(11) DEFAULT '0',
  `successful_syncs` int(11) DEFAULT '0',
  `failed_syncs` int(11) DEFAULT '0',
  `total_items_processed` int(11) DEFAULT '0',
  `total_errors` int(11) DEFAULT '0',
  `avg_duration_seconds` decimal(10,2) DEFAULT '0.00',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Stand-in-struktur for visning `v_error_summary`
-- (Se nedenfor for det aktuelle view)
--
CREATE TABLE `v_error_summary` (
`date` date
,`error_type` enum('webhook_error','api_error','database_error','validation_error','sync_error','timeout_error','rate_limit_error','auth_error','unknown')
,`severity` enum('debug','info','warn','error','critical')
,`source_system` enum('hubspot','rentman','database','internal','webhook')
,`error_count` bigint(21)
,`resolved_count` decimal(23,0)
);

-- --------------------------------------------------------

--
-- Stand-in-struktur for visning `v_unresolved_errors`
-- (Se nedenfor for det aktuelle view)
--
CREATE TABLE `v_unresolved_errors` (
`id` int(11)
,`error_type` enum('webhook_error','api_error','database_error','validation_error','sync_error','timeout_error','rate_limit_error','auth_error','unknown')
,`severity` enum('debug','info','warn','error','critical')
,`source_module` varchar(100)
,`source_system` enum('hubspot','rentman','database','internal','webhook')
,`error_message` text
,`error_code` varchar(100)
,`hubspot_id` varchar(50)
,`rentman_id` varchar(50)
,`created_at` timestamp
,`minutes_ago` bigint(21)
);

-- --------------------------------------------------------

--
-- Struktur-dump for tabellen `webhook_events`
--

CREATE TABLE `webhook_events` (
  `id` int(11) NOT NULL,
  `source` enum('hubspot','rentman') COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `event_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `subscription_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `object_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `object_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('received','processing','completed','failed','ignored') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'received',
  `raw_payload` json DEFAULT NULL,
  `processing_started_at` timestamp NULL DEFAULT NULL,
  `processing_completed_at` timestamp NULL DEFAULT NULL,
  `processing_duration_ms` int(11) DEFAULT NULL,
  `error_id` int(11) DEFAULT NULL,
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- --------------------------------------------------------

--
-- Struktur for visning `v_error_summary`
--
DROP TABLE IF EXISTS `v_error_summary`;

CREATE ALGORITHM=UNDEFINED DEFINER=`maestromedia`@`%` SQL SECURITY DEFINER VIEW `v_error_summary`  AS SELECT cast(`integration_errors`.`created_at` as date) AS `date`, `integration_errors`.`error_type` AS `error_type`, `integration_errors`.`severity` AS `severity`, `integration_errors`.`source_system` AS `source_system`, count(0) AS `error_count`, sum((case when (`integration_errors`.`resolved` = TRUE) then 1 else 0 end)) AS `resolved_count` FROM `integration_errors` WHERE (`integration_errors`.`created_at` >= (now() - interval 30 day)) GROUP BY cast(`integration_errors`.`created_at` as date), `integration_errors`.`error_type`, `integration_errors`.`severity`, `integration_errors`.`source_system` ORDER BY `date` DESC, `error_count` DESC ;

-- --------------------------------------------------------

--
-- Struktur for visning `v_unresolved_errors`
--
DROP TABLE IF EXISTS `v_unresolved_errors`;

CREATE ALGORITHM=UNDEFINED DEFINER=`maestromedia`@`%` SQL SECURITY DEFINER VIEW `v_unresolved_errors`  AS SELECT `integration_errors`.`id` AS `id`, `integration_errors`.`error_type` AS `error_type`, `integration_errors`.`severity` AS `severity`, `integration_errors`.`source_module` AS `source_module`, `integration_errors`.`source_system` AS `source_system`, `integration_errors`.`error_message` AS `error_message`, `integration_errors`.`error_code` AS `error_code`, `integration_errors`.`hubspot_id` AS `hubspot_id`, `integration_errors`.`rentman_id` AS `rentman_id`, `integration_errors`.`created_at` AS `created_at`, timestampdiff(MINUTE,`integration_errors`.`created_at`,now()) AS `minutes_ago` FROM `integration_errors` WHERE (`integration_errors`.`resolved` = FALSE) ORDER BY field(`integration_errors`.`severity`,'critical','error','warn','info','debug') ASC, `integration_errors`.`created_at` DESC ;

--
-- Begrænsninger for dumpede tabeller
--

--
-- Indeks for tabel `api_call_log`
--
ALTER TABLE `api_call_log`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_target_system` (`target_system`),
  ADD KEY `idx_method` (`method`),
  ADD KEY `idx_response_status` (`response_status`),
  ADD KEY `idx_created_at` (`created_at`),
  ADD KEY `webhook_event_id` (`webhook_event_id`),
  ADD KEY `error_id` (`error_id`);

--
-- Indeks for tabel `error_statistics`
--
ALTER TABLE `error_statistics`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_date` (`date`),
  ADD KEY `idx_date` (`date`);

--
-- Indeks for tabel `integration_errors`
--
ALTER TABLE `integration_errors`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_error_type` (`error_type`),
  ADD KEY `idx_severity` (`severity`),
  ADD KEY `idx_source_module` (`source_module`),
  ADD KEY `idx_source_system` (`source_system`),
  ADD KEY `idx_resolved` (`resolved`),
  ADD KEY `idx_created_at` (`created_at`),
  ADD KEY `idx_hubspot_id` (`hubspot_id`),
  ADD KEY `idx_rentman_id` (`rentman_id`);

--
-- Indeks for tabel `medarbejder`
--
ALTER TABLE `medarbejder`
  ADD PRIMARY KEY (`id`);

--
-- Indeks for tabel `missing_contacts`
--
ALTER TABLE `missing_contacts`
  ADD PRIMARY KEY (`id`);

--
-- Indeks for tabel `scraped_artists`
--
ALTER TABLE `scraped_artists`
  ADD PRIMARY KEY (`id`);

--
-- Indeks for tabel `synced_companies`
--
ALTER TABLE `synced_companies`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `rentman_id` (`rentman_id`);

--
-- Indeks for tabel `synced_contacts`
--
ALTER TABLE `synced_contacts`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `rentman_id` (`rentman_id`);

--
-- Indeks for tabel `synced_deals`
--
ALTER TABLE `synced_deals`
  ADD PRIMARY KEY (`id`);

--
-- Indeks for tabel `synced_order`
--
ALTER TABLE `synced_order`
  ADD PRIMARY KEY (`id`);

--
-- Indeks for tabel `synced_request`
--
ALTER TABLE `synced_request`
  ADD PRIMARY KEY (`id`);

--
-- Indeks for tabel `synced_users`
--
ALTER TABLE `synced_users`
  ADD PRIMARY KEY (`id`);

--
-- Indeks for tabel `sync_errors`
--
ALTER TABLE `sync_errors`
  ADD PRIMARY KEY (`id`),
  ADD KEY `sync_log_id` (`sync_log_id`),
  ADD KEY `sync_item_log_id` (`sync_item_log_id`),
  ADD KEY `idx_error_type` (`error_type`),
  ADD KEY `idx_severity` (`severity`),
  ADD KEY `idx_resolved` (`resolved`),
  ADD KEY `idx_created_at` (`created_at`);

--
-- Indeks for tabel `sync_item_log`
--
ALTER TABLE `sync_item_log`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_sync_log_id` (`sync_log_id`),
  ADD KEY `idx_item_type` (`item_type`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_hubspot_id` (`hubspot_id`),
  ADD KEY `idx_rentman_id` (`rentman_id`),
  ADD KEY `idx_created_at` (`created_at`);

--
-- Indeks for tabel `sync_log`
--
ALTER TABLE `sync_log`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_sync_type` (`sync_type`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_started_at` (`started_at`);

--
-- Indeks for tabel `sync_schedule`
--
ALTER TABLE `sync_schedule`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_sync_type` (`sync_type`);

--
-- Indeks for tabel `sync_statistics`
--
ALTER TABLE `sync_statistics`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_date_type` (`date`,`sync_type`),
  ADD KEY `idx_date` (`date`);

--
-- Indeks for tabel `webhook_events`
--
ALTER TABLE `webhook_events`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_source` (`source`),
  ADD KEY `idx_event_type` (`event_type`),
  ADD KEY `idx_object_type` (`object_type`),
  ADD KEY `idx_object_id` (`object_id`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_created_at` (`created_at`),
  ADD KEY `error_id` (`error_id`);

--
-- Brug ikke AUTO_INCREMENT for slettede tabeller
--

--
-- Tilføj AUTO_INCREMENT i tabel `api_call_log`
--
ALTER TABLE `api_call_log`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- Tilføj AUTO_INCREMENT i tabel `error_statistics`
--
ALTER TABLE `error_statistics`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=748;

--
-- Tilføj AUTO_INCREMENT i tabel `integration_errors`
--
ALTER TABLE `integration_errors`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=750;

--
-- Tilføj AUTO_INCREMENT i tabel `medarbejder`
--
ALTER TABLE `medarbejder`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=19;

--
-- Tilføj AUTO_INCREMENT i tabel `missing_contacts`
--
ALTER TABLE `missing_contacts`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- Tilføj AUTO_INCREMENT i tabel `scraped_artists`
--
ALTER TABLE `scraped_artists`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=328;

--
-- Tilføj AUTO_INCREMENT i tabel `synced_companies`
--
ALTER TABLE `synced_companies`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=339;

--
-- Tilføj AUTO_INCREMENT i tabel `synced_contacts`
--
ALTER TABLE `synced_contacts`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=381;

--
-- Tilføj AUTO_INCREMENT i tabel `synced_deals`
--
ALTER TABLE `synced_deals`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1011;

--
-- Tilføj AUTO_INCREMENT i tabel `synced_order`
--
ALTER TABLE `synced_order`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1999;

--
-- Tilføj AUTO_INCREMENT i tabel `synced_request`
--
ALTER TABLE `synced_request`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=58;

--
-- Tilføj AUTO_INCREMENT i tabel `synced_users`
--
ALTER TABLE `synced_users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=9;

--
-- Tilføj AUTO_INCREMENT i tabel `sync_errors`
--
ALTER TABLE `sync_errors`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=184;

--
-- Tilføj AUTO_INCREMENT i tabel `sync_item_log`
--
ALTER TABLE `sync_item_log`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=184;

--
-- Tilføj AUTO_INCREMENT i tabel `sync_log`
--
ALTER TABLE `sync_log`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- Tilføj AUTO_INCREMENT i tabel `sync_schedule`
--
ALTER TABLE `sync_schedule`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- Tilføj AUTO_INCREMENT i tabel `sync_statistics`
--
ALTER TABLE `sync_statistics`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- Tilføj AUTO_INCREMENT i tabel `webhook_events`
--
ALTER TABLE `webhook_events`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=80;

--
-- Begrænsninger for dumpede tabeller
--

--
-- Begrænsninger for tabel `api_call_log`
--
ALTER TABLE `api_call_log`
  ADD CONSTRAINT `api_call_log_ibfk_1` FOREIGN KEY (`webhook_event_id`) REFERENCES `webhook_events` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `api_call_log_ibfk_2` FOREIGN KEY (`error_id`) REFERENCES `integration_errors` (`id`) ON DELETE SET NULL;

--
-- Begrænsninger for tabel `sync_errors`
--
ALTER TABLE `sync_errors`
  ADD CONSTRAINT `sync_errors_ibfk_1` FOREIGN KEY (`sync_log_id`) REFERENCES `sync_log` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `sync_errors_ibfk_2` FOREIGN KEY (`sync_item_log_id`) REFERENCES `sync_item_log` (`id`) ON DELETE SET NULL;

--
-- Begrænsninger for tabel `sync_item_log`
--
ALTER TABLE `sync_item_log`
  ADD CONSTRAINT `sync_item_log_ibfk_1` FOREIGN KEY (`sync_log_id`) REFERENCES `sync_log` (`id`) ON DELETE CASCADE;

--
-- Begrænsninger for tabel `webhook_events`
--
ALTER TABLE `webhook_events`
  ADD CONSTRAINT `webhook_events_ibfk_1` FOREIGN KEY (`error_id`) REFERENCES `integration_errors` (`id`) ON DELETE SET NULL;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;

-- ============================================================================
-- TrustCast: High-Security Constitutional Online Voting System
-- Database Schema (MySQL 8.0+ / InnoDB / UTF8MB4)
--
-- ARCHITECTURAL PRINCIPLE — ABSOLUTE BALLOT SECRECY:
-- The `voters` table (identity & eligibility) and the `votes` table
-- (anonymized ballots) share ZERO foreign keys, ZERO shared IDs, and ZERO
-- direct timestamps that could enable timing-correlation de-anonymization.
-- ============================================================================

CREATE DATABASE IF NOT EXISTS `trustcast_voting`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `trustcast_voting`;

-- ----------------------------------------------------------------------------
-- 1. VOTERS TABLE (Identity & Double-Voting Lock — Decoupled from `votes`)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `voters` (
  `voter_pk`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `voter_id`          VARCHAR(20)     NOT NULL COMMENT 'Format: ^[A-Z]{2,4}-\\d{6,10}$',
  `full_name`         VARCHAR(120)    NOT NULL,
  `age_group`         ENUM('18-24', '25-34', '35-49', '50-64', '65+') NOT NULL,
  `district`          VARCHAR(64)     NOT NULL,
  `contact_masked`    VARCHAR(120)    NOT NULL COMMENT 'Masked delivery target for 2FA OTP',
  `has_voted`         TINYINT(1)      NOT NULL DEFAULT 0,
  `voted_day`         DATE            NULL DEFAULT NULL COMMENT 'Coarse date only; prevents sub-second timing correlation',
  `created_at`        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`voter_pk`),
  UNIQUE KEY `uq_voters_voter_id` (`voter_id`),
  KEY `idx_voters_turnout` (`has_voted`, `age_group`, `district`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 2. OTP CHALLENGES TABLE (Time-Sensitive 2FA Verification)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `otp_challenges` (
  `challenge_id`      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `voter_id`          VARCHAR(20)     NOT NULL,
  `otp_hash`          CHAR(64)        NOT NULL COMMENT 'SHA-256(otp + server_pepper)',
  `expires_at`        DATETIME        NOT NULL,
  `attempts`          TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `consumed`          TINYINT(1)      NOT NULL DEFAULT 0,
  `created_at`        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`challenge_id`),
  KEY `idx_otp_voter_active` (`voter_id`, `consumed`, `expires_at`),
  CONSTRAINT `fk_otp_voter`
    FOREIGN KEY (`voter_id`) REFERENCES `voters` (`voter_id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 3. CANDIDATES TABLE (Official Ballot Slate)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `candidates` (
  `candidate_id`      INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `full_name`         VARCHAR(120)    NOT NULL,
  `coalition`         VARCHAR(120)    NOT NULL,
  `portfolio_focus`   VARCHAR(160)    NOT NULL,
  `platform_summary`  TEXT            NOT NULL,
  `display_order`     SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `is_active`         TINYINT(1)      NOT NULL DEFAULT 1,
  PRIMARY KEY (`candidate_id`),
  KEY `idx_candidates_order` (`is_active`, `display_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 4. VOTES TABLE (Anonymous Ballot Ledger — Zero Voter Identity Columns)
-- ----------------------------------------------------------------------------
-- Security Note:
-- - `receipt_hash` is derived from a cryptographically random 256-bit nonce
--   combined with server pepper: SHA256(random_bytes(32) | server_pepper).
-- - It contains NO voter_id and NO candidate_id, preventing receipt-buying or
--   coercion while allowing any voter to verify ledger inclusion.
-- - `cast_bucket` rounds timestamps to 15-minute intervals to defeat
--   timing-correlation attacks against `voters.voted_day`.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `votes` (
  `ballot_uuid`       CHAR(36)        NOT NULL,
  `candidate_id`      INT UNSIGNED    NOT NULL,
  `receipt_hash`      CHAR(64)        NOT NULL,
  `cast_bucket`       DATETIME        NOT NULL COMMENT 'Rounded to 15-minute UTC window',
  PRIMARY KEY (`ballot_uuid`),
  UNIQUE KEY `uq_votes_receipt_hash` (`receipt_hash`),
  KEY `idx_votes_candidate` (`candidate_id`),
  CONSTRAINT `fk_votes_candidate`
    FOREIGN KEY (`candidate_id`) REFERENCES `candidates` (`candidate_id`)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- SEED DATA: Official Candidates & Sample Eligible Electorate
-- ----------------------------------------------------------------------------
INSERT INTO `candidates` (`candidate_id`, `full_name`, `coalition`, `portfolio_focus`, `platform_summary`, `display_order`) VALUES
  (1, 'Rajeshwar Kulkarni',  'Rashtriya Vikas Morcha',       'Railways & Urban Mobility',         'High-speed regional rail links, transparent e-procurement tenders, and solar-powered public transit depots.', 1),
  (2, 'Priya Nair',          'Constitutional Digital Front',  'Public Healthcare & Data Privacy',  '24-hour primary health centres across every taluka, statutory Aadhaar-data minimization, and open district budgets.', 2),
  (3, 'Vikramaditya Rao',    'Swadeshi Grid & Agri Alliance', 'Rural Microgrids & Watersheds',     'Decentralized solar cold-storage for mandis, river-basin telemetry, and zero-collateral MSME credit.', 3),
  (4, 'Meenakshi Sundaram',  'Janata Shiksha & Reform Front', 'Public Universities & Courts',      'Multilingual digital classrooms in government schools, fast-track district courts, and municipal accountability.', 4);

INSERT INTO `voters` (`voter_id`, `full_name`, `age_group`, `district`, `contact_masked`, `has_voted`) VALUES
  ('DLH8492014', 'Aarav Sharma',       '25-34', 'New Delhi',         '+91 ***** 48210', 0),
  ('MUM5120943', 'Kavita Deshpande',   '35-49', 'Mumbai South',      '+91 ***** 90345', 0),
  ('BLR3048129', 'Siddharth Hegde',    '18-24', 'Bengaluru Central', '+91 ***** 11782', 0),
  ('VAR7741205', 'Rameshwar Tiwari',   '65+',   'Varanasi',          '+91 ***** 66421', 0),
  ('HYD6193052', 'Fatima Begum',       '50-64', 'Hyderabad',         '+91 ***** 23904', 0);

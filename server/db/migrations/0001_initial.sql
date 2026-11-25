-- Baseline migration: the Event Planner schema (MySQL 8) as it was before
-- migrations existed. Every statement is idempotent (IF NOT EXISTS), so it is
-- safe on databases created earlier from the old schema.sql.

CREATE TABLE IF NOT EXISTS `user` (
  user_id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_first     VARCHAR(100) NOT NULL,
  user_last      VARCHAR(100) NOT NULL,
  user_email     VARCHAR(255) NOT NULL,
  -- bcrypt hash; the per-password salt is embedded in the hash string itself.
  user_password  CHAR(60)     NOT NULL,
  user_role      ENUM('user', 'planner', 'admin') NOT NULL DEFAULT 'user',
  user_status    TINYINT      NOT NULL DEFAULT 1,
  -- Incremented on password change so outstanding JWTs are invalidated.
  token_version  INT UNSIGNED NOT NULL DEFAULT 0,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_email (user_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `group` (
  group_id     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  group_name   VARCHAR(100) NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_group_name (group_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_group (
  user_id   INT UNSIGNED NOT NULL,
  group_id  INT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, group_id),
  CONSTRAINT fk_ug_user  FOREIGN KEY (user_id)  REFERENCES `user`(user_id)   ON DELETE CASCADE,
  CONSTRAINT fk_ug_group FOREIGN KEY (group_id) REFERENCES `group`(group_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `type` (
  type_id      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  type_name    VARCHAR(100) NOT NULL,
  type_status  TINYINT      NOT NULL DEFAULT 1,
  UNIQUE KEY uq_type_name (type_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS event (
  event_id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_name         VARCHAR(200)  NOT NULL,
  event_description  TEXT          NULL,
  event_location     VARCHAR(255)  NOT NULL,
  event_date_start   DATETIME      NOT NULL,
  event_date_end     DATETIME      NOT NULL,
  event_max          INT UNSIGNED  NOT NULL,
  event_cost         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  event_type         INT UNSIGNED  NOT NULL,
  event_organizer    INT UNSIGNED  NOT NULL,
  -- public: everyone signed in. restricted: only members of event_group rows
  -- or users listed in event_invite (plus the organizer and admins).
  event_visibility   ENUM('public', 'restricted') NOT NULL DEFAULT 'public',
  -- 1 = active, -1 = soft deleted (kept for auditing).
  event_status       TINYINT       NOT NULL DEFAULT 1,
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_event_start (event_date_start),
  CONSTRAINT fk_event_type      FOREIGN KEY (event_type)      REFERENCES `type`(type_id),
  CONSTRAINT fk_event_organizer FOREIGN KEY (event_organizer) REFERENCES `user`(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS event_group (
  event_id  INT UNSIGNED NOT NULL,
  group_id  INT UNSIGNED NOT NULL,
  PRIMARY KEY (event_id, group_id),
  CONSTRAINT fk_eg_event FOREIGN KEY (event_id) REFERENCES event(event_id)   ON DELETE CASCADE,
  CONSTRAINT fk_eg_group FOREIGN KEY (group_id) REFERENCES `group`(group_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS event_invite (
  event_id  INT UNSIGNED NOT NULL,
  user_id   INT UNSIGNED NOT NULL,
  PRIMARY KEY (event_id, user_id),
  CONSTRAINT fk_ei_event FOREIGN KEY (event_id) REFERENCES event(event_id)  ON DELETE CASCADE,
  CONSTRAINT fk_ei_user  FOREIGN KEY (user_id)  REFERENCES `user`(user_id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Replaces the old JSON event_users column: one row per seat, so capacity
-- checks can lock rows and duplicate sign-ups are blocked by the primary key.
CREATE TABLE IF NOT EXISTS registration (
  event_id    INT UNSIGNED NOT NULL,
  user_id     INT UNSIGNED NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, user_id),
  CONSTRAINT fk_reg_event FOREIGN KEY (event_id) REFERENCES event(event_id)  ON DELETE CASCADE,
  CONSTRAINT fk_reg_user  FOREIGN KEY (user_id)  REFERENCES `user`(user_id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

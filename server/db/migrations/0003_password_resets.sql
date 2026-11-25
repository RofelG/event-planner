-- Password reset tokens. Only the SHA-256 hash of the emailed token is stored,
-- so a database leak does not hand out working reset links.
CREATE TABLE IF NOT EXISTS password_reset (
  token_hash  CHAR(64)     NOT NULL PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  expires_at  DATETIME     NOT NULL,
  used_at     DATETIME     NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_password_reset_user (user_id),
  CONSTRAINT fk_pr_user FOREIGN KEY (user_id) REFERENCES `user`(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

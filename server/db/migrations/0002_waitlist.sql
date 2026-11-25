-- Waitlist for full events. created_at has millisecond precision so the order
-- people joined in is stable; the first row is promoted when a seat frees up.
CREATE TABLE IF NOT EXISTS waitlist (
  event_id    INT UNSIGNED NOT NULL,
  user_id     INT UNSIGNED NOT NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (event_id, user_id),
  KEY ix_waitlist_order (event_id, created_at),
  CONSTRAINT fk_wl_event FOREIGN KEY (event_id) REFERENCES event(event_id) ON DELETE CASCADE,
  CONSTRAINT fk_wl_user  FOREIGN KEY (user_id)  REFERENCES `user`(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

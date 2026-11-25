-- Admin moderation: a hidden event is visible to admins only. Kept (not
-- deleted) so it can be restored; hidden_by records who made the call.
ALTER TABLE event
  ADD COLUMN event_hidden_at DATETIME NULL,
  ADD COLUMN event_hidden_by INT UNSIGNED NULL,
  ADD CONSTRAINT fk_event_hidden_by FOREIGN KEY (event_hidden_by) REFERENCES `user`(user_id) ON DELETE SET NULL;

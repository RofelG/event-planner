-- Privacy setting: when set, the user appears as "Private attendee" in attendee
-- lists (people who manage the event, and the user themself, still see the name).
ALTER TABLE `user` ADD COLUMN user_hide_name TINYINT(1) NOT NULL DEFAULT 0;

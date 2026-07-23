-- Scheduling Phase 2: reminder dispatch log. One row per (schedule, occurrence,
-- recipient). The UNIQUE key is the idempotency guard — the engine inserts the
-- row before sending, so an overlapping/restarted cron run collides and skips
-- instead of double-texting. Additive only.
CREATE TABLE IF NOT EXISTS "StudyReminder" (
  "id"             TEXT         NOT NULL,
  "studentId"      TEXT         NOT NULL,
  "scheduleId"     TEXT         NOT NULL,
  "recipient"      TEXT         NOT NULL,
  "phone"          TEXT         NOT NULL,
  "scheduledFor"   TIMESTAMP(3) NOT NULL,
  "sentAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveryStatus" TEXT         NOT NULL,
  "ghlRef"         TEXT,
  CONSTRAINT "StudyReminder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudyReminder_scheduleId_scheduledFor_recipient_key" UNIQUE ("scheduleId", "scheduledFor", "recipient"),
  CONSTRAINT "StudyReminder_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StudyReminder_scheduleId_fkey"
    FOREIGN KEY ("scheduleId") REFERENCES "StudySchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "StudyReminder_studentId_scheduledFor_idx" ON "StudyReminder" ("studentId", "scheduledFor");

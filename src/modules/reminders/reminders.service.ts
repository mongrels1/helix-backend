import { Injectable, Logger } from '@nestjs/common';
import { normalizePhone } from '@common/phone';
import { RemindersRepository, ScheduleContext } from './reminders.repository';
import { isDue, nextOccurrenceUtc } from './reminder-time';

export interface DispatchSummary {
  scanned: number;
  due: number;
  sent: number;
  skipped: number;
  failed: number;
}

interface Recipient {
  recipientKey: string; // stored in StudyReminder.recipient; unique per phone
  kind: 'student' | 'parent';
  phone: string;
  normalized: boolean; // false = couldn't be made valid E.164 (legacy/no-country number)
  firstName: string | null;
}

interface GhlResult {
  status: 'sent' | 'failed' | 'skipped';
  ref: string | null;
}

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(private readonly repo: RemindersRepository) {}

  /**
   * Scan every active schedule, and for those whose next occurrence is inside the
   * 30-minute send window, text the student and each linked parent (once per
   * distinct phone). Idempotent: each recipient's reminder row is claimed before
   * sending, so a re-run or overlap never double-texts. Safe to call when the GHL
   * workflow URL is unconfigured — it records the reminders as "skipped".
   */
  async dispatchDue(now: Date = new Date()): Promise<DispatchSummary> {
    const contexts = await this.repo.findAllScheduleContexts();
    const summary: DispatchSummary = { scanned: contexts.length, due: 0, sent: 0, skipped: 0, failed: 0 };

    for (const ctx of contexts) {
      if (!ctx.timezone) continue; // can't compute a send time without a timezone
      const occ = nextOccurrenceUtc(ctx.dayOfWeek, ctx.studyTime, ctx.timezone, now);
      if (!occ || !isDue(occ, now)) continue;
      summary.due += 1;

      for (const rcpt of this.recipientsFor(ctx)) {
        const claimId = await this.repo.claimReminder({
          studentId: ctx.studentId,
          scheduleId: ctx.scheduleId,
          recipient: rcpt.recipientKey,
          phone: rcpt.phone,
          scheduledFor: occ,
        });
        if (!claimId) {
          // Already claimed for this (schedule, occurrence, recipient) — don't resend.
          continue;
        }
        if (!rcpt.normalized) {
          // A legacy number saved before country support that can't be made valid
          // E.164. Record it visibly (shows as "invalid_phone" in the reminder log)
          // instead of silently dropping — an admin can see it and have the student
          // re-save their number.
          await this.repo.markReminder(claimId, 'invalid_phone', 'phone_needs_country_code');
          summary.failed += 1;
          this.logger.warn(`Reminder not sent — unnormalizable phone for student ${ctx.studentId}`);
          continue;
        }
        const result = await this.dispatchToGhl(ctx, rcpt, occ);
        await this.repo.markReminder(claimId, result.status, result.ref);
        summary[result.status] += 1;
      }
    }

    if (summary.due > 0) {
      this.logger.log(
        `Reminders: ${summary.due} session(s) due — sent ${summary.sent}, skipped ${summary.skipped}, failed ${summary.failed}`,
      );
    }
    return summary;
  }

  /** Student + each linked parent, de-duplicated by phone (so a shared number is
   *  never texted twice, and each distinct parent gets a distinct reminder row). */
  private recipientsFor(ctx: ScheduleContext): Recipient[] {
    const out: Recipient[] = [];
    const seen = new Set<string>();
    const add = (kind: 'student' | 'parent', rawPhone: string | null, firstName: string | null) => {
      const raw = (rawPhone ?? '').trim();
      if (!raw) return;
      // Prefer the validated E.164 form; if a legacy number can't be normalized
      // (no country), keep it anyway with normalized=false so the reminder is
      // recorded as invalid rather than silently dropped.
      const norm = normalizePhone(raw);
      const phone = norm ?? raw.replace(/[^\d+]/g, '');
      if (!phone || seen.has(phone)) return;
      seen.add(phone);
      out.push({
        recipientKey: kind === 'student' ? 'student' : `parent:${phone}`,
        kind,
        phone,
        normalized: norm !== null,
        firstName,
      });
    };
    add('student', ctx.studentPhone, ctx.studentFirstName);
    for (const parent of ctx.parents) add('parent', parent.phone, parent.firstName);
    return out;
  }

  /**
   * Trigger the GoHighLevel workflow that actually sends the SMS. Uses a plain
   * inbound-webhook POST (no GHL API token needed): the workflow's Inbound Webhook
   * trigger receives this payload and sends the text with its own template. Fails
   * OPEN when GHL_REMINDER_WEBHOOK_URL is unset (records "skipped") so the engine
   * ships and runs safely before the workflow is wired — mirrors the email/captcha
   * fail-open pattern.
   */
  private async dispatchToGhl(
    ctx: ScheduleContext,
    rcpt: Recipient,
    occ: Date,
  ): Promise<GhlResult> {
    const url = process.env.GHL_REMINDER_WEBHOOK_URL?.trim();
    if (!url) return { status: 'skipped', ref: null };

    const studentName = ctx.studentFirstName?.trim() || 'your student';
    const greetName = rcpt.firstName?.trim() || 'there';
    const message =
      rcpt.kind === 'parent'
        ? `Hi ${greetName}, ${studentName}'s EdKairos study session starts in 30 minutes.`
        : `Hi ${greetName}, your EdKairos study session starts in 30 minutes. See you there!`;

    const payload = {
      phone: rcpt.phone,
      recipientType: rcpt.kind,
      firstName: rcpt.firstName ?? '',
      studentFirstName: ctx.studentFirstName ?? '',
      studyTimeLocal: ctx.studyTime,
      timezone: ctx.timezone,
      scheduledFor: occ.toISOString(),
      message,
      source: 'edkairos-study-reminder',
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        this.logger.warn(`GHL reminder webhook returned ${res.status} for ${rcpt.recipientKey}`);
        return { status: 'failed', ref: null };
      }
      // GHL inbound webhooks usually return a small JSON ack; capture an id if present.
      let ref: string | null = null;
      try {
        const body = (await res.json()) as { id?: string; messageId?: string };
        ref = body?.messageId ?? body?.id ?? null;
      } catch {
        ref = null; // non-JSON ack is fine
      }
      return { status: 'sent', ref };
    } catch (err) {
      this.logger.error(
        `GHL reminder webhook failed for ${rcpt.recipientKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { status: 'failed', ref: null };
    }
  }
}

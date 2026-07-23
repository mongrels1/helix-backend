import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RemindersService } from './reminders.service';

/**
 * Runs the reminder engine every 10 minutes. That cadence + the "send once we're
 * inside the 30-min window" logic means a text lands ~20–30 min before the
 * session; the StudyReminder unique key makes overlapping runs safe. Guarded so a
 * single bad run can never crash the scheduler loop.
 */
@Injectable()
export class RemindersScheduler {
  private readonly logger = new Logger(RemindersScheduler.name);
  private running = false;

  constructor(private readonly reminders: RemindersService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async tick(): Promise<void> {
    if (this.running) return; // never overlap with a still-running scan
    this.running = true;
    try {
      await this.reminders.dispatchDue();
    } catch (err) {
      this.logger.error(
        `Reminder scan failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}

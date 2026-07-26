import { Injectable, Logger } from '@nestjs/common';
import { Cron, Timeout } from '@nestjs/schedule';
import { ReportsService } from './reports.service';

@Injectable()
export class ReportsScheduler {
  private readonly logger = new Logger(ReportsScheduler.name);

  constructor(private readonly reports: ReportsService) {}

  // Sundays at 14:00 UTC (~9am ET). Gated by WEEKLY_REPORT_ENABLED.
  @Cron('0 14 * * 0')
  async weekly(): Promise<void> {
    if (process.env.WEEKLY_REPORT_ENABLED !== 'true') {
      this.logger.log('Weekly report cron skipped (set WEEKLY_REPORT_ENABLED=true to enable).');
      return;
    }
    this.logger.log('Running weekly report batch...');
    const result = await this.reports.runWeeklyBatch();
    this.logger.log(`Weekly report batch done: ${result.sent}/${result.processed} sent.`);
  }

  // TEMP — live verification only. Safe to leave in place: it is INERT unless
  // WEEKLY_REPORT_VERIFY_ONCE=true. When that env var is set, it fires ONCE ~60s
  // after each boot, running the exact same batch the Sunday cron runs
  // (trigger=CRON) so you can confirm the automated path end-to-end without
  // waiting for Sunday. To test: set WEEKLY_REPORT_ENABLED=true AND
  // WEEKLY_REPORT_VERIFY_ONCE=true, deploy, watch for a CRON row in the Weekly
  // Reports log, then REMOVE WEEKLY_REPORT_VERIFY_ONCE. Delete this method anytime.
  @Timeout('weekly-report-verify-once', 60000)
  async verifyOnce(): Promise<void> {
    if (process.env.WEEKLY_REPORT_VERIFY_ONCE !== 'true') return;
    if (process.env.WEEKLY_REPORT_ENABLED !== 'true') {
      this.logger.warn(
        '[verify] WEEKLY_REPORT_ENABLED is not "true" — the real Sunday cron would skip. Set it, then retry.',
      );
      return;
    }
    this.logger.log('[verify] Firing one-shot weekly report batch now (labeled CRON)...');
    const result = await this.reports.runWeeklyBatch();
    this.logger.log(`[verify] Done: ${result.sent}/${result.processed} sent (trigger=CRON).`);
  }
}

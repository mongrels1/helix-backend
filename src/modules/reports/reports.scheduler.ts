import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
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
}

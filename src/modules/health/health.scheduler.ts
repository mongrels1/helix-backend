import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { HealthService } from "./health.service";

interface WebhookPayload {
  text?: string;
  content?: string;
}

@Injectable()
export class HealthScheduler {
  private readonly logger = new Logger(HealthScheduler.name);
  private consecutiveFailures = 0;

  constructor(
    private readonly healthService: HealthService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkHealth(): Promise<void> {
    const issues: string[] = [];
    const health = await this.healthService.check();
    this.logger.log(`Health check status=${health.status}`);

    if (health.database.status !== "ok") {
      issues.push("Database unreachable");
    }
    if (health.redis.status === "error") {
      issues.push("Redis unreachable");
    }

    if (issues.length === 0) {
      if (this.consecutiveFailures > 0) {
        this.consecutiveFailures = 0;
        await this.sendAlert(
          ":white_check_mark: Helix backend recovered - all systems healthy.",
        );
      }
      return;
    }

    this.consecutiveFailures++;
    if (this.consecutiveFailures === 1 || this.consecutiveFailures % 3 === 0) {
      const msg = `:rotating_light: Helix health check failed (attempt ${this.consecutiveFailures}): ${issues.join(", ")}.`;
      this.logger.error(msg);
      await this.sendAlert(msg);
    }
  }

  private async sendAlert(message: string): Promise<void> {
    const url = this.config.get<string>("HEALTH_WEBHOOK_URL");
    if (!url) return;

    try {
      const body: WebhookPayload = url.includes("discord")
        ? { content: message }
        : { text: message };
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      this.logger.warn(`Failed to send health webhook: ${String(error)}`);
    }
  }
}

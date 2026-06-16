import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendWelcomeEmail(to: string, firstName?: string): Promise<void> {
    const frontendUrl = this.config.get<string>('app.frontendUrl') ?? 'http://localhost:3000';
    const displayName = firstName?.trim() || 'there';

    await this.sendEmail({
      to,
      subject: 'Welcome to Helix',
      html: `
        <p>Hi ${this.escapeHtml(displayName)},</p>
        <p>Welcome to Helix Intelligence System. Your account is ready.</p>
        <p><a href="${frontendUrl}">Open Helix</a></p>
      `,
      text: `Hi ${displayName}, welcome to Helix Intelligence System. Open Helix: ${frontendUrl}`,
    });
  }

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    await this.sendEmail({
      to,
      subject: 'Reset your Helix password',
      html: `
        <p>We received a request to reset your Helix password.</p>
        <p><a href="${resetUrl}">Reset your password</a></p>
        <p>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>
      `,
      text: `Reset your Helix password: ${resetUrl}\n\nThis link expires in 1 hour. If you did not request this, you can ignore this email.`,
    });
  }

  private async sendEmail(message: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    const apiKey = this.config.get<string>('email.resendApiKey')?.trim();
    if (!apiKey) {
      this.logger.warn(`Email skipped for ${message.to}: RESEND_API_KEY is not configured`);
      return;
    }

    const from = this.config.get<string>('email.from') ?? 'Helix <onboarding@resend.dev>';
    const resend = new Resend(apiKey);
    await resend.emails.send({ from, ...message });
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

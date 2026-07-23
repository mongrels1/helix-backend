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
  async sendActivationEmail(to: string, activationUrl: string, firstName?: string): Promise<void> {
    const displayName = firstName?.trim() || 'there';
    await this.sendEmail({
      to,
      subject: 'Set up your EdKairos account',
      html: `
        <p>Hi ${this.escapeHtml(displayName)},</p>
        <p>Thanks for your purchase — your EdKairos account is ready. Click below to set your password and start learning:</p>
        <p><a href="${activationUrl}">Set my password &amp; get started</a></p>
        <p>This link expires in 7 days. If the button doesn't work, paste this into your browser:<br>${this.escapeHtml(activationUrl)}</p>
      `,
      text: `Hi ${displayName}, thanks for your purchase — your EdKairos account is ready. Set your password and get started: ${activationUrl}\n\nThis link expires in 7 days.`,
    });
  }

  async sendVerificationEmail(to: string, verifyUrl: string, firstName?: string): Promise<void> {
    const displayName = firstName?.trim() || 'there';
    await this.sendEmail({
      to,
      subject: 'Verify your email to finish signing up',
      html: `
        <p>Hi ${this.escapeHtml(displayName)},</p>
        <p>Thanks for signing up for EdKairos. Confirm your email address to activate your account and start learning:</p>
        <p><a href="${verifyUrl}">Verify my email &amp; get started</a></p>
        <p>This link expires in 24 hours. If the button doesn't work, paste this into your browser:<br>${this.escapeHtml(verifyUrl)}</p>
        <p>If you didn't create an EdKairos account, you can safely ignore this email — no account will be created.</p>
      `,
      text: `Hi ${displayName}, thanks for signing up for EdKairos. Verify your email to activate your account: ${verifyUrl}\n\nThis link expires in 24 hours. If you didn't create an account, ignore this email — nothing will be created.`,
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
  async sendAdminAlert(subject: string, text: string): Promise<void> {
    const to = this.config.get<string>('email.alertTo')?.trim();
    if (!to) {
      this.logger.error(
        `Admin alert not sent (email.alertTo not configured): ${subject}`,
      );
      return;
    }
    await this.sendEmail({
      to,
      subject,
      html: `<pre>${this.escapeHtml(text)}</pre>`,
      text,
    });
  }

  async sendReferralRewardEmail(to: string, firstName?: string): Promise<void> {
    const frontendUrl = this.config.get<string>('app.frontendUrl') ?? 'http://localhost:3000';
    const displayName = firstName?.trim() || 'there';
    await this.sendEmail({
      to,
      subject: 'Your next month is on us',
      html: `
        <p>Hi ${this.escapeHtml(displayName)},</p>
        <p>Great news — a friend you referred just joined EdKairos and became a paying member. As a thank-you, <strong>your next month is free</strong>; the credit is already applied to your next payment.</p>
        <p><a href="${frontendUrl}">Open EdKairos</a></p>
      `,
      text: `Hi ${displayName}, a friend you referred just joined EdKairos as a paying member. Your next month is free — already applied to your next payment. Open EdKairos: ${frontendUrl}`,
    });
  }

  async sendTrialEndingEmail(to: string, firstName?: string, upgradeUrl?: string): Promise<void> {
    const url = upgradeUrl?.trim() || this.config.get<string>('app.upgradeUrl') || 'https://go.edkairos.com';
    const displayName = firstName?.trim() || 'there';
    await this.sendEmail({
      to,
      subject: 'Your EdKairos trial ends in 3 days',
      html: `
        <p>Hi ${this.escapeHtml(displayName)},</p>
        <p>Your EdKairos trial ends in 3 days. To keep uninterrupted access to the AI Tutor, daily Practice, and Skills-Up lessons, subscribe here:</p>
        <p><a href="${this.escapeHtml(url)}">Keep my EdKairos access</a></p>
        <p>Already subscribed? You're all set — no action needed.</p>
      `,
      text: `Hi ${displayName}, your EdKairos trial ends in 3 days. Keep uninterrupted access (AI Tutor, Practice, Skills-Up) by subscribing: ${url}\n\nAlready subscribed? You're all set.`,
    });
  }

  async sendWeeklyReport(to: string, subject: string, html: string, text: string): Promise<void> {
    await this.sendEmail({ to, subject, html, text });
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
    this.logger.log(`Sending "${message.subject}" to ${message.to} from "${from}" (key len ${apiKey.length})`);
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({ from, ...message });
    if (error) {
      this.logger.error(`Resend rejected email to ${message.to}: ${JSON.stringify(error)}`);
      return;
    }
    this.logger.log(`Resend accepted email to ${message.to} (id: ${data?.id ?? 'unknown'})`);
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

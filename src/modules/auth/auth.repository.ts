import { Injectable } from '@nestjs/common';
import { PasswordResetToken, PendingSignup, RefreshToken, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createRefreshToken(
    userId: string,
    token: string,
    expiresAt: Date,
  ): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({
      data: {
        userId,
        token,
        expiresAt,
      },
    });
  }

  async findRefreshToken(token: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({
      where: { token },
    });
  }

  async deleteRefreshToken(userId: string, token: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { userId, token },
    });
  }

  async deleteRefreshTokensForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
  }

  async createPasswordResetToken(
    userId: string,
    token: string,
    expiresAt: Date,
  ): Promise<PasswordResetToken> {
    return this.prisma.passwordResetToken.create({
      data: { userId, token, expiresAt },
    });
  }

  async findPasswordResetToken(token: string): Promise<PasswordResetToken | null> {
    return this.prisma.passwordResetToken.findUnique({ where: { token } });
  }

  async markPasswordResetTokenUsed(id: string): Promise<void> {
    await this.prisma.passwordResetToken.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  // ---- Verify-before-create: PendingSignup rows (no User exists yet) ----

  /**
   * One pending row per email (unique). A re-signup with the same email replaces
   * the stored password/name/role and issues a fresh token + expiry, so the newest
   * verification link is the one that works and older links are invalidated.
   */
  async upsertPendingSignup(data: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    role: Role;
    token: string;
    expiresAt: Date;
  }): Promise<PendingSignup> {
    return this.prisma.pendingSignup.upsert({
      where: { email: data.email },
      create: data,
      update: {
        passwordHash: data.passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role,
        token: data.token,
        expiresAt: data.expiresAt,
      },
    });
  }

  async findPendingByToken(token: string): Promise<PendingSignup | null> {
    return this.prisma.pendingSignup.findUnique({ where: { token } });
  }

  async deletePendingById(id: string): Promise<void> {
    await this.prisma.pendingSignup.deleteMany({ where: { id } });
  }

  /** Housekeeping for the Phase 3 cron: drop pending rows past their expiry. */
  async deleteExpiredPending(now = new Date()): Promise<number> {
    const res = await this.prisma.pendingSignup.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    return res.count;
  }

  /** Record a successful sign-in for engagement analytics. Best-effort — callers
   *  fire-and-forget so a logging hiccup never blocks or fails authentication. */
  async createLoginEvent(userId: string): Promise<void> {
    await this.prisma.loginEvent.create({ data: { userId } });
  }
}

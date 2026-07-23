import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'crypto';
import { EmailService } from '@modules/email/email.service';
import { UsersRepository, normalizeEmail } from '@modules/users/users.repository';
import { UserEntity } from '@modules/users/entities/user.entity';
import { CreateUserDto } from '@modules/users/dto/create-user.dto';
import { AuthRepository } from './auth.repository';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

const SALT_ROUNDS = 12;

// How long an emailed verification link stays valid. After this the pending row
// expires and the person must sign up again (which re-issues a fresh link).
const PENDING_TTL_HOURS = 24;

// Roles a person may create for themselves via PUBLIC self-signup. Privileged
// roles (TEACHER, ORG_ADMIN, SUPER_ADMIN) must never be self-assigned — teachers
// are created only under a school/org by an admin; admins are provisioned.
const SELF_SERVE_ROLES = new Set<Role>([Role.STUDENT, Role.PARENT]);

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  user: UserEntity;
};

// Self-signup no longer mints an account inline; it parks the details in a
// PendingSignup and emails a verification link. The account is created only when
// that link is verified (see verifyEmail). This is the discriminator the client
// reads to show the "check your inbox" screen instead of logging the user in.
type RegisterResult = { status: 'verification_sent'; email: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly usersRepository: UsersRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Verify-before-create. Self-signup NO LONGER creates a User. It validates the
   * anti-bot layers, then parks the (already-hashed) credentials in a PendingSignup
   * and emails a verification link. The real account is minted only when the link is
   * verified (verifyEmail). A bot that never opens the inbox therefore never becomes
   * an account — the user list stops filling with spam at the source. Returns a
   * "verification_sent" result (never tokens) so the client shows a check-email
   * screen instead of logging anyone in.
   */
  async register(dto: RegisterDto): Promise<RegisterResult> {
    // Anti-bot layer 1 — honeypot: a hidden field a real user never fills.
    if (dto.website && dto.website.trim()) {
      throw new BadRequestException('Registration could not be completed.');
    }
    // Anti-bot layer 2 — Cloudflare Turnstile (inert until TURNSTILE_SECRET is set).
    await this.verifyCaptcha(dto.captchaToken);

    const email = normalizeEmail(dto.email);

    const existing = await this.usersRepository.findByEmail(email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    // Hard guard: a self-signup can ONLY become a Student or Parent. Any other
    // requested role (incl. a crafted TEACHER/ORG_ADMIN/SUPER_ADMIN) is forced to
    // STUDENT. Teachers/admins are created through the org/admin paths, not here.
    const safeRole = dto.role && SELF_SERVE_ROLES.has(dto.role) ? dto.role : Role.STUDENT;

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + PENDING_TTL_HOURS * 60 * 60 * 1000);

    // Upsert: a repeat signup for the same unverified email refreshes the row and
    // issues a new link rather than erroring — so an impatient real user just gets
    // another email, and the newest link is the valid one.
    await this.authRepository.upsertPendingSignup({
      email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role: safeRole,
      token,
      expiresAt,
    });

    const frontendUrl =
      this.configService.get<string>('app.frontendUrl') ?? 'http://localhost:3000';
    const verifyUrl = `${frontendUrl.replace(/\/$/, '')}/verify-email?token=${token}`;
    await this.emailService.sendVerificationEmail(email, verifyUrl, dto.firstName);

    return { status: 'verification_sent', email };
  }

  /**
   * Second half of verify-before-create: the emailed link lands here. Validates the
   * token (exists, not expired), mints the real User from the parked details (reusing
   * the already-hashed password), deletes the pending row (single-use), and logs the
   * new account in by returning tokens. Fails closed on an invalid/expired token.
   */
  async verifyEmail(token: string): Promise<AuthTokens> {
    const pending = await this.authRepository.findPendingByToken(token);
    if (!pending || pending.expiresAt <= new Date()) {
      throw new BadRequestException(
        'This verification link is invalid or has expired. Please sign up again.',
      );
    }

    // Guard the race where the same email got verified via an earlier link (or was
    // otherwise created) between this link being issued and clicked.
    const existing = await this.usersRepository.findByEmail(pending.email);
    if (existing) {
      await this.authRepository.deletePendingById(pending.id);
      throw new ConflictException('This email is already verified. Please sign in.');
    }

    // Mint the real account. usersRepository.create takes the pre-hashed password as
    // its second arg and ignores dto.password, so we pass the parked hash directly.
    const user = await this.usersRepository.create(
      {
        email: pending.email,
        firstName: pending.firstName,
        lastName: pending.lastName,
        role: pending.role,
      } as CreateUserDto,
      pending.passwordHash,
    );
    await this.authRepository.deletePendingById(pending.id);

    const tokens = await this.generateTokens(user);
    await this.emailService.sendWelcomeEmail(user.email, user.profile?.firstName);

    return { ...tokens, user };
  }

  async login(dto: LoginDto): Promise<AuthTokens> {
    const userRecord = await this.usersRepository.findByEmail(dto.email);
    if (!userRecord) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      userRecord.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (userRecord.suspendedAt) {
      throw new UnauthorizedException(
        'Your account is paused. Please contact support.',
      );
    }

    const user = await this.usersRepository.findById(userRecord.id);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(user);
    return { ...tokens, user };
  }

  async refresh(dto: RefreshDto): Promise<{ accessToken: string }> {
    const refreshToken = await this.authRepository.findRefreshToken(
      dto.refreshToken,
    );
    if (!refreshToken || refreshToken.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersRepository.findById(refreshToken.userId);
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (user.suspendedAt) {
      throw new UnauthorizedException(
        'Your account is paused. Please contact support.',
      );
    }

    return { accessToken: this.signAccessToken(user) };
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    await this.authRepository.deleteRefreshToken(userId, refreshToken);
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await this.usersRepository.findByEmail(email);
    if (!user) {
      return { message: 'If an account exists, a password reset email has been sent' };
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await this.authRepository.createPasswordResetToken(user.id, token, expiresAt);

    const frontendUrl =
      this.configService.get<string>('app.frontendUrl') ?? 'http://localhost:3000';
    const resetUrl = `${frontendUrl.replace(/\/$/, '')}/reset-password?token=${token}`;
    await this.emailService.sendPasswordResetEmail(user.email, resetUrl);

    return { message: 'If an account exists, a password reset email has been sent' };
  }

  async resetPassword(token: string, password: string): Promise<{ message: string }> {
    const resetToken = await this.authRepository.findPasswordResetToken(token);
    if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid or expired password reset token');
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await this.authRepository.updatePassword(resetToken.userId, passwordHash);
    await this.authRepository.markPasswordResetTokenUsed(resetToken.id);
    await this.authRepository.deleteRefreshTokensForUser(resetToken.userId);

    return { message: 'Password reset successful' };
  }

  async getMe(userId: string): Promise<UserEntity> {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  /**
   * Verify a Cloudflare Turnstile token. Fails OPEN when TURNSTILE_SECRET is not
   * configured (so signup keeps working before keys are added) and on a rare
   * network error reaching Cloudflare (honeypot + rate limit + email verification
   * still gate the request). Rejects only on an explicit verification failure.
   */
  private async verifyCaptcha(token?: string): Promise<void> {
    const secret = process.env.TURNSTILE_SECRET?.trim();
    if (!secret) return; // not configured yet — skip
    if (!token) throw new BadRequestException('Please complete the captcha.');
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret, response: token }),
      });
      const data = (await res.json()) as { success?: boolean };
      if (data?.success !== true) {
        throw new BadRequestException('Captcha verification failed. Please try again.');
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      return; // couldn't reach Turnstile — allow; other layers still gate signup
    }
  }

  private async generateTokens(
    user: UserEntity,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const refreshToken = randomUUID();
    await this.authRepository.createRefreshToken(
      user.id,
      refreshToken,
      this.getRefreshExpiry(),
    );

    return {
      accessToken: this.signAccessToken(user),
      refreshToken,
    };
  }

  private signAccessToken(user: UserEntity): string {
    return this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
  }

  private getRefreshExpiry(): Date {
    const refreshExpiresIn =
      this.configService.get<string>('jwt.refreshExpiresIn') ?? '7d';
    const days = refreshExpiresIn.endsWith('d')
      ? parseInt(refreshExpiresIn, 10)
      : 7;

    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }
}

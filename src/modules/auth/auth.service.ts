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
import { UsersRepository } from '@modules/users/users.repository';
import { UserEntity } from '@modules/users/entities/user.entity';
import { CreateUserDto } from '@modules/users/dto/create-user.dto';
import { AuthRepository } from './auth.repository';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

const SALT_ROUNDS = 12;

// Roles a person may create for themselves via PUBLIC self-signup. Privileged
// roles (TEACHER, ORG_ADMIN, SUPER_ADMIN) must never be self-assigned — teachers
// are created only under a school/org by an admin; admins are provisioned.
const SELF_SERVE_ROLES = new Set<Role>([Role.STUDENT, Role.PARENT]);

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  user: UserEntity;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly usersRepository: UsersRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokens> {
    // Anti-bot layer 1 — honeypot: a hidden field a real user never fills.
    if (dto.website && dto.website.trim()) {
      throw new BadRequestException('Registration could not be completed.');
    }
    // Anti-bot layer 2 — Cloudflare Turnstile (inert until TURNSTILE_SECRET is set).
    await this.verifyCaptcha(dto.captchaToken);

    const existing = await this.usersRepository.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    // Hard guard: a self-signup can ONLY become a Student or Parent. Any other
    // requested role (incl. a crafted TEACHER/ORG_ADMIN/SUPER_ADMIN) is forced to
    // STUDENT. Teachers/admins are created through the org/admin paths, not here.
    const safeRole = dto.role && SELF_SERVE_ROLES.has(dto.role) ? dto.role : Role.STUDENT;
    const user = await this.usersRepository.create(
      { ...dto, role: safeRole } as CreateUserDto,
      passwordHash,
    );
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

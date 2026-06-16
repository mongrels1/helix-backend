import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { UsersRepository } from '@modules/users/users.repository';
import { UserEntity } from '@modules/users/entities/user.entity';
import { CreateUserDto } from '@modules/users/dto/create-user.dto';
import { AuthRepository } from './auth.repository';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

const SALT_ROUNDS = 12;

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
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokens> {
    const existing = await this.usersRepository.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.usersRepository.create(
      dto as CreateUserDto,
      passwordHash,
    );
    const tokens = await this.generateTokens(user);

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

    return { accessToken: this.signAccessToken(user) };
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    await this.authRepository.deleteRefreshToken(userId, refreshToken);
  }

  async getMe(userId: string): Promise<UserEntity> {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
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

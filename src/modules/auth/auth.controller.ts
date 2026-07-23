import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { SignupRateLimitGuard } from '@common/guards/signup-rate-limit.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { UserEntity } from '@modules/users/entities/user.entity';
import { EntitlementService } from '@modules/entitlement/entitlement.service';
import { AuthService } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

type CurrentUserPayload = {
  userId: string;
  email: string;
  role: string;
  orgId?: string;
};

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly entitlement: EntitlementService,
  ) {}

  @Public()
  @UseGuards(SignupRateLimitGuard)
  @Post('register')
  async register(@Body() registerDto: RegisterDto): Promise<{
    success: true;
    data: { accessToken: string; refreshToken: string; user: UserEntity & { entitled: boolean } };
  }> {
    const data = await this.authService.register(registerDto);
    // Attach the server-computed access flag so clients don't need a follow-up
    // /me call to know whether paid features are unlocked (matches the /me shape).
    const entitled = await this.entitlement.isEntitled(data.user.id);
    return { success: true, data: { ...data, user: { ...data.user, entitled } } };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() loginDto: LoginDto): Promise<{
    success: true;
    data: { accessToken: string; refreshToken: string; user: UserEntity & { entitled: boolean } };
  }> {
    const data = await this.authService.login(loginDto);
    // Attach the server-computed access flag so clients don't need a follow-up
    // /me call to know whether paid features are unlocked (matches the /me shape).
    const entitled = await this.entitlement.isEntitled(data.user.id);
    return { success: true, data: { ...data, user: { ...data.user, entitled } } };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() refreshDto: RefreshDto,
  ): Promise<{ success: true; data: { accessToken: string } }> {
    const data = await this.authService.refresh(refreshDto);
    return { success: true, data };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(
    @Body() forgotPasswordDto: ForgotPasswordDto,
  ): Promise<{ success: true; data: { message: string } }> {
    const data = await this.authService.forgotPassword(forgotPasswordDto.email);
    return { success: true, data };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(
    @Body() resetPasswordDto: ResetPasswordDto,
  ): Promise<{ success: true; data: { message: string } }> {
    const data = await this.authService.resetPassword(
      resetPasswordDto.token,
      resetPasswordDto.password,
    );
    return { success: true, data };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @CurrentUser() currentUser: CurrentUserPayload,
    @Body() refreshDto: RefreshDto,
  ): Promise<{ success: true; data: null }> {
    await this.authService.logout(currentUser.userId, refreshDto.refreshToken);
    return { success: true, data: null };
  }

  @Get('me')
  async me(
    @CurrentUser() currentUser: CurrentUserPayload,
  ): Promise<{ success: true; data: UserEntity & { entitled: boolean } }> {
    const user = await this.authService.getMe(currentUser.userId);
    const entitled = await this.entitlement.isEntitled(currentUser.userId);
    return { success: true, data: { ...user, entitled } };
  }
}

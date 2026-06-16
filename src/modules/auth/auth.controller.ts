import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { UserEntity } from '@modules/users/entities/user.entity';
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
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() registerDto: RegisterDto): Promise<{
    success: true;
    data: { accessToken: string; refreshToken: string; user: UserEntity };
  }> {
    const data = await this.authService.register(registerDto);
    return { success: true, data };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() loginDto: LoginDto): Promise<{
    success: true;
    data: { accessToken: string; refreshToken: string; user: UserEntity };
  }> {
    const data = await this.authService.login(loginDto);
    return { success: true, data };
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
  ): Promise<{ success: true; data: UserEntity }> {
    const user = await this.authService.getMe(currentUser.userId);
    return { success: true, data: user };
  }
}

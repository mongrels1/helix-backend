import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { ReferralService } from './referral.service';

interface AuthenticatedUser {
  userId: string;
}

@Controller('api/v1/referral')
export class ReferralController {
  constructor(
    private readonly referrals: ReferralService,
    private readonly config: ConfigService,
  ) {}

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser): Promise<{
    success: true;
    data: { code: string; link: string; rewardsGranted: number; maxRewards: number };
  }> {
    const code = await this.referrals.getOrCreateCode(user.userId);
    const rewardsGranted = await this.referrals.rewardsGranted(user.userId);
    const base = this.config.get<string>('app.referralLinkBase') ?? 'https://go.edkairos.com/free-diagnostic';
    const link = `${base}?referred_by=${code}`;
    return { success: true, data: { code, link, rewardsGranted, maxRewards: 3 } };
  }
}

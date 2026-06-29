import { Body, Controller, Headers, Post, Query } from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { ProvisioningService } from './provisioning.service';

/**
 * Account provisioning from external purchase events (GoHighLevel). Public
 * (server-to-server from GHL) but gated by a shared secret sent either as the
 * `x-ghl-secret` header or a `?secret=` query param. The global JwtAuthGuard is
 * bypassed via @Public; RolesGuard has no @Roles so it allows the request.
 */
@Controller('api/v1/provisioning')
export class ProvisioningController {
  constructor(private readonly svc: ProvisioningService) {}

  @Public()
  @Post('ghl')
  async ghl(
    @Body() body: Record<string, unknown>,
    @Headers('x-ghl-secret') headerSecret?: string,
    @Query('secret') querySecret?: string,
  ) {
    const data = await this.svc.provisionFromGhl(body, (headerSecret ?? querySecret ?? '').trim());
    return { success: true as const, data };
  }
}

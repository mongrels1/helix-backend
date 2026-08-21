import { Body, Controller, Get, Ip, Param, Post, Headers } from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { InstitutionalEnrollmentService } from './institutional-enrollment.service';
import { EnrollDto } from './dto/enroll.dto';

/**
 * The page a parent reaches from the QR code on the school opt-in letter.
 *
 * Public by necessity — a parent has no account yet — so it is keyed on an
 * unguessable per-school enrollment token rather than the slug, throttled, and
 * bounded by the school's seat cap. It never touches the marketing funnel, and
 * it never creates a Stripe object.
 *
 * NOTE: there is no application-level rate limit here — this codebase has no
 * throttler installed. The seat cap bounds total damage, and the honeypot
 * catches naive bots, but a burst limit on POST /api/v1/enroll/* should be set
 * at Cloudflare (api.edkairos.com is already proxied) before this goes live.
 */
@Controller('api/v1/enroll')
export class InstitutionalEnrollmentController {
  constructor(private readonly svc: InstitutionalEnrollmentService) {}

  /** What school is this, and are there seats left? Renders the page header. */
  @Public()
  @Get(':token')
  async describe(@Param('token') token: string) {
    return { success: true as const, data: await this.svc.describe(token) };
  }

  @Public()
  @Post(':token')
  async enroll(
    @Param('token') token: string,
    @Body() dto: EnrollDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return {
      success: true as const,
      data: await this.svc.enroll(token, dto, ip, userAgent),
    };
  }
}

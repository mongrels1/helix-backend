import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { Public } from '@common/decorators/public.decorator';
import { StripeService } from './stripe.service';

/**
 * Stripe webhook — keeps app access in sync with the subscription automatically:
 * renewals extend access, failed payments suspend it, cancellations revoke it.
 * Public (Stripe is server-to-server) but HARD-verified by the Stripe signature
 * (STRIPE_WEBHOOK_SECRET). The raw request body is captured for this exact route
 * in main.ts, since signature verification needs the unparsed payload.
 */
@Controller('api/v1/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(private readonly stripe: StripeService) {}

  @Public()
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: Request,
    @Headers('stripe-signature') signature?: string,
  ): Promise<{ received: boolean; handled?: boolean; action?: string; email?: string }> {
    const rawBody = req.body as unknown as Buffer;
    let event: Stripe.Event;
    try {
      event = this.stripe.constructEvent(rawBody, signature ?? '');
    } catch (err) {
      this.logger.warn(`Rejected Stripe webhook: ${String(err)}`);
      throw new BadRequestException('invalid_stripe_signature');
    }
    const result = await this.stripe.handleEvent(event);
    return { received: true, ...result };
  }
}

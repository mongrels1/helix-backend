import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StripeService } from './stripe.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';

/**
 * The money seam.
 *
 * `applyEntitlement` decides whether a payment actually unlocks the app. When it
 * matched on email alone, a parent who checked out with a different address than
 * they registered with was charged and their child stayed locked out, with
 * nothing in any dashboard to say why. These cases pin the identity ladder and
 * the two accounts Stripe may never write to.
 */
describe('StripeService entitlement writes', () => {
  let service: StripeService;
  let prisma: {
    user: { findFirst: jest.Mock; update: jest.Mock };
  };
  let email: { sendTrialEndingEmail: jest.Mock; sendAdminAlert: jest.Mock };

  const subscription = (over: Record<string, unknown> = {}) =>
    ({
      id: 'sub_1',
      status: 'active',
      customer: { id: 'cus_123', email: 'Parent@Example.com', deleted: false },
      current_period_end: Math.floor(Date.now() / 1000) + 86400,
      metadata: {},
      ...over,
    }) as never;

  const event = (sub: unknown) =>
    ({ type: 'customer.subscription.updated', data: { object: sub } }) as never;

  beforeEach(async () => {
    prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
    };
    email = { sendTrialEndingEmail: jest.fn(), sendAdminAlert: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        StripeService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: email },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('') } },
      ],
    }).compile();
    service = module.get(StripeService);
  });

  it('prefers an explicit userId in subscription metadata over anything else', async () => {
    prisma.user.findFirst.mockImplementation(({ where }: never) =>
      (where as { id?: string }).id === 'user-meta'
        ? Promise.resolve({ id: 'user-meta', role: 'PARENT', planSource: 'STRIPE', stripeCustomerId: null })
        : Promise.resolve(null),
    );

    await service.handleEvent(event(subscription({ metadata: { userId: 'user-meta' } })));

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-meta' } }),
    );
  });

  it('matches on the Stripe customer id once it has been seen before', async () => {
    prisma.user.findFirst.mockImplementation(({ where }: never) =>
      (where as { stripeCustomerId?: string }).stripeCustomerId === 'cus_123'
        ? Promise.resolve({ id: 'user-cus', role: 'PARENT', planSource: 'STRIPE', stripeCustomerId: 'cus_123' })
        : Promise.resolve(null),
    );

    await service.handleEvent(event(subscription()));

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-cus' } }),
    );
  });

  it('still falls back to email, and stores the customer id so it never has to again', async () => {
    prisma.user.findFirst.mockImplementation(({ where }: never) =>
      (where as { email?: unknown }).email
        ? Promise.resolve({ id: 'user-email', role: 'PARENT', planSource: null, stripeCustomerId: null })
        : Promise.resolve(null),
    );

    await service.handleEvent(event(subscription()));

    const call = prisma.user.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'user-email' });
    expect(call.data.stripeCustomerId).toBe('cus_123');
    // A first Stripe write establishes provenance on a legacy row.
    expect(call.data.planSource).toBe('STRIPE');
    expect(call.data.planStatus).toBe('active');
  });

  it('REFUSES to write to an institutional family', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'redan-parent',
      role: 'PARENT',
      planSource: 'INSTITUTIONAL',
      stripeCustomerId: null,
    });

    await service.handleEvent(event(subscription({ status: 'past_due' })));

    // The whole point: a past_due on an unrelated personal subscription must not
    // revoke a free family's access.
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('REFUSES to write to the owner account', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'owner',
      role: 'SUPER_ADMIN',
      planSource: null,
      stripeCustomerId: null,
    });

    await service.handleEvent(event(subscription({ status: 'past_due' })));

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('reports an unmatched buyer instead of silently succeeding', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    const res = await service.handleEvent(event(subscription()));

    expect(prisma.user.update).not.toHaveBeenCalled();
    // Surfaced in the result and logged at error level: an unresolved webhook
    // means somebody is paying and not entitled.
    expect(res.action).toContain('no_user');
  });

  it('emails a human when a payment cannot be matched', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await service.handleEvent(event(subscription()));

    // A log line only works if somebody is reading the log. This is the one
    // billing failure the customer cannot see, so it pages every time.
    expect(email.sendAdminAlert).toHaveBeenCalledTimes(1);
    const [subject, body] = email.sendAdminAlert.mock.calls[0];
    expect(subject).toContain('PAID BUT NOT ENTITLED');
    expect(body).toContain('sub_1');
    expect(body).toContain('cus_123');
  });

  it("does not re-alert on Stripe's retries of the same subscription", async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await service.handleEvent(event(subscription()));
    await service.handleEvent(event(subscription()));
    await service.handleEvent(event(subscription()));

    expect(email.sendAdminAlert).toHaveBeenCalledTimes(1);
  });

  it('still alerts for a DIFFERENT unmatched subscription', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await service.handleEvent(event(subscription()));
    await service.handleEvent(event(subscription({ id: 'sub_2' })));

    // Each unmatched subscription is a different person who has paid, so a
    // blanket cooldown would have swallowed this one.
    expect(email.sendAdminAlert).toHaveBeenCalledTimes(2);
  });

  it('never lets a failing mail provider break the webhook', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    email.sendAdminAlert.mockRejectedValue(new Error('resend is down'));

    // A webhook that 500s makes Stripe retry, which makes this worse.
    await expect(service.handleEvent(event(subscription()))).resolves.toBeDefined();
  });
});

import { isBillingExempt, isOwnerAccount, isStripeWritable, showsBillingSurface } from './billing';

describe('billing rules', () => {
  describe('isStripeWritable', () => {
    it('allows legacy rows, so nothing that exists today changes behaviour', () => {
      expect(isStripeWritable(null)).toBe(true);
      expect(isStripeWritable(undefined)).toBe(true);
    });

    it('allows rows whose plan came from Stripe', () => {
      expect(isStripeWritable('STRIPE')).toBe(true);
    });

    it('REFUSES institutional and comped rows', () => {
      // The defect this exists to prevent: a Redan parent who ever bought
      // anything personally has an email Stripe knows, and one past_due on that
      // unrelated subscription would otherwise revoke a free family's access.
      expect(isStripeWritable('INSTITUTIONAL')).toBe(false);
      expect(isStripeWritable('COMP')).toBe(false);
    });
  });

  describe('showsBillingSurface', () => {
    it('shows a price to a self-serve parent and student', () => {
      expect(showsBillingSurface('PARENT', null)).toBe(true);
      expect(showsBillingSurface('STUDENT', 'STRIPE')).toBe(true);
    });

    it('never shows a price to staff or the owner', () => {
      expect(showsBillingSurface('TEACHER', null)).toBe(false);
      expect(showsBillingSurface('ORG_ADMIN', null)).toBe(false);
      expect(showsBillingSurface('SUPER_ADMIN', null)).toBe(false);
    });

    it('never shows a price to an institutional or comped family', () => {
      // The consent form a Redan parent signs promises "no charge, no trial that
      // turns into a charge, no credit card and no subscription". A counter or a
      // price on their dashboard breaks that promise on screen.
      expect(showsBillingSurface('PARENT', 'INSTITUTIONAL')).toBe(false);
      expect(showsBillingSurface('STUDENT', 'INSTITUTIONAL')).toBe(false);
      expect(showsBillingSurface('PARENT', 'COMP')).toBe(false);
    });
  });

  it('keeps the existing exemption rules intact', () => {
    expect(isBillingExempt('TEACHER')).toBe(true);
    expect(isBillingExempt('PARENT')).toBe(false);
    expect(isOwnerAccount('SUPER_ADMIN')).toBe(true);
    expect(isOwnerAccount('ORG_ADMIN')).toBe(false);
  });
});

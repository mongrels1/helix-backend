import { billingState, statusLabel, type BillingRow } from './billing.logic';

const base: BillingRow = { role: 'PARENT', planSource: null, planStatus: null, planRenewsAt: null, stripeCustomerId: null };
const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);

describe('billingState', () => {
  it('lets a paying parent with a customer id manage billing', () => {
    expect(billingState({ ...base, planStatus: 'active', planRenewsAt: future, stripeCustomerId: 'cus_1', planSource: 'STRIPE' }, false)).toBe('MANAGE');
  });
  it('still lets a past-due or canceled customer in, to fix the card or see invoices', () => {
    expect(billingState({ ...base, planStatus: 'past_due', stripeCustomerId: 'cus_1' }, false)).toBe('MANAGE');
    expect(billingState({ ...base, planStatus: 'canceled', stripeCustomerId: 'cus_1' }, false)).toBe('MANAGE');
  });
  it('never opens billing for institutional or comped families, even with a customer id', () => {
    expect(billingState({ ...base, planSource: 'INSTITUTIONAL', stripeCustomerId: 'cus_1' }, false)).toBe('NOT_STRIPE_BILLED');
    expect(billingState({ ...base, planSource: 'COMP', planStatus: 'active' }, false)).toBe('NOT_STRIPE_BILLED');
  });
  it('sends a covered scholar to their parent', () => {
    expect(billingState({ ...base, role: 'STUDENT' }, true)).toBe('COVERED_BY_PARENT');
  });
  it('a scholar with their own live plan manages it themselves', () => {
    expect(billingState({ ...base, role: 'STUDENT', planStatus: 'active', planRenewsAt: future, stripeCustomerId: 'cus_2' }, true)).toBe('MANAGE');
  });
  it('flags a paid row with no customer id instead of guessing by email', () => {
    expect(billingState({ ...base, planStatus: 'active', planRenewsAt: future }, false)).toBe('NO_CUSTOMER_ID');
  });
  it('a free account gets plans', () => {
    expect(billingState(base, false)).toBe('NO_PLAN');
    expect(billingState({ ...base, planStatus: 'canceled' }, false)).toBe('NO_PLAN');
  });
  it('staff never see billing', () => {
    expect(billingState({ ...base, role: 'TEACHER', stripeCustomerId: 'cus_1' }, false)).toBe('STAFF');
  });
});

describe('statusLabel', () => {
  it('maps Stripe states to family words', () => {
    expect(statusLabel('active', future)).toBe('active');
    expect(statusLabel('active', past)).toBe('canceled');
    expect(statusLabel('unpaid', null)).toBe('past_due');
    expect(statusLabel('paused', null)).toBe('paused');
    expect(statusLabel(null, null)).toBe('none');
  });
});

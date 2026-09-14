/**
 * The product catalogue — one definition, read by everything.
 *
 * ## Why this exists
 *
 * On 13 September the same product was found carrying four different names:
 * `EdKairos Standard` in the GHL product record, `Standard` in the app's
 * `lib/plans.ts`, **`Family`** on the marketing site, and `Edkairos Standard`
 * (lowercase k) in the database, because the purchase webhook writes whatever
 * string it is handed. A paying customer on **Above-Grade** was displayed as
 * Standard for two weeks and nobody could tell, because `user.plan` was a
 * free-text label that nothing validated and nothing else read.
 *
 * So the label stops being the product. This module is the product, the labels
 * are evidence, and the Stripe price id is the join. Same shape as
 * `common/billing/billing.ts` and `common/family/family.ts`.
 *
 * ## ★ The products are PARALLEL, not nested
 *
 * Above-Grade is not "Standard plus extras" — a family on Above-Grade holds
 * Above-Grade and nothing else, and a family on Standard cannot reach anything
 * Above-Grade has. Writing the copy as *"Everything in Standard, plus…"* (which
 * the live GHL description does) implies a ladder that does not exist in the
 * data model.
 *
 * That is why capabilities are declared **once, in `CAPABILITIES`, each naming
 * the products that have it** — and every list and comparison table is derived
 * from that matrix. A product cannot claim something the matrix does not give
 * it, and two products cannot disagree about a shared line.
 *
 * ## ⚠ The matrix is what we DELIVER, not what we sell
 *
 * Every capability here is enforced by shipped code. It is deliberately not a
 * copy of the GHL description, which currently promises Above-Grade buyers that
 * *"the adaptive engine lifts the ceiling so your child works beyond their
 * enrolled grade"* — a specific functional claim no code implements. This matrix
 * is rendered to families in the product ribbon, which makes it a promise they
 * can hold us to. Nothing goes in it until something enforces it.
 *
 * **Consequence, stated plainly:** until the grade ceiling ships, the Standard
 * and Above-Grade columns of the comparison table are identical. That is not a
 * bug in this file. It is the truth, and it is the argument for building the
 * differentiator.
 */

import { isBillingExempt } from '../billing/billing';

export type ProductId =
  | 'STANDARD'
  | 'ABOVE_GRADE'
  | 'LEGACY'
  | 'FELLOWS'
  | 'INSTITUTIONAL'
  | 'STAFF'
  /** Actively paying, but we cannot tell which product. See `resolveProductId`. */
  | 'PAID_UNKNOWN'
  | 'NONE';

/** The publicly purchasable products, in the order a comparison table shows them. */
export const COMPARABLE_PRODUCT_IDS: ProductId[] = ['STANDARD', 'ABOVE_GRADE'];

/**
 * One capability, and which products have it.
 *
 * Declared once here rather than per product, so a line cannot say one thing in
 * Standard's list and another in Above-Grade's.
 */
export interface Capability {
  key: string;
  label: string;
  /** Products that actually deliver it today. */
  in: ProductId[];
  /**
   * Declared but not yet enforced anywhere. Never rendered to a family — it is
   * here so the gap between what we sell and what we ship is visible in code
   * rather than discovered by a customer.
   */
  pending?: boolean;
}

const ALL_PAID: ProductId[] = [
  'STANDARD',
  'ABOVE_GRADE',
  'LEGACY',
  'FELLOWS',
  'INSTITUTIONAL',
  // Staff are billing-exempt and fully entitled. Without them here the ribbon
  // told the owner of the platform he was on the free tier.
  'STAFF',
  // Paid, tier unknown. They get everything a paid account gets — we simply
  // cannot name which product they bought.
  'PAID_UNKNOWN',
];
const EVERYONE: ProductId[] = [...ALL_PAID, 'NONE'];

export const CAPABILITIES: Capability[] = [
  { key: 'tutor', label: 'Unlimited AI Tutor — Socratic, step by step, reads aloud', in: ALL_PAID },
  { key: 'practice', label: 'Unlimited daily practice, with misconception tracking', in: ALL_PAID },
  { key: 'tutor_free', label: 'Three AI Tutor questions a day', in: ['NONE'] },
  { key: 'practice_free', label: 'Three practice items a day', in: ['NONE'] },
  { key: 'skillsup', label: 'Skills-Up mini-lessons and re-checks when a gap appears', in: EVERYONE },
  { key: 'standards', label: 'Progress tracked against Georgia standards, by standard code', in: EVERYONE },
  { key: 'parent', label: 'A parent dashboard showing your child’s progress', in: ALL_PAID },
  { key: 'diagnostic', label: 'The diagnostic and its report — always free', in: EVERYONE },
  { key: 'seat1', label: 'One child login', in: ['STANDARD', 'ABOVE_GRADE', 'FELLOWS'] },
  { key: 'seat3', label: 'Up to three child logins', in: ['LEGACY'] },

  // ── Fellows: delivered by a person, not the platform ──
  { key: 'seminar', label: 'A weekly seminar with up to six Fellows at the same level', in: ['FELLOWS'] },
  { key: 'strategist', label: 'A monthly one-to-one with a named Academic Strategist', in: ['FELLOWS'] },
  { key: 'target', label: 'A Target Statement written in your own words', in: ['FELLOWS'] },
  { key: 'pathway', label: 'Your pathway rebuilt each term around what was demonstrated', in: ['FELLOWS'] },

  // ── ★ SOLD BUT NOT BUILT ──
  // The order form promises this to Above-Grade buyers today. `in` is empty
  // because no code enforces it, and `pending` keeps it off every family-facing
  // surface. When practice.items() enforces a per-plan grade ceiling, move
  // ABOVE_GRADE into `in` and delete `pending` — in the same commit, not before.
  {
    key: 'above_grade_ceiling',
    label: 'Practice and Skills-Up above the enrolled grade',
    in: [],
    pending: true,
  },
];

/** The capability lines a family on this product may be shown. Never pending ones. */
export function includesFor(id: ProductId): string[] {
  return CAPABILITIES.filter((c) => !c.pending && c.in.includes(id)).map((c) => c.label);
}

/**
 * The comparison matrix behind the ribbon's table: every capability that at
 * least one compared product delivers, and which of them delivers it.
 */
export function comparisonMatrix(
  ids: ProductId[] = COMPARABLE_PRODUCT_IDS,
): { key: string; label: string; has: Record<string, boolean> }[] {
  return CAPABILITIES.filter((c) => !c.pending && ids.some((id) => c.in.includes(id))).map((c) => ({
    key: c.key,
    label: c.label,
    has: Object.fromEntries(ids.map((id) => [id, c.in.includes(id)])),
  }));
}

export interface ProductDefinition {
  id: ProductId;
  /** Canonical name. Matches the GHL product record character for character. */
  name: string;
  /** Display price, or null where price is not a property of the account. */
  price: string | null;
  /** One line a parent can read in a ribbon. */
  summary: string;
  /**
   * Child logins, or null where seats are not a property of the product.
   * Mirrors `provisioning.planConfig()`, which is what a purchase writes onto
   * `maxStudents`.
   */
  seats: number | null;
  /**
   * ★ The join. Stripe price ids that mean this product.
   *
   * A price id is stable, unique, and is what actually charged the card, so it
   * answers "what did they buy" from the payment rather than from a typed name.
   * Renaming a product in GHL can then never change anyone's entitlement — which
   * it silently could, and still can for any row that predates this.
   *
   * ⚠ **EMPTY UNTIL THE IDs ARE READ OUT OF STRIPE.** While a product has no ids
   * here the webhook falls back to matching the label, with all of that
   * mechanism's known weakness. Fill from Stripe → Products → each price →
   * API ID (`price_…`).
   */
  stripePriceIds: string[];
  /** Never shown on a public surface. */
  invitationOnly: boolean;
}

const DEFINITIONS: Record<ProductId, Omit<ProductDefinition, 'id'>> = {
  STANDARD: {
    name: 'EdKairos Standard',
    price: '$24.99/mo',
    summary: 'Unlimited AI math tutoring for one child, on the Georgia standards.',
    seats: 1,
    // Live-mode, read from the Stripe dashboard 13 Sept 2026. Both ids are kept:
    // the Jun 28 price still has subscriptions on it, and an old price id is what
    // an existing customer's renewal actually carries.
    stripePriceIds: [
      'price_1TsCbiI1PrvNiO59GOAlqopj', // $24.99/mo, created 11 Jul — 2 active
      'price_1TnRN9I1PrvNiO59gSkTbnuM', // $24.99/mo, created 28 Jun
    ],
    invitationOnly: false,
  },
  ABOVE_GRADE: {
    name: 'EdKairos Above-Grade',
    price: '$39.99/mo',
    summary: 'For a student already working beyond their enrolled grade.',
    seats: 1,
    stripePriceIds: [
      'price_1TsCbEI1PrvNiO59SvW4AedF', // $39.99/mo, created 11 Jul — 1 active
      'price_1TnROXI1PrvNiO59vrZL0LpQ', // $39.99/mo, created 28 Jun
    ],
    invitationOnly: false,
  },
  LEGACY: {
    name: 'EdKairos Legacy',
    price: '$19.99/mo',
    summary: 'The invitation rate, for up to three children in one household.',
    seats: 3,
    // Two of these are named "EdKairos Founding Family" in Stripe — the older
    // label for the same product. They map here, which is the point: the price
    // id is stable, the marketing name was not.
    stripePriceIds: [
      'price_1U4RDHI1PrvNiO59DXEC9aTm', // $19.99/mo, created 14 Aug
      'price_1TsCaaI1PrvNiO59pmecMXSa', // $19.99/mo, created 11 Jul (Founding Family)
      'price_1TnRQ1I1PrvNiO595N3NpTmO', // $19.99/mo, created 28 Jun (Founding Family) — 1 active
    ],
    invitationOnly: true,
  },
  FELLOWS: {
    name: 'EdKairos Fellows',
    // Read from the GHL record 13 Sept: "EdKairos Fellows @ 1499" = $1,499.00,
    // "Monthly plan — 4 payments" = $399.00. Monthly is live, so the term is
    // NOT pay-in-full only.
    price: '$399/mo × 4, or $1,499 in full',
    summary: 'Admissions-based. Eight places, four months, grades 6–8.',
    seats: 1,
    // The $395 prices predate the 7 Sept correction to $399 and carry no
    // subscriptions; kept so a historical row still resolves to Fellows.
    stripePriceIds: [
      'price_1UD7XKI1PrvNiO59z5CJ1Jr2', // $399/mo, created 7 Sep
      'price_1U6EkAI1PrvNiO59McJv1Vlp', // $395/mo, created 19 Aug
      'price_1U6EVzI1PrvNiO59iPdzMhrb', // $395/mo, created 19 Aug
    ],
    invitationOnly: true,
  },
  INSTITUTIONAL: {
    name: 'School or partner programme',
    price: null,
    summary: 'Your school or programme provides this. There is no charge to your family.',
    seats: null,
    stripePriceIds: [],
    invitationOnly: true,
  },
  STAFF: {
    name: 'Staff access',
    price: null,
    summary: 'Full access as a member of the team. Not a subscription, and never billed.',
    seats: null,
    stripePriceIds: [],
    invitationOnly: true,
  },
  PAID_UNKNOWN: {
    // Reads sensibly in both places it appears: a family sees that their plan is
    // active, and an admin sees a row whose product we could not determine —
    // which is exactly the row that needs a human to look at it.
    name: 'Active plan',
    price: null,
    summary: 'Your subscription is active. Full access, no daily limits.',
    seats: null,
    stripePriceIds: [],
    invitationOnly: false,
  },
  NONE: {
    name: 'Free',
    price: null,
    summary: 'Three tutor questions and three practice items a day. Resets at midnight.',
    seats: null,
    stripePriceIds: [],
    invitationOnly: false,
  },
};

export const PRODUCTS: Record<ProductId, ProductDefinition> = Object.fromEntries(
  (Object.keys(DEFINITIONS) as ProductId[]).map((id) => [id, { id, ...DEFINITIONS[id] }]),
) as Record<ProductId, ProductDefinition>;

/**
 * Map a stored plan label onto a product. The fallback, for rows written before
 * the price-id join and for any webhook whose price we do not recognise.
 *
 * Order matters. "Above-Grade" is tested before "Standard" because the live GHL
 * description opens *"Everything in Standard, plus…"*, and a substring match the
 * other way round would silently downgrade every Above-Grade account — the exact
 * failure this module was written to end.
 */
export function resolveProductId(
  plan: string | null | undefined,
  planSource?: string | null,
  hasActivePlan = true,
  role?: string | null,
): ProductId {
  // Staff and the owner first: they are billing-exempt, entitled regardless of
  // planStatus, and have no product to speak of. Resolving them by label put
  // "Free" on the owner's own ribbon.
  if (isBillingExempt(role)) return 'STAFF';
  if (planSource === 'INSTITUTIONAL') return 'INSTITUTIONAL';

  const p = (plan ?? '').toLowerCase();
  if (p.includes('institutional')) return 'INSTITUTIONAL';
  if (p.includes('fellow')) return 'FELLOWS';
  if (p.includes('above')) return 'ABOVE_GRADE';
  if (p.includes('legacy') || p.includes('founding') || p.includes('family')) return 'LEGACY';
  if (p.includes('standard')) return 'STANDARD';

  // ★ A paid row is a paid row, label or no label.
  //
  // This branch used to require a non-empty label, so an account with
  // planStatus 'active' and `plan` null — a real one exists, bought before the
  // product records did — fell through to NONE and was shown "Free" on its own
  // dashboard. Under-reporting somebody who is paying is the failure this whole
  // module exists to prevent.
  //
  // It does NOT guess a tier. Naming the wrong product is worse than admitting
  // we cannot name it, which is the lesson of the Sterling account: a value can
  // be confidently displayed and still be false.
  if (hasActivePlan) return 'PAID_UNKNOWN';
  return 'NONE';
}

/**
 * ★ The join, when we have it: a Stripe price id onto a product.
 *
 * Returns null when the id is unknown — deliberately, so the caller can log a
 * miss and fall back to the label rather than guessing. An unrecognised price is
 * a catalogue that has fallen behind Stripe, which is worth a loud line in the
 * logs, not a silent default.
 */
export function resolveProductByPriceId(
  priceId: string | null | undefined,
): ProductDefinition | null {
  if (!priceId) return null;
  for (const def of Object.values(PRODUCTS)) {
    if (def.stripePriceIds.includes(priceId)) return def;
  }
  return null;
}

/** True once someone has filled in the price ids — used to warn while they are empty. */
export function priceIdMappingConfigured(): boolean {
  return Object.values(PRODUCTS).some((p) => p.stripePriceIds.length > 0);
}

export function productFor(
  plan: string | null | undefined,
  planSource?: string | null,
  hasActivePlan = true,
  role?: string | null,
): ProductDefinition {
  return PRODUCTS[resolveProductId(plan, planSource, hasActivePlan, role)];
}

/** The products an admin may assign by hand. Excludes NONE and INSTITUTIONAL. */
export const ASSIGNABLE_PRODUCT_IDS: ProductId[] = [
  'STANDARD',
  'ABOVE_GRADE',
  'LEGACY',
  'FELLOWS',
];

export function isAssignableProductId(value: string): value is ProductId {
  return (ASSIGNABLE_PRODUCT_IDS as string[]).includes(value);
}

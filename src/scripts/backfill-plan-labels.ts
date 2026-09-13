/**
 * One-off: give paid accounts that have no plan label one, from Stripe.
 *
 * ## Why any row is missing a label
 *
 * `ProvisioningService` (the GHL purchase webhook) has always written `plan`
 * from the payload's product field, so GHL-bought accounts carry a tier name.
 * The Stripe webhook path never wrote one until 13 Sept 2026 — it set
 * `planStatus`, `planRenewsAt`, `planSource` and `stripeCustomerId` and nothing
 * else. Any account whose subscription reached us only through Stripe before
 * that therefore reads "Paid" in the admin list with no tier beside it.
 *
 * Going forward those rows fill themselves in on their next subscription event
 * (renewal, price change, pause). This script is only for not waiting.
 *
 * ## What it will not do
 *
 * - It never overwrites an existing label. `plan: null` is the only row it looks at.
 * - It never invents a tier. A subscription whose price has neither a product
 *   name nor a nickname is skipped and counted, not guessed at. A row reading
 *   "Paid" with no tier is true; a row reading the wrong tier is worse than
 *   blank, and this codebase has been bitten once already by a number that was
 *   real, signed and still fictional.
 * - It never changes planStatus, dates, or entitlement. Labels only.
 *
 * ## Running it
 *
 *   node dist/scripts/backfill-plan-labels.js            # dry run, prints a plan
 *   node dist/scripts/backfill-plan-labels.js --apply    # writes
 *
 * Dry run is the default deliberately — run it first and read the output. On
 * Railway, use the service shell for `positive-radiance` so STRIPE_SECRET_KEY
 * and DATABASE_URL are already in the environment.
 */
import { PrismaClient } from '@prisma/client';
import type Stripe from 'stripe';

// Same require shape as StripeService: the SDK's CJS export does not import
// cleanly under this build's module settings.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const StripeLib = require('stripe');

const APPLY = process.argv.includes('--apply');

async function productName(stripe: Stripe, price: Stripe.Price): Promise<string | null> {
  const product = price.product;
  if (product && typeof product !== 'string') {
    if (!('deleted' in product && product.deleted)) {
      const name = (product as Stripe.Product).name?.trim();
      if (name) return name;
    }
  } else if (typeof product === 'string') {
    try {
      // Read structurally — see the note in StripeService.planLabel: the SDK
      // types `retrieve` as always returning a live Product.
      const fetched = (await stripe.products.retrieve(product)) as {
        name?: string;
        deleted?: boolean;
      };
      if (!fetched.deleted) {
        const name = fetched.name?.trim();
        if (name) return name;
      }
    } catch {
      // fall through to the nickname
    }
  }
  return price.nickname?.trim() || null;
}

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    console.error('STRIPE_SECRET_KEY is not set. Nothing to read tier names from.');
    process.exitCode = 1;
    return;
  }

  const stripe = new StripeLib(key) as Stripe;
  const prisma = new PrismaClient();

  try {
    // Only rows that are actually paying and actually unlabelled. A row with no
    // stripeCustomerId cannot be looked up at all, and is reported separately
    // rather than silently dropped — it usually means the purchase came through
    // a path that never stored the durable key.
    const candidates = await prisma.user.findMany({
      where: { deletedAt: null, plan: null, planStatus: 'active' },
      select: { id: true, email: true, stripeCustomerId: true },
      orderBy: { createdAt: 'asc' },
    });

    const unlinkable = candidates.filter((u) => !u.stripeCustomerId);
    const linkable = candidates.filter((u) => u.stripeCustomerId);

    console.log(`${candidates.length} active account(s) with no plan label.`);
    console.log(`  ${linkable.length} have a Stripe customer id and can be looked up.`);
    console.log(`  ${unlinkable.length} do not — these need a human, not this script.`);
    if (unlinkable.length > 0) {
      for (const u of unlinkable) console.log(`    no customer id: ${u.email}`);
    }
    console.log(APPLY ? '\nAPPLYING.\n' : '\nDRY RUN — pass --apply to write.\n');

    let named = 0;
    let unnamed = 0;
    let noSub = 0;

    for (const user of linkable) {
      let label: string | null = null;
      try {
        const subs = await stripe.subscriptions.list({
          customer: user.stripeCustomerId as string,
          status: 'all',
          limit: 10,
        });
        // Prefer a live subscription; fall back to the most recent of any status,
        // since the row is marked active and something paid for it.
        const sub =
          subs.data.find((s) => s.status === 'active' || s.status === 'trialing') ?? subs.data[0];
        if (!sub) {
          noSub++;
          console.log(`  no subscription found: ${user.email}`);
          continue;
        }
        const price = sub.items?.data?.[0]?.price;
        label = price ? await productName(stripe, price) : null;
      } catch (err) {
        console.log(`  lookup failed: ${user.email} — ${String(err)}`);
        continue;
      }

      if (!label) {
        unnamed++;
        console.log(`  no tier name available: ${user.email} (left blank on purpose)`);
        continue;
      }

      named++;
      console.log(`  ${APPLY ? 'set' : 'would set'} ${user.email} -> ${label}`);
      if (APPLY) {
        // Re-check plan IS NULL at write time: a webhook may have landed while
        // this script was walking the list, and it is more current than we are.
        await prisma.user.updateMany({
          where: { id: user.id, plan: null },
          data: { plan: label },
        });
      }
    }

    console.log(
      `\nDone. ${named} labelled, ${unnamed} had no tier name, ${noSub} had no subscription.` +
        (APPLY ? '' : ' Nothing was written.'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();

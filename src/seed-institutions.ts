/**
 * One-shot institution seed, run from the Railway start command before the app
 * boots. Idempotent by design: it upserts the school and only writes an
 * enrollment token if one is not already set, so a code already printed on a
 * letter can never be invalidated by a redeploy. Safe to run on every boot, and
 * safe to delete once the school exists.
 *
 * Per-student access codes (29 Oct 2026): a school with requireAccessCode only
 * enrolls a family that also redeems a single-use code from its flyer. The
 * codes are NOT in this file — this repository is public. They arrive in the
 * environment variable ACCESS_CODES_<SLUG> (e.g. ACCESS_CODES_REDAN), separated
 * by commas, spaces or newlines, and only their SHA-256 fingerprints are stored.
 * Re-running with the same list adds nothing; adding codes to the list adds
 * only the new ones; a redeemed code is never reset.
 */
import { PrismaClient } from '@prisma/client';
import { hashAccessCode, parseAccessCodeList } from './modules/institutional-enrollment/access-code';

const prisma = new PrismaClient();

const INSTITUTIONS = [
  {
    slug: 'redan',
    name: 'Redan Middle School',
    enrollmentToken: 'aa0b2f5f9d00388108fbd0a0968dd08362de7db23f3a7062',
    enrollmentCap: 100, // 86 rostered students plus headroom for other teachers
    // John, 29 Oct 2026: one code per student, free for 10 months, then the
    // account returns to unpaid (the free tier). Nothing is ever charged.
    requireAccessCode: true,
    accessCodeFreeMonths: 10,
  },
];

async function main() {
  for (const inst of INSTITUTIONS) {
    const org = await prisma.organization.upsert({
      where: { slug: inst.slug },
      update: {
        publicEnrollmentEnabled: true,
        enrollmentCap: inst.enrollmentCap,
        requireAccessCode: inst.requireAccessCode,
      },
      create: {
        name: inst.name,
        slug: inst.slug,
        publicEnrollmentEnabled: true,
        enrollmentToken: inst.enrollmentToken,
        enrollmentCap: inst.enrollmentCap,
        requireAccessCode: inst.requireAccessCode,
      },
    });

    const final = org.enrollmentToken
      ? org
      : await prisma.organization.update({
          where: { id: org.id },
          data: { enrollmentToken: inst.enrollmentToken },
        });

    const envName = `ACCESS_CODES_${inst.slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    const codes = parseAccessCodeList(process.env[envName]);
    let added = 0;
    if (codes.length) {
      const res = await prisma.enrollmentAccessCode.createMany({
        data: codes.map((c) => ({
          organizationId: final.id,
          codeHash: hashAccessCode(c),
          freeMonths: inst.accessCodeFreeMonths,
        })),
        skipDuplicates: true,
      });
      added = res.count;
    }
    const [total, redeemed] = await Promise.all([
      prisma.enrollmentAccessCode.count({ where: { organizationId: final.id } }),
      prisma.enrollmentAccessCode.count({ where: { organizationId: final.id, redeemedAt: { not: null } } }),
    ]);

    // Never print the token or the codes: the log is visible to anyone with
    // Railway access, and the codes are the only key once requireAccessCode is on.
    console.log(
      `[seed-institutions] ${final.slug} ready — cap=${final.enrollmentCap} ` +
        `used=${final.enrollmentsUsed} enabled=${final.publicEnrollmentEnabled} ` +
        `requireAccessCode=${inst.requireAccessCode} codes=${total} (+${added} new, ${redeemed} redeemed)` +
        (inst.requireAccessCode && total === 0 ? ` — WARNING: no codes loaded; set ${envName}` : ''),
    );
  }
}

main()
  .catch((e) => {
    // Never block the app from starting over a seed failure.
    console.error('[seed-institutions] FAILED:', (e as Error).message);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

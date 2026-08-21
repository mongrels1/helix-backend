/**
 * One-shot institution seed, run from the Railway start command before the app
 * boots. Idempotent by design: it upserts the school and only writes an
 * enrollment token if one is not already set, so a code already printed on a
 * letter can never be invalidated by a redeploy. Safe to run on every boot, and
 * safe to delete once the school exists.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const INSTITUTIONS = [
  {
    slug: 'redan',
    name: 'Redan Middle School',
    enrollmentToken: 'aa0b2f5f9d00388108fbd0a0968dd08362de7db23f3a7062',
    enrollmentCap: 100, // 86 rostered students plus headroom for other teachers
  },
];

async function main() {
  for (const inst of INSTITUTIONS) {
    const org = await prisma.organization.upsert({
      where: { slug: inst.slug },
      update: { publicEnrollmentEnabled: true, enrollmentCap: inst.enrollmentCap },
      create: {
        name: inst.name,
        slug: inst.slug,
        publicEnrollmentEnabled: true,
        enrollmentToken: inst.enrollmentToken,
        enrollmentCap: inst.enrollmentCap,
      },
    });

    const final = org.enrollmentToken
      ? org
      : await prisma.organization.update({
          where: { id: org.id },
          data: { enrollmentToken: inst.enrollmentToken },
        });

    console.log(
      `[seed-institutions] ${final.slug} ready — token=${final.enrollmentToken} ` +
        `cap=${final.enrollmentCap} used=${final.enrollmentsUsed} ` +
        `enabled=${final.publicEnrollmentEnabled}`,
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

/**
 * seedDemo.ts — the public "Explore the live platform" demo account.
 *
 * Creates one ENTITLED demo learner (active plan) so a no-signup visitor who
 * lands on app.edkairos.com/demo sees the full product. Idempotent (upsert).
 * The frontend /demo route auto-logs in with the email/password below.
 *
 * Run once against your database (I do NOT run this for you):
 *     DATABASE_URL=... npx tsx prisma/seedDemo.ts
 * (use the same runner as your normal seed if it isn't tsx.)
 */
import { PrismaClient, Role, MasteryStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Public demo credentials — intentionally known (demo-only account, sample data).
export const DEMO_EMAIL = 'demo@edkairos.com';
export const DEMO_PASSWORD = 'ExploreEdKairos!2026';

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const renews = new Date();
  renews.setFullYear(renews.getFullYear() + 1);

  const demo = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    create: {
      id: 'demo-student',
      email: DEMO_EMAIL,
      passwordHash,
      role: Role.STUDENT,
      plan: 'family',
      planStatus: 'active',
      planRenewsAt: renews,
      profile: { create: { firstName: 'Maya', lastName: 'Rivera', grade: '5' } },
    },
    update: {
      passwordHash,
      role: Role.STUDENT,
      plan: 'family',
      planStatus: 'active',
      planRenewsAt: renews,
      profile: {
        upsert: {
          create: { firstName: 'Maya', lastName: 'Rivera', grade: '5' },
          update: { firstName: 'Maya', lastName: 'Rivera', grade: '5' },
        },
      },
    },
  });

  // A small "climb" so the dashboard isn't empty on entry. Best-effort skill tags;
  // adjust to your real taxonomy if these don't render with friendly names.
  const mastery = [
    { skillTag: 'geometry.perimeter', score: 0.95, pMastered: 0.93, status: MasteryStatus.MASTERED },
    { skillTag: 'geometry.area',      score: 0.78, pMastered: 0.78, status: MasteryStatus.EMERGING },
    { skillTag: 'geometry.angles',    score: 0.34, pMastered: 0.34, status: MasteryStatus.NOT_STARTED },
  ];
  for (const m of mastery) {
    await prisma.masteryScore.upsert({
      where: { studentId_skillTag: { studentId: demo.id, skillTag: m.skillTag } },
      create: {
        studentId: demo.id, skillTag: m.skillTag, score: m.score, pMastered: m.pMastered,
        status: m.status, masteredAt: m.status === MasteryStatus.MASTERED ? new Date() : null,
      },
      update: { score: m.score, pMastered: m.pMastered, status: m.status },
    });
  }

  console.log(`Demo account ready: ${DEMO_EMAIL} (entitled: plan=family/active) + ${mastery.length} mastery skills.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

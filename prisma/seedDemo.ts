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

  // Reset the demo's climb so re-runs stay clean, then seed friendly-named skills.
  // The tutor sends "Teach me: <skillTag>" to the AI and the cards display the tag
  // verbatim, so these names show exactly as written AND teach correctly.
  await prisma.masteryHistory.deleteMany({ where: { masteryScore: { studentId: demo.id } } });
  await prisma.masteryScore.deleteMany({ where: { studentId: demo.id } });

  const mastery = [
    { skillTag: 'Perimeter',          score: 0.95, pMastered: 0.93, status: MasteryStatus.MASTERED },
    { skillTag: 'Area of rectangles', score: 0.78, pMastered: 0.78, status: MasteryStatus.EMERGING },
    { skillTag: 'Angles',             score: 0.34, pMastered: 0.34, status: MasteryStatus.NOT_STARTED },
  ];
  for (const m of mastery) {
    await prisma.masteryScore.create({
      data: {
        studentId: demo.id, skillTag: m.skillTag, score: m.score, pMastered: m.pMastered,
        status: m.status, masteredAt: m.status === MasteryStatus.MASTERED ? new Date() : null,
      },
    });
  }

  console.log(`Demo account ready: ${DEMO_EMAIL} (entitled: plan=family/active) + ${mastery.length} mastery skills.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

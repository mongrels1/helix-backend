/**
 * One-off: re-apply a student's LATEST diagnostic to their mastery scores,
 * using the rule every new diagnostic now follows (commit 0ed4652): a skill the
 * diagnostic found weak drops to what the diagnostic measured.
 *
 * ## Why
 *
 * Before 0ed4652 a skill at 100% could never come down: at P = 1.0 the mastery
 * model reads a miss as a slip. A student who did badly on a new diagnostic
 * still showed 100% on everything, and "Work on these first" stayed empty.
 *
 * ## What it does / will not do
 *
 * - One student, chosen by --email or by --name "First Last" (must match one
 *   student exactly, else it lists the matches and stops).
 * - Only skills the latest diagnostic found WEAK (below 60%, the same rule the
 *   diagnostic uses). Each is set to min(current, measured). Never raised.
 * - Skills the diagnostic got right are not touched (already counted when it
 *   was saved). No other table is touched. One history row per change.
 *
 * ## Running it (Railway, service positive-radiance shell)
 *
 *   node dist/scripts/reapply-latest-diagnostic.js --name "First Last"          # dry run
 *   node dist/scripts/reapply-latest-diagnostic.js --name "First Last" --apply  # writes
 */
import { MasteryStatus, PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

import { masteryValueForTag } from '../intelligence/diagnostic/diagnostic-mastery';
export { masteryValueForTag };

/** Per-skill measured score from a diagnostic's responses (mean per KC). */
export function measuredByKc(responses: { kc: string; tag: string }[]): Map<string, number> {
  const byKc = new Map<string, { sum: number; n: number }>();
  for (const r of responses) {
    const v = masteryValueForTag(r.tag);
    if (v === null) continue;
    const e = byKc.get(r.kc) ?? { sum: 0, n: 0 };
    e.sum += v;
    e.n += 1;
    byKc.set(r.kc, e);
  }
  return new Map([...byKc].map(([kc, { sum, n }]) => [kc, sum / n]));
}

/**
 * The changes to make for each WEAK skill: lower a stored score that is above
 * the measurement (id set), or create the skill when it has no score yet
 * (id null, from null) so it appears on My skills.
 */
export function plan(
  measured: Map<string, number>,
  current: { id: string; skillTag: string; pMastered: number }[],
): { id: string | null; skillTag: string; from: number | null; to: number }[] {
  const out: { id: string | null; skillTag: string; from: number | null; to: number }[] = [];
  const byTag = new Map(current.map((r) => [r.skillTag, r]));
  for (const [skillTag, m] of measured) {
    if (m >= 0.6) continue;
    const row = byTag.get(skillTag);
    if (!row) out.push({ id: null, skillTag, from: null, to: m });
    else if (row.pMastered > m) out.push({ id: row.id, skillTag, from: row.pMastered, to: m });
  }
  return out.sort((a, b) => a.skillTag.localeCompare(b.skillTag));
}

async function main() {
  const email = arg('--email');
  const name = arg('--name');
  if (!email && !name) {
    console.log('Usage: --email <address> | --name "First Last"  [--apply]');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    let students: { id: string; email: string; profile: { firstName: string; lastName: string } | null }[];
    if (email) {
      students = await prisma.user.findMany({
        where: { email: { equals: email, mode: 'insensitive' }, role: 'STUDENT', deletedAt: null },
        select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } },
      });
    } else {
      const [first, ...rest] = name!.trim().split(/\s+/);
      students = await prisma.user.findMany({
        where: {
          role: 'STUDENT',
          deletedAt: null,
          profile: { firstName: { equals: first, mode: 'insensitive' }, lastName: { equals: rest.join(' '), mode: 'insensitive' } },
        },
        select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } },
      });
    }
    if (students.length !== 1) {
      console.log(`Expected exactly 1 student, found ${students.length}. Nothing changed.`);
      for (const s of students) console.log(`  ${s.id}  ${s.profile?.firstName ?? ''} ${s.profile?.lastName ?? ''}`);
      process.exit(students.length ? 2 : 1);
    }
    const student = students[0];
    const who = `${student.profile?.firstName ?? ''} ${student.profile?.lastName ?? ''}`.trim();

    const session = await prisma.diagnosticSession.findFirst({
      where: { userId: student.id },
      orderBy: { completedAt: 'desc' },
      include: { responses: { select: { kc: true, tag: true } } },
    });
    if (!session) {
      console.log(`${who}: no diagnostic on file. Nothing changed.`);
      return;
    }
    const measured = measuredByKc(session.responses);
    const current = await prisma.masteryScore.findMany({
      where: { studentId: student.id },
      select: { id: true, skillTag: true, pMastered: true },
    });
    const changes = plan(measured, current);
    const weak = [...measured].filter(([, v]) => v < 0.6).length;

    console.log(`${who} — latest diagnostic ${session.completedAt.toISOString()} (${session.responses.length} answers, ${measured.size} skills, ${weak} weak)`);
    if (!changes.length) {
      console.log('No skill needs lowering. Nothing changed.');
      return;
    }
    for (const c of changes) {
      const from = c.from === null ? 'new' : `${Math.round(c.from * 100)}%`;
      console.log(`  ${c.skillTag.padEnd(40)} ${from} -> ${Math.round(c.to * 100)}%`);
    }
    if (!APPLY) {
      console.log(`\nDRY RUN: ${changes.length} skill(s) would change. Re-run with --apply to write.`);
      return;
    }
    await prisma.$transaction(async (tx) => {
      for (const c of changes) {
        const data = { score: c.to, pMastered: c.to, status: MasteryStatus.EMERGING, masteredAt: null, nextRecheckAt: null };
        const row = c.id
          ? await tx.masteryScore.update({ where: { id: c.id }, data })
          : await tx.masteryScore.create({ data: { ...data, studentId: student.id, skillTag: c.skillTag } });
        await tx.masteryHistory.create({
          data: { masteryScoreId: row.id, score: c.to, correct: false, pAfter: c.to, variantKey: `reapply-diagnostic:${session.id}` },
        });
      }
    });
    console.log(`\nAPPLIED: ${changes.length} skill(s) updated.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

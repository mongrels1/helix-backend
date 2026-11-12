/**
 * One-off helper: find a diagnostic that did not land on a student's account,
 * and (optionally) attach an UNCLAIMED one to that student.
 *
 * A diagnostic finished while signed out, or on a parent account that is not
 * linked to exactly one child, is stored anonymously with a claim token and
 * attaches only when the student later signs in on that same browser. If that
 * never happens the result sits unclaimed and the student's practice and
 * mastery never see it.
 *
 * ## Running it (Railway, service positive-radiance, via `railway ssh --`)
 *
 * List (read-only): unclaimed diagnostics from the last N days, plus any whose
 * owner or typed name matches --name.
 *   node dist/scripts/find-diagnostics.js --name "First Last" [--days 3]
 *
 * Attach one (dry run, then --apply). Only an UNCLAIMED diagnostic can be
 * attached; one already on another account is refused.
 *   node dist/scripts/find-diagnostics.js --attach <sessionId> --name "First Last"
 *   node dist/scripts/find-diagnostics.js --attach <sessionId> --name "First Last" --apply
 *
 * After attaching, run reapply-latest-diagnostic.js for the same student.
 */
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

export function matchesName(target: string, ...candidates: (string | null | undefined)[]): boolean {
  const t = target.trim().toLowerCase();
  const first = t.split(/\s+/)[0];
  return candidates.some((c) => {
    const v = (c ?? '').trim().toLowerCase();
    return !!v && (v === t || v.includes(t) || (first.length > 2 && v.split(/\s+/)[0] === first));
  });
}

const et = (d: Date) => d.toLocaleString('en-US', { timeZone: 'America/New_York' });

async function main() {
  const name = arg('--name');
  const attach = arg('--attach');
  const days = Number(arg('--days') ?? 3);
  if (!name) {
    console.log('Usage: --name "First Last" [--days 3] | --attach <sessionId> --name "First Last" [--apply]');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    if (attach) {
      const [first, ...rest] = name.trim().split(/\s+/);
      const students = await prisma.user.findMany({
        where: { role: 'STUDENT', deletedAt: null, profile: { firstName: { equals: first, mode: 'insensitive' }, lastName: { equals: rest.join(' '), mode: 'insensitive' } } },
        select: { id: true },
      });
      if (students.length !== 1) {
        console.log(`Expected exactly 1 student named "${name}", found ${students.length}. Nothing changed.`);
        process.exit(2);
      }
      const s = await prisma.diagnosticSession.findUnique({
        where: { id: attach },
        select: { id: true, userId: true, completedAt: true, studentName: true, _count: { select: { responses: true } } },
      });
      if (!s) { console.log('No diagnostic with that id. Nothing changed.'); process.exit(1); }
      if (s.userId) {
        console.log(`Refused: that diagnostic already belongs to account ${s.userId}. Nothing changed.`);
        process.exit(2);
      }
      console.log(`Diagnostic ${s.id} (${et(s.completedAt)} ET, ${s._count.responses} answers, typed name "${s.studentName ?? ''}") -> ${name}`);
      if (!APPLY) { console.log('DRY RUN. Re-run with --apply to attach.'); return; }
      await prisma.diagnosticSession.update({ where: { id: s.id }, data: { userId: students[0].id, claimToken: null } });
      console.log('ATTACHED. Now run: node dist/scripts/reapply-latest-diagnostic.js --name "' + name + '" (dry run, then --apply)');
      return;
    }

    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const rows = await prisma.diagnosticSession.findMany({
      where: { completedAt: { gte: since } },
      orderBy: { completedAt: 'desc' },
      select: {
        id: true, userId: true, completedAt: true, studentName: true, grade: true,
        user: { select: { role: true, profile: { select: { firstName: true, lastName: true } } } },
        responses: { select: { correct: true } },
      },
      take: 500,
    });
    const shown = rows.filter((r) => {
      const owner = r.user ? `${r.user.profile?.firstName ?? ''} ${r.user.profile?.lastName ?? ''}`.trim() : null;
      return !r.userId || matchesName(name, owner, r.studentName);
    });
    console.log(`Diagnostics in the last ${days} day(s): ${rows.length}. Showing ${shown.length} (unclaimed, or matching "${name}").`);
    for (const r of shown) {
      const n = r.responses.length;
      const pct = n ? Math.round((100 * r.responses.filter((x) => x.correct).length) / n) : 0;
      const owner = r.user
        ? `${r.user.profile?.firstName ?? ''} ${r.user.profile?.lastName ?? ''}`.trim() + ` (${r.user.role})`
        : 'UNCLAIMED';
      console.log(`  ${r.id}  ${et(r.completedAt)} ET  ${n} answers, ${pct}% correct  grade ${r.grade ?? '-'}  owner: ${owner}  typed name: ${r.studentName ?? '-'}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

// reject_items.js — flip verifier-flagged items to 'rejected' (reversible). Dry-run unless --apply.
const { PrismaClient } = require('@prisma/client');
const fs = require('fs'); const os = require('os');
const p = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const reportPath = os.homedir() + '/edkairos_verify/real_report.json';
const NOISE = ['timed out','unparseable','verifier_error'];
function isNoise(r) {
  if (r.problems && r.problems.length) return false;
  const reason = (r.ai && r.ai.reason) || '';
  return !reason || NOISE.some(n => reason.includes(n)) || reason.trim().startsWith('{');
}
(async () => {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const flagged = report.filter(r => !(r.accuracy_ok && r.precision_ok));
  const candidates = flagged.filter(r => !isNoise(r));
  console.log(`Report: ${report.length} checked, ${flagged.length} flagged, ${candidates.length} reject candidates (noise skipped: ${flagged.length - candidates.length}).`);
  console.log(APPLY ? '\n=== APPLYING REJECTIONS ===' : '\n=== DRY RUN — no changes. Add --apply to commit. ===');
  let done = 0;
  for (const r of candidates) {
    const dash = r.id.indexOf('-');
    const table = r.id.slice(0, dash), uuid = r.id.slice(dash + 1);
    const reason = (r.problems && r.problems.length ? r.problems.join('; ') : (r.ai && r.ai.reason)) || 'flagged';
    if (!APPLY) { console.log(`  would reject ${table}:${uuid.slice(0,8)} [${r.standard}] — ${reason.slice(0,90)}`); continue; }
    try {
      if (table === 'draft') {
        const cur = await p.draftItem.findUnique({ where: { id: uuid }, select: { status: true, validation: true } });
        if (!cur) { console.log('  skip (not found):', uuid.slice(0,8)); continue; }
        await p.draftItem.update({ where: { id: uuid }, data: { status: 'rejected',
          validation: { ...(cur.validation || {}), rejected_by: 'ai-verifier', reject_reason: reason, prev_status: cur.status, rejected_at: new Date().toISOString() } } });
      } else {
        const cur = await p.diagnosticItem.findUnique({ where: { id: uuid }, select: { status: true } });
        if (!cur) { console.log('  skip (not found):', uuid.slice(0,8)); continue; }
        await p.diagnosticItem.update({ where: { id: uuid }, data: { status: 'rejected' } });
      }
      done++; console.log(`  rejected ${table}:${uuid.slice(0,8)} [${r.standard}]`);
    } catch (e) { console.log('  ERROR', uuid.slice(0,8), e.message.slice(0,100)); }
  }
  console.log(APPLY ? `\nDone. ${done} items set to 'rejected' (reversible — prev_status saved in validation).`
                    : `\n${candidates.length} would be rejected. Re-run with --apply to commit.`);
  await p.$disconnect();
})();

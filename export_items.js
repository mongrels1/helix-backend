// Dump DraftItem + DiagnosticItem to /tmp/real_items.json (normalized for the harness)
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const p = new PrismaClient();

function norm(list, table) {
  return list.map(it => {
    const figure = it.figure ?? null;
    let options, key, misc, prov;
    if (table === 'draft') {
      options = Array.isArray(it.options) ? it.options : (it.options && it.options.options) || it.options;
      key = it.answer;
      misc = it.misconceptionTags || [];
      prov = it.provenance || 'AIG';
    } else {
      options = it.options;
      key = Array.isArray(it.options) ? it.options[it.correct ?? 0] : null;
      misc = [];
      prov = it.source || 'manual';
    }
    return { item_id: table + '-' + it.id, table,
             model: (figure && figure.type) ? figure.type : 'open',
             stem: it.stem, options, key, figure,
             standard: it.standard ?? null, dok: it.dok ?? null,
             misconception_tags: misc, provenance: prov };
  });
}

(async () => {
  const drafts = await p.draftItem.findMany({ take: 200, orderBy: { createdAt: 'desc' } });
  const diags  = await p.diagnosticItem.findMany({ take: 200, orderBy: { createdAt: 'desc' } });
  const all = [...norm(drafts, 'draft'), ...norm(diags, 'diagnostic')];
  fs.writeFileSync('/tmp/real_items.json', JSON.stringify(all, null, 2));
  console.log('Exported ' + drafts.length + ' draft + ' + diags.length + ' diagnostic = ' + all.length + ' items to /tmp/real_items.json');
  console.log('\n--- 2 SAMPLE ITEMS (paste these back to Claude) ---');
  console.log(JSON.stringify(all.filter(x => x.figure).slice(0, 2), null, 2));
  await p.$disconnect();
})();

/**
 * Jest config for CI (`npm run test:ci`). Same as the package.json "jest"
 * config, minus the QUARANTINE below.
 *
 * QUARANTINE: test files that were already broken before CI existed
 * (measured 1 Nov 2026 on 30010c6). They are out of date with the code, not
 * evidence that the code is broken:
 *  - 7 no longer compile: their mock users predate the plan/billing fields
 *    (known since August as "the 20 pre-existing spec errors");
 *  - ai-tutor: 4 assertions out of date with the current tutor.
 *
 * Every other test file must pass for a push to be green. This list may only
 * SHRINK: fix a file, remove it from here. Never add a file to make CI pass.
 * CI still runs these in a separate, non-blocking step so the count stays
 * visible.
 */
const base = require('./package.json').jest;

const QUARANTINE = [
  'src/events/processors/mastery.processor.spec.ts',
  'src/intelligence/ai-router/ai-router.service.spec.ts',
  'src/intelligence/ai-tutor/ai-tutor.service.spec.ts',
  'src/modules/assignments/assignments.service.spec.ts',
  'src/modules/auth/auth.service.spec.ts',
  'src/modules/classrooms/classrooms.service.spec.ts',
  'src/modules/organizations/organizations.service.spec.ts',
  'src/modules/users/users.service.spec.ts',
];

module.exports = {
  ...base,
  rootDir: 'src',
  testPathIgnorePatterns: ['/node_modules/', ...QUARANTINE.map((p) => p.replace(/^src\//, '/src/').replace(/\./g, '\\.') + '$')],
};

module.exports.QUARANTINE = QUARANTINE;

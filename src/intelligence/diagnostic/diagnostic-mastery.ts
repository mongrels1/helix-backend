/**
 * How one diagnostic answer counts toward a skill's mastery score.
 *
 * The diagnostic labels each answer (DiagnosticPage `classify`):
 *   mastered - answered correctly
 *   emerging - MISSED a harder question (one grade above, or the harder half of
 *              the grade)
 *   notyet   - missed an easier at-grade question
 *   stretch  - two or more grades above: not scored
 *
 * "emerging" used to count as 0.6, which the mastery engine treats as a pass
 * (CORRECT_THRESHOLD = 0.6) and the diagnostic as "not a gap". So a strong
 * student who was given harder questions and missed half of them came out with
 * zero weak skills (Cameron Sterling, 11 Nov 2026: 53% correct, 0 weak). A miss
 * is a miss: "emerging" now counts below the pass line, gentler than "not yet".
 */
export function masteryValueForTag(tag: string): number | null {
  const t = tag.toLowerCase().replace(/[^a-z]/g, '');
  if (t.includes('master')) return 1;
  if (t.includes('emerg')) return 0.4;
  if (t.includes('above') || t.includes('stretch') || t.includes('reach')) return null;
  return 0.15; // not yet
}

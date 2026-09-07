/**
 * EdKairos Fellows — the signed diagnostic-result token.
 *
 * WHAT IT ASSERTS
 * The EdKairos diagnostic produces a Rasch theta and a provisional GRADE LEVEL
 * (`provisionalLevel(theta)` in DiagnosticPage.tsx, 3.0-9.0 in half steps). It does NOT
 * produce a percentile — see
 * `EdKairos_Fellows_Gate_Percentile_Does_Not_Exist_2026-09-07`. This token signs the
 * level, so the admissions gate can ask the one question the landing page already
 * promises: **is this child above grade level?**
 *
 * WHY A TOKEN AND NOT A DATABASE LOOKUP
 * The public diagnostic at app.edkairos.com/diagnostic is PRE-LOGIN (Master Handoff v76
 * §4). For most applicants there is no account and no row to look up at the moment they
 * apply. A lookup would verify only the families who least need verifying.
 *
 * HOW IT WORKS
 *   payload = base64url(JSON)          <- anyone can read this, that is fine
 *   sig     = base64url(HMAC-SHA256(payload, secret))
 *   token   = payload + '.' + sig
 *
 * Readable, so the apply page can show the family what it holds. Not forgeable without
 * FELLOWS_PCT_SECRET. Stateless: no DB call on the apply path, works for anonymous
 * diagnostic takers, survives a family taking a week to come back.
 *
 * HONEST FRAMING, because someone will ask
 * `provisionalLevel()` is a pure function of theta with hand-set, not field-calibrated,
 * item parameters. "Above grade level" is therefore provisional too. That is acceptable
 * as evidence for an admissions screen — one of five routes, none load-bearing alone.
 * It is NOT a placement claim about a child, and must never be published as one.
 */

import crypto from 'node:crypto';

export const MAX_AGE_DAYS = 60;   // a diagnostic older than a term is not evidence of today

function b64url(buf: string | Buffer | Uint8Array): string {
  return (typeof buf === 'string' ? Buffer.from(buf, 'utf8') : Buffer.from(buf)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s: string): Buffer {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function secret(): string | null {
  const s = process.env.FELLOWS_PCT_SECRET;
  if (!s || s.length < 32) return null;      // refuse to sign with a weak or absent secret
  return s;
}

function hmac(payloadB64: string, key: string): string {
  return b64url(crypto.createHmac('sha256', key).update(payloadB64).digest());
}

/**
 * Called by the diagnostic completion flow.
 */
export interface EvidenceClaim {
  /** provisionalLevel(theta) from the diagnostic: 3.0 - 9.0, half steps. */
  level: number;
  /** The grade the child was in when they sat it, if known. Context, not the gate. */
  grade?: number;
  theta?: number;
  se?: number;
  child?: string;
  /** Diagnostic session id, so a held application can be traced back to the run. */
  dx?: string;
}
export interface VerifyOpts { childFirstName?: string; maxAgeDays?: number }
export interface VerifyResult {
  verified: boolean;
  /** The signed provisional level, or null when nothing verified. */
  level: number | null;
  reason: string;
  claim: any | null;
  nameMismatch: boolean;
}

export function sign(claim: EvidenceClaim): string | null {
  const key = secret();
  if (!key) return null;
  const level = Number(claim.level);
  if (!Number.isFinite(level) || level < 3 || level > 9) {
    throw new Error('level must be 3..9 (provisionalLevel range)');
  }
  const payload: Record<string, unknown> = {
    // Half steps, matching provisionalLevel()'s own rounding.
    level: Math.round(level * 2) / 2,
    grade: Number.isInteger(Number(claim.grade)) ? Number(claim.grade) : undefined,
    theta: Number.isFinite(Number(claim.theta)) ? Number(Number(claim.theta).toFixed(3)) : undefined,
    se: Number.isFinite(Number(claim.se)) ? Number(Number(claim.se).toFixed(3)) : undefined,
    child: claim.child ? String(claim.child).trim().slice(0, 60) : undefined,
    dx: claim.dx ? String(claim.dx).slice(0, 64) : undefined,
    iat: Math.floor(Date.now() / 1000),
    v: 2,
  };
  const p = b64url(JSON.stringify(payload));
  return p + '.' + hmac(p, key);
}

/**
 */
export function verify(token: unknown, opts: VerifyOpts = {}): VerifyResult {
  const fail = (reason: string, extra: Partial<VerifyResult> = {}): VerifyResult =>
    ({ verified: false, level: null, reason, claim: null, nameMismatch: false, ...extra });

  const key = secret();
  if (!key) return fail('no-secret-configured');
  if (typeof token !== 'string' || !token) return fail('no-token');

  const dot = token.indexOf('.');
  if (dot < 1 || dot === token.length - 1) return fail('malformed');

  const p = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(p, key);

  // Constant-time. Length check first, because timingSafeEqual throws on a length mismatch.
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail('bad-signature');

  let claim: any;
  try { claim = JSON.parse(unb64url(p).toString('utf8')); }
  catch { return fail('bad-payload'); }

  if (claim.v !== 2) return fail('unknown-version');
  const level = Number(claim.level);
  if (!Number.isFinite(level) || level < 3 || level > 9) return fail('bad-level');

  const maxAge = (opts.maxAgeDays || MAX_AGE_DAYS) * 86400;
  const age = Math.floor(Date.now() / 1000) - Number(claim.iat || 0);
  if (!Number.isFinite(age) || age < -300) return fail('issued-in-the-future');
  if (age > maxAge) return fail('expired');

  // Name binding. A token issued for one child should not admit a sibling.
  // A mismatch is FLAGGED, never rejected — families type names differently
  // ("Ada", "ada", "Ada-Rose") and a rejection here would read as a broken form.
  let nameMismatch = false;
  if (claim.child && opts.childFirstName) {
    const norm = (s: unknown) => String(s).toLowerCase().replace(/[^a-z]/g, '');
    nameMismatch = norm(claim.child) !== norm(opts.childFirstName);
  }

  return { verified: true, level, reason: 'ok', claim, nameMismatch };
}

/** Read the level out of a token WITHOUT verifying — display only, never for a decision. */
export function peek(token: unknown): number | null {
  try {
    const p = String(token).split('.')[0];
    const claim: any = JSON.parse(unb64url(p).toString('utf8'));
    const level = Number(claim.level);
    return Number.isFinite(level) && level >= 3 && level <= 9 ? level : null;
  } catch { return null; }
}

/** Build the apply link the diagnostic result page should show. */
export function applyUrl(claim: EvidenceClaim, base = 'https://go.edkairos.com/fellows-apply'): string {
  const t = sign(claim);
  return t ? base + '?d=' + encodeURIComponent(t) : base;
}


// ⚠ NAMED IMPORT, DELIBERATELY. Do not "tidy" this to `import crypto from
// 'node:crypto'`.
//
// This repo's tsconfig sets "module": "commonjs" and does NOT set
// `esModuleInterop`, so a default import of a CommonJS module emits
// `node_crypto_1.default.createHmac(...)` — and `require('node:crypto').default`
// is `undefined`. It compiles clean, because `allowSyntheticDefaultImports`
// silences the type check without changing the emit, and then throws on every
// call at runtime. That exact line in `modules/fellows/evidence-token.ts` broke
// the diagnostic save for three days and cost four sessions to find, because
// the exception filter discarded it.
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A signed, expiring link to one Kairos Point.
 *
 * The parent opens the report in a browser rather than receiving an attachment.
 * That means the link itself is the access control, so it is treated as a
 * credential: signed with a server secret, scoped to a single report id, and
 * given a deliberate lifetime.
 *
 * It carries **no** personal data — an id and an expiry, nothing more. A link
 * that leaks (forwarded mail, a shared inbox, a support ticket) reveals one
 * child's report and nothing about anyone else, and stops working when it
 * expires.
 */

/**
 * 120 days. Long enough that a parent can come back to the page a term later
 * and still open the thing they were sent, short enough that an old forwarded
 * link is not a permanent door.
 */
export const LINK_MAX_AGE_DAYS = 120;

export interface KairosClaim {
  /** KairosPointReport.id */
  r: string;
  /** issued-at, epoch seconds */
  iat: number;
  /** schema version, so a future payload change is detectable rather than silent */
  v: number;
}

export type VerifyFailure =
  | 'missing'
  | 'malformed'
  | 'bad-signature'
  | 'expired'
  | 'unsupported-version';

export type VerifyResult =
  | { ok: true; reportId: string; issuedAt: number }
  | { ok: false; reason: VerifyFailure };

const VERSION = 1;

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function secret(): string | null {
  const key = (process.env.KAIROS_LINK_SECRET ?? '').trim();
  return key.length >= 16 ? key : null;
}

function signature(payloadB64: string, key: string): string {
  return b64url(createHmac('sha256', key).update(payloadB64).digest());
}

/**
 * Sign a link token, or return null when no secret is configured.
 *
 * Null rather than a throw, and the caller must treat null as "cannot send".
 * A link signed with a missing or weak key is worse than no link: it looks like
 * access control and is not one.
 */
export function sign(reportId: string): string | null {
  const key = secret();
  if (!key) return null;
  const claim: KairosClaim = { r: reportId, iat: Math.floor(Date.now() / 1000), v: VERSION };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(claim), 'utf8'));
  return `${payloadB64}.${signature(payloadB64, key)}`;
}

/**
 * Verify a token.
 *
 * The signature is compared with `timingSafeEqual`, and the payload is only
 * parsed **after** the signature checks out — an attacker must never be able to
 * reach the JSON parser with bytes we have not authenticated.
 */
export function verify(token: unknown): VerifyResult {
  if (typeof token !== 'string' || !token) return { ok: false, reason: 'missing' };
  const key = secret();
  if (!key) return { ok: false, reason: 'bad-signature' };

  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'malformed' };
  const payloadB64 = token.slice(0, dot);
  const given = token.slice(dot + 1);

  const expected = signature(payloadB64, key);
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad-signature' };
  }

  let claim: KairosClaim;
  try {
    claim = JSON.parse(fromB64url(payloadB64).toString('utf8')) as KairosClaim;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (claim.v !== VERSION) return { ok: false, reason: 'unsupported-version' };
  if (typeof claim.r !== 'string' || !claim.r) return { ok: false, reason: 'malformed' };
  if (typeof claim.iat !== 'number' || !Number.isFinite(claim.iat)) {
    return { ok: false, reason: 'malformed' };
  }

  const ageDays = (Date.now() / 1000 - claim.iat) / 86_400;
  if (ageDays > LINK_MAX_AGE_DAYS) return { ok: false, reason: 'expired' };

  return { ok: true, reportId: claim.r, issuedAt: claim.iat };
}

/** The URL a parent is sent. */
export function viewUrl(token: string, base = 'https://app.edkairos.com'): string {
  return `${base}/kairos-point?d=${encodeURIComponent(token)}`;
}

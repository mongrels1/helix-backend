/**
 * EdKairos Fellows — application intake.
 *
 *   POST /api/v1/fellows/apply     (application/x-www-form-urlencoded, native form post)
 *
 * House style followed from Master Handoff v76 §4:
 *   · the controller declares its FULL path — there is no global prefix
 *   · @Public() bypasses the global JWT guard
 *   · no throttler package is installed, so real rate limiting belongs at Cloudflare;
 *     the in-process guard below is a floor, not the fence
 *
 * The band the browser computed is recorded as a CLAIM and never acted on. This route
 * recomputes from raw items, verifies the EdKairos route against a signed token, then
 * forwards a clean record into GHL.
 */
import {
  Body, Controller, Header, HttpCode, Ip, Post, Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '@common/decorators/public.decorator';
import { score } from './fellows-scoring';
import { verify as verifyEvidence } from './evidence-token';

// ── The field contract ────────────────────────────────────────────────────────
const RAW_FIELDS = [
  'parent_name', 'parent_email', 'parent_mobile', 'sms_consent', 'sms_consent_at',
  'child_first_name', 'grade', 'ga',
  // Ring 1 eligibility — five routes, "any one of", matching the landing page.
  'elig_ek',
  'elig_gifted', 'elig_gifted_detail',
  'elig_dl', 'elig_dl_year',
  'elig_normed', 'elig_normed_test', 'elig_normed_pct',
  'elig_comp', 'elig_comp_detail',
  'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9',
  'b1', 'b2', 'b3', 'b4', 'b5',
  'c1_school', 'c2_evidence', 'c3_deciders', 'c4_source',
  'ek_spec', 'ek_submitted_at',
] as const;

/** Everything the browser computed. Kept for audit under client_*, never used to decide. */
const CLIENT_COMPUTED = [
  'ek_r2', 'ek_r3', 'ek_gate', 'ek_band', 'ek_flags',
  'ek_b1_words', 'ek_b3_words', 'ek_b4_words',
] as const;

const MAX_TEXT = 4000;
const RATE_MAX = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/*
 * There is no lenient/strict switch any more, and none is needed. The EdKairos route
 * REQUIRES a valid signed token by construction: a family cannot self-assert a diagnostic
 * result, and the other four routes never claimed to be machine-verified. The old
 * `?pct=99` hole closed when the gate stopped asking for a number the URL could supply.
 */

/**
 * Strip C0/C1 control characters but KEEP spaces, tabs and newlines.
 * The child's Ring 3 score is a word count of their own prose: a sanitiser that eats
 * whitespace scores every strong answer as one word, silently and plausibly.
 */
export function clean(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .trim()
    .slice(0, MAX_TEXT);
}

export function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

@Controller('api/v1/fellows')
export class FellowsApplyController {
  private readonly hits = new Map<string, number[]>();

  private rateLimited(ip: string): boolean {
    const now = Date.now();
    const list = (this.hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
    list.push(now);
    this.hits.set(ip, list);
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) {
        if (!v.length || now - v[v.length - 1] > RATE_WINDOW_MS) this.hits.delete(k);
      }
    }
    return list.length > RATE_MAX;
  }

  @Public()
  @Post('apply')
  @HttpCode(200)
  // The student's answers are child-authored free text. Nothing third-party loads here —
  // no analytics, no pixel, no chat widget, no font CDN.
  @Header('Content-Security-Policy',
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'")
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'no-store')
  async apply(@Body() body: Record<string, any>, @Ip() ip: string, @Res() res: Response) {
    if (this.rateLimited(ip)) {
      return res.status(429).type('text/plain').send(
        'Too many applications from this connection. Try again later, or email admin@edkairos.com.');
    }

    body = body || {};

    // A bot fills every field it can see. This one is not shown to humans.
    if (clean(body.website_url)) return this.received(res, '');

    const raw: Record<string, string> = {};
    for (const k of RAW_FIELDS) raw[k] = clean(body[k]);

    if (!EMAIL_RE.test(raw.parent_email)) {
      return res.status(400).type('text/plain').send(
        'That email address does not look right. Go back and check it — the decision goes to that address.');
    }
    if (!raw.parent_name || !raw.child_first_name) {
      return res.status(400).type('text/plain').send(
        'Missing parent or child name. Go back and complete the form.');
    }

    // ── Ring 1 evidence ───────────────────────────────────────────────────────
    // Four of the five routes are parent claims and cannot be verified by anyone. The
    // fifth is the EdKairos diagnostic, and it is verified by signature — see
    // evidence-token.ts for why that is a token and not a database lookup.
    const t = verifyEvidence(clean(body.evidence_token), { childFirstName: raw.child_first_name });

    const s = score(raw, { ek: { verified: t.verified, level: t.level } });
    const flags = [...s.flags];
    if (t.verified && t.nameMismatch) {
      flags.push(`Diagnostic was taken by "${t.claim?.child}", application names "${raw.child_first_name}"`);
    }
    // A sibling's diagnostic must not buy an automatic Admit.
    const band = (t.verified && t.nameMismatch && s.band === 'Admit') ? 'Human review' : s.band;

    const claimed: Record<string, string> = {};
    for (const k of CLIENT_COMPUTED) claimed['client_' + k] = clean(body[k]);
    const tampered = !!claimed.client_ek_band && claimed.client_ek_band !== band;

    const record = {
      ...raw,
      stage: 'applicant',
      ek_r2: s.r2,
      ek_r3: s.r3,
      ek_gate: s.gate ? 'pass' : 'fail',
      ek_band: band,
      ek_flags: flags.join(' | '),
      ek_b1_words: s.w1,
      ek_b3_words: s.w3,
      ek_b4_words: s.w4,
      ek_routes_met: s.routes.join(','),
      ek_routes_claimed: s.routesClaimed.join(','),
      ek_evidence_verified: s.evidenceVerified ? 'yes' : 'no',
      ek_evidence_reason: t.reason,
      ek_ek_level: t.verified && t.level !== null ? String(t.level) : '',
      ek_above_grade_by: s.ekAboveGradeBy !== null ? String(s.ekAboveGradeBy) : '',
      ek_diagnostic_id: t.verified ? (t.claim?.dx ?? '') : '',
      ek_scored_by: 'server',
      ek_scored_at: new Date().toISOString(),
      ek_client_band_mismatch: tampered ? 'yes' : 'no',
      ...claimed,
    };

    if (tampered) {
      // Not necessarily an attack — a stale cached page does this too. Worth seeing.
      console.warn('[fellows/apply] client band %j != server band %j for %s',
        claimed.client_ek_band, band, raw.parent_email);
    }

    const hook = process.env.GHL_APPLY_WEBHOOK_URL;
    if (!hook) {
      console.error('[fellows/apply] GHL_APPLY_WEBHOOK_URL is not set — application NOT delivered',
        JSON.stringify(record));
      return res.status(500).type('text/plain').send(
        'We could not record your application. Nothing was charged. Please email admin@edkairos.com and we will take it by hand today.');
    }

    try {
      const r = await fetch(hook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(record),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error('GHL returned ' + r.status);
    } catch (err: any) {
      // Never lose an application. The log line is the backup copy.
      console.error('[fellows/apply] DELIVERY FAILED', err?.message, JSON.stringify(record));
      return res.status(502).type('text/plain').send(
        "Your answers reached us but our system did not confirm. Nothing was charged. Email admin@edkairos.com and quote your child's first name — we have your application.");
    }

    return this.received(res, raw.child_first_name);
  }

  /**
   * The confirmation the family sees. Rendered here rather than redirected to a GHL step,
   * so the application path does not depend on a fourth funnel page existing.
   * Set APPLY_THANKYOU_URL to override with a real page later.
   *
   * It says only what is true at this moment. It does NOT say "you're in",
   * and it never shows a band.
   */
  private received(res: Response, childName: string) {
    const url = process.env.APPLY_THANKYOU_URL;
    if (url) return res.redirect(303, url);

    const who = childName ? `${esc(childName)}'s application is in.` : 'Your application is in.';
    return res.status(200).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Application received — EdKairos Fellows</title>
<style>
 :root{--green:#1B5E3F;--ink:#16211C;--body:#33413A;--muted:#6B7A72;--bg:#FBFAF6;--line:#D9E3DC}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--body);
      font:400 17px/1.65 "Segoe UI",-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif}
 .wrap{max-width:620px;margin:0 auto;padding:0 22px}
 header{background:var(--green);color:#EAF3ED;padding:56px 0 48px}
 h1{color:#fff;font-size:clamp(26px,5vw,38px);line-height:1.2;margin:0 0 .4em;letter-spacing:-.02em}
 header p{color:#C9DED3;margin:0;font-size:19px}
 main{padding:44px 0 70px}
 ul{padding-left:1.15em;margin:0 0 1.4em}
 li{margin-bottom:.6em}
 .quiet{background:#fff;border:1px solid var(--line);border-left:5px solid var(--muted);
        border-radius:0 10px 10px 0;padding:20px 24px;margin:28px 0}
 footer{border-top:1px solid var(--line);padding:24px 0 60px;font-size:14px;color:var(--muted)}
 a{color:var(--green)}
</style></head>
<body>
<header><div class="wrap">
  <h1>${who}</h1>
  <p>Nothing has been charged, and there is nothing to schedule.</p>
</div></header>
<main class="wrap">
  <ul>
    <li><strong>An acknowledgement is on its way to your inbox now.</strong></li>
    <li><strong>A decision follows within 24 hours</strong>, by email — and by text if you gave a number and ticked the box.</li>
    <li>Applications are read in the order they arrive.</li>
  </ul>
  <div class="quiet">
    <p style="margin:0"><strong>If you would rather talk it through, reply CALL to the acknowledgement email</strong> and we will send times. A call is offered, never required, and never a condition of enrolling.</p>
  </div>
  <p>You can close this page. If nothing reaches you within 24 hours, email
     <a href="mailto:admin@edkairos.com">admin@edkairos.com</a> and quote your child's first name.</p>
</main>
<footer class="wrap">
  <p>EdKairos, Inc · We prepare the case. The school decides. We do not promise a placement, a score, a percentile, or an admission to any programme.</p>
</footer>
</body></html>`);
  }
}

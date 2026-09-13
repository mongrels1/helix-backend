/**
 * The cover letter that carries a Kairos Point to a family.
 *
 * Ported from the reviewed asset at
 * `claude/GHL/EK_kairos_point_delivery_paste_2026-09-13.html`, with one
 * deliberate change: the attachment language is replaced by a link, because the
 * report is served from the app rather than attached. Everything else is the
 * copy that was already checked against Rule 9.
 *
 * ⚠ **Claims that must not be reintroduced when this is edited:**
 * - **No percentile asserted by EdKairos.** The report page may print "top 10%
 *   nationally" because it quotes the percentile printed on the family's *own*
 *   vendor report. EdKairos asserting one in an outbound email is a different
 *   claim, and there is no norm study behind it.
 * - No alignment or concordance claim against MAP, i-Ready or Star — design
 *   intent, not demonstrated fact.
 * - It does **not** say the study pathway has been updated automatically from
 *   the map. That is not built. It says the work has to get done, which is true.
 * - The weekly progress email **is** built (Sunday cron, emails linked parents),
 *   so promising it is safe.
 * - Georgia postal address, never the Delaware registered agent. Lowercase k in
 *   admin@edkairos.com.
 */

const LOGO = 'https://app.edkairos.com/edkairos-logo.png';
const DIAGNOSTIC = 'https://app.edkairos.com/diagnostic';
const ADDRESS = '8170 Mall Parkway #1210, Lithonia, GA 30038';
const TAGLINE = 'Diagnose the gap. Close the gap. Prove the gain.';

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

export function coverLetterSubject(firstName: string): string {
  return `${firstName}'s Kairos Point — one page`;
}

export function coverLetterText(firstName: string, url: string): string {
  const n = firstName;
  return `Hello,

Here is ${n}'s Kairos Point, built from the report you sent. It is one page, and it is worth the two minutes.

Open it here: ${url}

HOW TO READ IT

1. The chart is the whole idea. Every area is plotted against ${n}'s own overall score, in the centre. To the right, ahead of their own average. To the left, behind it.

2. Push means ready for harder work now. Strengthen means we shore it up first. Grade-level work continues either way - nothing is removed.

3. The shaded band is the test's own margin of error. Anything inside it is too small to act on, so we hold it at grade rather than guess.

The standards at the bottom are what we teach next, from the Georgia K-12 Mathematics Standards.

THIS WEEK

1. Set the study schedule. Have ${n} open Study Plan and put three sessions in the calendar. A plan nobody has scheduled is a plan that does not happen.

2. Clear every assignment. Both kinds: the Practice work in their dashboard, and anything their instructor has set under Assignments. The plan on this page only moves if the work gets done.

3. Use the AI Tutor when they are stuck. It walks them through the problem in front of them and responds as they work - so a hard night does not turn into a week of avoiding the topic.

4. Take the diagnostic, if you have not yet. About 15 questions. The score report tells us where they stand; the diagnostic tells us which specific skills to start with. ${DIAGNOSTIC}

You will get a short progress email every week, so you can watch these areas move rather than wait for the next school report.

If a number on the page looks wrong, tell us. We read the scores off the report you sent, and we would rather correct one than build on it.

John Edwards
EdKairos

EdKairos - ${TAGLINE}
${ADDRESS}
`;
}

export function coverLetterHtml(firstName: string, url: string): string {
  const n = esc(firstName);
  const u = esc(url);
  const step = (num: string, head: string, body: string) => `
        <div style="margin-top:16px;font:700 15px/1.4 Helvetica,Arial,sans-serif;color:#16241e;">
          ${num} &nbsp;${head}
        </div>
        <div style="margin-top:3px;font:400 14px/1.55 Helvetica,Arial,sans-serif;color:#5c7a6d;">
          ${body}
        </div>`;
  const read = (num: string, body: string) => `
      <tr><td valign="top" style="padding:4px 10px 4px 0;font:700 16px/1.6 Helvetica,Arial,sans-serif;color:#0e9c67;">${num}</td>
          <td style="padding:4px 0;font:400 15px/1.55 Helvetica,Arial,sans-serif;color:#2c433b;">${body}</td></tr>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${n}&rsquo;s Kairos Point</title></head>
<body style="margin:0;padding:0;background:#f4f8f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">One page. Where to push, what to shore up, and what we teach next.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f8f6;">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
       style="width:600px;max-width:600px;background:#ffffff;border-radius:10px;">

  <tr><td style="padding:28px 36px 0;">
    <img src="${LOGO}" alt="EdKairos" width="44" style="display:block;width:44px;height:auto;border:0;">
  </td></tr>

  <tr><td style="padding:18px 36px 0;">
    <div style="font:700 11px/1 Helvetica,Arial,sans-serif;letter-spacing:2px;text-transform:uppercase;color:#0b7a50;">Ready</div>
    <h1 style="margin:8px 0 0;font:700 29px/1.15 Georgia,'Times New Roman',serif;color:#16241e;letter-spacing:-0.4px;">
      ${n}&rsquo;s Kairos Point</h1>
    <div style="margin-top:6px;font:400 15px/1.5 Helvetica,Arial,sans-serif;color:#5c7a6d;">One page. The data that matters.</div>
  </td></tr>

  <tr><td style="padding:20px 36px 0;"><hr style="border:0;border-top:2px solid #0e9c67;margin:0;"></td></tr>

  <tr><td style="padding:22px 36px 0;font:400 16px/1.6 Helvetica,Arial,sans-serif;color:#2c433b;">
    <p style="margin:0 0 14px;">Hello,</p>
    <p style="margin:0 0 18px;">Here is ${n}&rsquo;s Kairos Point, built from the report you sent.
      It is one page, and it is worth the two minutes.</p>
  </td></tr>

  <tr><td style="padding:0 36px 4px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td bgcolor="#0e9c67" style="border-radius:7px;">
        <a href="${u}" style="display:inline-block;padding:14px 26px;font:700 15px/1 Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:7px;">
          Open ${n}&rsquo;s Kairos Point &rarr;</a>
      </td></tr></table>
    <div style="margin-top:9px;font:400 13px/1.5 Helvetica,Arial,sans-serif;color:#5c7a6d;">
      Opens in your browser. There is a button on the page to save or print it.</div>
  </td></tr>

  <tr><td style="padding:22px 36px 0;font:400 16px/1.6 Helvetica,Arial,sans-serif;color:#2c433b;">
    <p style="margin:0 0 8px;"><strong>How to read it</strong></p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">
      ${read('1', `<strong>The chart is the whole idea.</strong> Every area is plotted against ${n}&rsquo;s own overall score, in the centre. To the right, ahead of their own average. To the left, behind it.`)}
      ${read('2', `<strong>Push means ready for harder work now.</strong> Strengthen means we shore it up first. Grade-level work continues either way &mdash; nothing is removed.`)}
      ${read('3', `<strong>The shaded band is the test&rsquo;s own margin of error.</strong> Anything inside it is too small to act on, so we hold it at grade rather than guess.`)}
    </table>
    <p style="margin:0 0 18px;">The standards at the bottom are what we teach next, from the Georgia
      K&ndash;12 Mathematics Standards.</p>
  </td></tr>

  <tr><td style="padding:4px 36px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#f4f8f6;border:1px solid #d3e3da;border-radius:8px;">
      <tr><td style="padding:18px 20px;">
        <div style="font:700 11px/1 Helvetica,Arial,sans-serif;letter-spacing:1.6px;text-transform:uppercase;color:#0b7a50;">This week</div>
        ${step('1', 'Set the study schedule', `Have ${n} open <strong>Study Plan</strong> and put three sessions in the calendar. A plan nobody has scheduled is a plan that does not happen.`)}
        ${step('2', 'Clear every assignment', `Both kinds: the <strong>Practice</strong> work in their dashboard, and anything their instructor has set under <strong>Assignments</strong>. The plan on this page only moves if the work gets done.`)}
        ${step('3', 'Use the AI Tutor when they are stuck', `It walks them through the problem in front of them and responds as they work &mdash; so a hard night does not turn into a week of avoiding the topic.`)}
        ${step('4', 'Take the diagnostic, if you have not yet', `About 15 questions. The score report tells us where they stand; the diagnostic tells us which specific skills to start with. <a href="${DIAGNOSTIC}" style="color:#0b7a50;font-weight:700;text-decoration:underline;">Start the diagnostic</a>`)}
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:22px 36px 0;font:400 16px/1.6 Helvetica,Arial,sans-serif;color:#2c433b;">
    <p style="margin:0 0 14px;">You will get a short progress email every week, so you can watch these
      areas move rather than wait for the next school report.</p>
    <p style="margin:0 0 14px;"><strong>If a number on the page looks wrong, tell us.</strong> We read
      the scores off the report you sent, and we would rather correct one than build on it.</p>
    <p style="margin:14px 0 0;">John Edwards<br>
      <span style="color:#5c7a6d;font-size:14px;">EdKairos</span></p>
  </td></tr>

  <tr><td style="padding:26px 36px 30px;">
    <hr style="border:0;border-top:1px solid #e9f0ec;margin:0 0 14px;">
    <div style="font:700 12px/1.5 Helvetica,Arial,sans-serif;color:#0b7a50;">EdKairos &middot; ${TAGLINE}</div>
    <div style="margin-top:8px;font:400 11px/1.6 Helvetica,Arial,sans-serif;color:#7e9a8d;">${ADDRESS}</div>
  </td></tr>

</table></td></tr></table></body></html>`;
}

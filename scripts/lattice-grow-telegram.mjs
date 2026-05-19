#!/usr/bin/env node
/**
 * lattice-grow-telegram.mjs — format `lattice grow check --json` envelope
 * for Telegram and POST to the bot API.
 *
 * Reads JSON from stdin. Required env:
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 *
 * Optional env:
 *   REPO_NAME           — included in the message header (default: cwd basename)
 *   LATTICE_TELEGRAM_DISABLE=1   — instant no-op
 *
 * Exit codes:
 *   0  posted (or no hypotheses to report)
 *   1  config error (missing secrets, malformed JSON)
 *   2  Telegram API rejected the post
 */

import { readFileSync } from 'fs';

if (process.env.LATTICE_TELEGRAM_DISABLE === '1') process.exit(0);

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT  = process.env.TELEGRAM_CHAT_ID;
const REPO  = process.env.REPO_NAME || (process.cwd().split(/[\\/]/).pop() || 'project');

if (!TOKEN || !CHAT) {
  console.error('[lattice-grow-telegram] TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID required');
  process.exit(1);
}

// Read stdin
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => main(raw).catch((e) => {
  console.error('[lattice-grow-telegram] fatal:', e.message);
  process.exit(2);
}));

const ICON = {
  succeeded: '🟢',
  failed: '🔴',
  'still-running': '🟡',
  inconclusive: '⚪',
  'fetch-failed': '⚠️',
  'insufficient-data': '⚪',
  skipped: '⚪',
};

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtHyp(h) {
  const icon = ICON[h.verdict] || '·';
  const lines = [];
  const elapsed = h.elapsed_days != null && h.window_days != null
    ? `Day ${h.elapsed_days}/${h.window_days}`
    : '';
  lines.push(`${icon} <b>${esc(h.slug)}</b>${elapsed ? ' — ' + esc(elapsed) : ''} → verdict: <b>${esc(h.verdict)}</b>`);
  if (h.title) lines.push(`    ${esc(h.title)}`);
  if (h.current_value != null && h.success_threshold != null) {
    lines.push(`    current <code>${esc(h.current_value)}</code> vs threshold <code>${esc(h.success_threshold)}</code>`);
  }
  // Action hint
  let cmd = '';
  switch (h.verdict) {
    case 'succeeded':
      cmd = `lattice grow close ${h.slug} --result won --observed-value ${h.current_value}`; break;
    case 'failed':
      cmd = `lattice grow auto-rollback ${h.slug} --execute  # or close --result lost`; break;
    case 'inconclusive':
      cmd = `lattice grow close ${h.slug} --result inconclusive --observed-value ${h.current_value}`; break;
    case 'still-running':
      cmd = ''; break;
  }
  if (cmd) lines.push(`    <code>${esc(cmd)}</code>`);
  return lines.join('\n');
}

async function postTelegram(text) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram ${res.status}: ${body}`);
  }
}

async function main(raw) {
  let env;
  try { env = JSON.parse(raw || '{}'); }
  catch (e) { console.error('[lattice-grow-telegram] JSON parse:', e.message); process.exit(1); }

  const s = env.summary || {};
  const hyps = env.hypotheses || [];

  if (!hyps.length) {
    console.log('[lattice-grow-telegram] no hypotheses — skipping post');
    process.exit(0);
  }

  const header = `📊 <b>Lattice grow check</b> — ${esc(REPO)}`;
  const summary = `${s.measured} measured · ${s.won}🟢 · ${s.lost}🔴 · ${s.waiting}🟡` +
    (s.failed_fetch ? ` · ${s.failed_fetch}⚠️` : '');
  const body = hyps.map(fmtHyp).join('\n\n');
  const text = `${header}\n<i>${summary}</i>\n\n${body}`;

  await postTelegram(text);
  console.log('[lattice-grow-telegram] posted (' + hyps.length + ' hypotheses)');
}

#!/usr/bin/env node
// test/ctrlchar-scan.test.mjs — detector test for core/control-char-in-output (#196).
//
// Background: a CSS escape written inside a JS template literal —
//     const STYLES = `.mk-q::before { content:'\2013\0a0' }`;
// intended an en-dash plus a non-breaking space. JS decodes FIRST, so `\201`
// is an octal escape and `\0` is NUL: four control characters shipped to every
// customer next to the words "What is this?" on a medical results page. No
// exception, no log, no failing test. Lattice's own worker carried the same
// family of defect (#199) — a sanitiser regex whose range bounds were literal
// 0x00 and 0x1F bytes, which made that file report as BINARY to git and grep.
//
// The rule is lexical, not textual: "inside a template literal" cannot be
// decided by matching lines, so the scanner lexes each file and attributes
// every control character and every escape to the construct that really
// contains it. What is tested:
//
//   1. bad/    — the #199 literal control bytes, the #196 truncated CSS
//                escapes, and a stray backtick all flag.
//   2. tier follows REACHABILITY, not the filename: the same defect is HIGH
//      when the value reaches a response body and MEDIUM when it does not.
//   3. the snippet is pipe-safe and renders control bytes as \xNN — emitting
//      the raw byte would corrupt the `file|line|tier|key|snippet` contract.
//   4. the diagnosis for a stray backtick points at the BACKTICK, not at the
//      line the compiler blames.
//   5. good/   — the correct doubling, escapes spelled as \xNN, String.raw,
//                the deliberate lone-NUL separator idiom and JSX are silent.
//   6. the lexer is what decides, proved by moving the same bytes between
//      constructs and between template text and `${}` substitution.
//   7. directory-walk, single-file and LATTICE_SCAN_FILES modes agree.
//
// Run directly:  node test/ctrlchar-scan.test.mjs
// CI runs it:    via scripts/validate.sh

import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SCANNER = path.join(ROOT, "scripts", "lattice-ctrlchar-scan.mjs");
const FIX = path.join(HERE, "fixtures", "control-char-in-output");
const BAD = path.join(FIX, "bad");
const GOOD = path.join(FIX, "good");
const RESULTS = path.join(BAD, "results-page.ts");
const TELEMETRY = path.join(BAD, "telemetry-sanitize.js");

// One backslash, spelled so no layer of quoting can halve it.
const BS = String.fromCharCode(92);
const NUL = String.fromCharCode(0);
const US = String.fromCharCode(31);

let failed = 0;
const ok = (m) => console.log(`  ok: ${m}`);
const bad = (m) => { console.error(`  FAIL: ${m}`); failed = 1; };

// Run the scanner over one target; return the raw `file|line|tier|key|snippet`
// rows.
function run(target, env = {}) {
  const res = execFileSync(process.execPath, [SCANNER, target], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return res.split("\n").filter(Boolean);
}
// `basename:line|tier|key` for every hit — the identity of a finding, snippet
// aside. The basename keeps the expectations readable and path-separator safe.
const shape = (rows) => rows.map((l) => {
  const [file, line, tier, key] = l.split("|");
  return `${path.basename(file)}:${line}|${tier}|${key}`;
});

function expectHits(target, expected, label, env) {
  let got;
  try { got = shape(run(target, env)); } catch (e) { return bad(`${label}: scanner failed: ${e.message}`); }
  const g = got.join("\n"), e = expected.join("\n");
  if (g === e) ok(`${label} (${got.length} hit(s))`);
  else bad(`${label}\n    expected:\n      ${expected.join("\n      ") || "(none)"}\n    got:\n      ${got.join("\n      ") || "(none)"}`);
}

// A throwaway tree, so a case can be written as source rather than described.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-ctrlchar-"));
function scanSource(name, source) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, source);
  return run(p);
}

// --- 1. The incidents, in each of the shapes they were written in ----------
console.log("[test] #196 control characters in server-rendered output");
const BAD_HITS = [
  "bullet-style.ts:8|MEDIUM|nul-escape",       // same defect, off the render path
  "bullet-style.ts:8|MEDIUM|octal-escape",
  "results-page.ts:6|HIGH|nul-escape",         // the #196 incident
  "results-page.ts:6|HIGH|octal-escape",
  "stray-backtick.ts:5|MEDIUM|stray-backtick", // the bonus rule
  "telemetry-sanitize.js:8|MEDIUM|ctrl-U+0000", // the #199 defect, verbatim
  "telemetry-sanitize.js:8|MEDIUM|ctrl-U+001F",
];
expectHits(BAD, BAD_HITS, "the defective fixtures all flag");

// --- 2. The #199 dogfood case, byte for byte -------------------------------
// The worker line that shipped a literal NUL and a literal 0x1F inside a regex
// character class. The rule has to catch this one or it has caught nothing.
{
  const rows = scanSource(
    "worker.js",
    "function sanitize(text) {\n" +
    "  return text.replace(/[" + NUL + "-" + US + "]+/g, \" \");\n" +
    "}\n"
  );
  const got = rows.map((r) => r.split("|").slice(1, 4).join("|"));
  if (got.join(",") === "2|MEDIUM|ctrl-U+0000,2|MEDIUM|ctrl-U+001F") {
    ok("literal 0x00 and 0x1F inside a regex class both flag, on the right line");
  } else {
    bad(`the #199 line was not detected as expected\n    got: ${got.join(", ") || "(none)"}`);
  }
}

// --- 3. Tier is reachability, not a filename ------------------------------
// bad/results-page.ts and bad/bullet-style.ts carry the SAME truncated escape.
// One is interpolated into a template that is handed to `new Response`; the
// other is written to a file. Nothing about the two paths differs in spelling,
// so a filename heuristic cannot separate them — only following the value can.
{
  const rendered = shape(run(RESULTS)).every((h) => h.includes("|HIGH|"));
  const offPath = shape(run(path.join(BAD, "bullet-style.ts"))).every((h) => h.includes("|MEDIUM|"));
  if (rendered && offPath) ok("same defect: HIGH when it reaches a response body, MEDIUM when it does not");
  else bad(`tier did not follow reachability (render=${rendered}, off-path=${offPath})`);

  // Two hops: STYLES -> HTML -> new Response(HTML). Cutting the last hop has to
  // drop the tier, which proves the taint pass is what decided it.
  const src = fs.readFileSync(RESULTS, "utf8");
  const cut = src.replace("return new Response(HTML, ", "return String(HTML + ");
  const tiers = new Set(scanSource("cut.ts", cut).map((r) => r.split("|")[2]));
  if (tiers.size === 1 && tiers.has("MEDIUM")) ok("removing the sink drops the same hits to MEDIUM");
  else bad(`removing the sink left tiers ${[...tiers].join(",")}`);
}

// --- 4. The snippet has to survive the pipe --------------------------------
// The contract is `file|line|tier|key|snippet` read by `IFS='|' read -r`. A raw
// NUL or 0x1F in the snippet would corrupt it — the very bytes this rule finds.
{
  const rows = run(TELEMETRY);
  const snippets = rows.map((r) => r.split("|").slice(4).join("|"));
  const ctrl = (s) => [...s].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);
  const clean = rows.every((r) => !ctrl(r));
  if (clean) ok("no control byte survives into the output row");
  else bad("a raw control byte was emitted into the output row");
  if (snippets.every((s) => s.includes(BS + "x00") || s.includes(BS + "x1F"))) {
    ok("control bytes are rendered as \\xNN so the finding is readable");
  } else {
    bad(`snippet does not render the byte visibly\n    got: ${snippets.join(" / ")}`);
  }
  // The row must survive one field split per pipe — no extra pipes injected.
  if (rows.every((r) => r.split("|").length === 5)) ok("row splits into exactly five fields");
  else bad("snippet leaked a pipe into the row");
}

// --- 5. The diagnosis is the product, for the stray backtick ---------------
// tsc reports this one hundreds of lines below the cause. A finding that
// repeats the compiler's location adds nothing; naming the backtick is the
// whole value.
{
  const row = run(path.join(BAD, "stray-backtick.ts"))[0].split("|");
  if (row[1] === "5") ok("the finding points at the stray backtick (line 5), not the compiler's line");
  else bad(`the finding points at line ${row[1]}, not the stray backtick on line 5`);
  if (/reports it at line 9/.test(row[4])) ok("the snippet names where the compiler will blame instead");
  else bad(`the snippet does not name the compiler's line\n    got: ${row[4]}`);
}

// --- 6. Only a LEXER can decide these -------------------------------------
// Each pair below is the same bytes in a different construct. A line-matching
// detector cannot tell them apart; the verdicts have to differ.
{
  // (a) escaped vs literal: `\x00` written as an escape is correct and silent,
  //     the same character as a byte is the defect.
  const escaped = scanSource("a1.js", "const RE = /[" + BS + "x00-" + BS + "x1f]/g;\n");
  const literal = scanSource("a2.js", "const RE = /[" + NUL + "-" + US + "]/g;\n");
  if (escaped.length === 0 && literal.length === 2) ok("escaped \\x00 is silent; the literal byte flags");
  else bad(`escaped/literal not separated (${escaped.length} vs ${literal.length})`);

  // (b) template TEXT vs `${}` substitution: the same `\0a0` is an escape in
  //     one and a division-free chunk of code in the other.
  const inText = scanSource("b1.js", "const s = `x" + BS + "0a0y`;\n");
  const inSub = scanSource("b2.js", "const s = `x${ a" + BS + "0a0 }y`;\n");
  if (inText.length === 1 && inSub.length === 0) ok("the escape counts in template text, not inside ${}");
  else bad(`template text/substitution not separated (${inText.length} vs ${inSub.length})`);

  // (c) the fix itself: doubling the backslash must silence it, and the lexer
  //     consuming `\\` as a pair is what makes that true.
  const single = scanSource("c1.js", "const s = `" + BS + "2013" + BS + "0a0`;\n");
  const doubled = scanSource("c2.js", "const s = `" + BS + BS + "2013" + BS + BS + "0a0`;\n");
  if (single.length === 2 && doubled.length === 0) ok("doubling the backslash is what clears the finding");
  else bad(`doubling did not clear the finding (${single.length} vs ${doubled.length})`);

  // (d) a control character in a COMMENT is invisible and binary-making, but it
  //     is not output — LOW, not MEDIUM.
  const inComment = scanSource("d1.js", "// a stray byte " + US + " here\nexport const x = 1;\n");
  if (inComment.length === 1 && inComment[0].split("|")[2] === "LOW") ok("a control byte in a comment is LOW, not output");
  else bad(`comment attribution wrong: ${inComment.join(" / ") || "(none)"}`);

  // (e) a lone `\0` is the deliberate NUL-separator idiom — nothing hex behind
  //     it, so there is no truncated escape to report. `\0a0` is the defect.
  const lone = scanSource("e1.js", "const SEP = `${a}" + BS + "0${b}`;\n");
  const truncated = scanSource("e2.js", "const SEP = `${a}" + BS + "0a0${b}`;\n");
  if (lone.length === 0 && truncated.length === 1) ok("a lone \\0 is spared; \\0a0 flags");
  else bad(`lone-NUL carve-out wrong (${lone.length} vs ${truncated.length})`);

  // (f) String.raw is exempt by TAG. The same bytes under any other tag are not
  //     — a css`` tag is exactly the render path this rule is about.
  const raw = scanSource("f1.js", "const p = String.raw`C:" + BS + "0a0`;\n");
  const tagged = scanSource("f2.js", "const p = css`content:'" + BS + "0a0'`;\n");
  if (raw.length === 0 && tagged.length === 1) ok("String.raw is exempt by tag; another tag is not");
  else bad(`tag handling wrong (${raw.length} vs ${tagged.length})`);
}

// --- 7. The clean fixtures stay silent ------------------------------------
expectHits(GOOD, [], "the clean fixtures are silent");

// --- 8. Scan modes agree ---------------------------------------------------
expectHits(RESULTS, [
  "results-page.ts:6|HIGH|nul-escape",
  "results-page.ts:6|HIGH|octal-escape",
], "single-file mode reports that file's hits");

// LATTICE_SCAN_FILES is the diff-scoped corpus the pre-commit hook supplies:
// only the listed files are scanned, walk or no walk.
expectHits(FIX, [
  "results-page.ts:6|HIGH|nul-escape",
  "results-page.ts:6|HIGH|octal-escape",
  "telemetry-sanitize.js:8|MEDIUM|ctrl-U+0000",
  "telemetry-sanitize.js:8|MEDIUM|ctrl-U+001F",
], "LATTICE_SCAN_FILES scopes the scan to the listed files", {
  LATTICE_SCAN_FILES: `${RESULTS}\n${TELEMETRY}\n`,
});

// The whole fixture tree walks bad/ and good/ together and still reports
// exactly bad/'s hits.
expectHits(FIX, BAD_HITS, "directory walk over both trees agrees with bad/ alone");

fs.rmSync(TMP, { recursive: true, force: true });
process.exit(failed);

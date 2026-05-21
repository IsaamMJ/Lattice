#!/usr/bin/env node
/**
 * lattice-yaml.mjs — bulk YAML field reader (v2.2.5, #98)
 *
 * Replaces the per-call `yaml_field` shell pipeline (grep | sed) that forked
 * 2-3 procs per field. cmd_list etc. call yaml_field ~10x per finding, so a
 * 100-finding project = ~1000 forks per `lattice list`. On Windows + Git
 * Bash where fork ≈ 50ms, that's a ~50s freeze.
 *
 * This helper reads ALL requested fields from N files in a single Node
 * invocation. The bash wrapper (yaml_field) detects whether to use the
 * Node fast-path or fall back to the legacy grep|sed pipeline.
 *
 * Modes:
 *   single:   lattice-yaml.mjs <file> <key>           → prints the value (newline-terminated)
 *   bulk:     lattice-yaml.mjs --bulk <key1,key2,...> <file1> <file2> ...
 *             → prints `file<TAB>key=value<NUL>` records, one per key.
 *
 * Output discipline:
 *   - Quote-pair stripping only when matched ("..." or '...')
 *   - \r stripped (CRLF safety)
 *   - empty value for absent key
 *   - keys must match ^[A-Za-z_][A-Za-z0-9_]*$ or we refuse (sanitization)
 *
 * Hard timeout: 5s wall clock. Always exits 0 on timeout with whatever was
 * computed — never hangs a calling shell.
 */

import { readFileSync, statSync } from 'node:fs';

const HARD = setTimeout(() => process.exit(0), 5000);
HARD.unref();

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: lattice-yaml.mjs <file> <key>');
  console.error('       lattice-yaml.mjs --bulk <key1,key2,...> <file1> [file2 ...]');
  process.exit(2);
}

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function stripValue(line, key) {
  // line is one full line of the YAML, including key
  // Trim trailing \r (CRLF), then strip the leading `key:` and whitespace
  let v = line.replace(/\r$/, '');
  // Match `key:` exactly at line start, then optional whitespace
  const re = new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*');
  v = v.replace(re, '');
  // Strip matched-pair quotes
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1);
  else if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) v = v.slice(1, -1);
  return v;
}

function readField(text, key) {
  // First occurrence of `^key:` (at column 0 — block scalar items / nested fields
  // start with whitespace and are ignored)
  const lines = text.split(/\n/);
  const prefix = key + ':';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith(prefix) || l.startsWith(prefix + ' ') || l.startsWith(prefix + '\t')) {
      return stripValue(l, key);
    }
    // Tolerate the rare `key :` with whitespace before colon, matching the
    // legacy grep -E '^key[[:space:]]*:'
    const m = l.match(new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:'));
    if (m) {
      return stripValue(l, key);
    }
  }
  return '';
}

function safeKey(k) {
  if (!KEY_RE.test(k)) {
    process.stderr.write(`[lattice-yaml] refusing invalid key: ${k}\n`);
    return false;
  }
  return true;
}

if (args[0] === '--bulk') {
  // --bulk <keys-csv> <file>+
  if (args.length < 3) {
    console.error('--bulk requires: <keys-csv> <file> [file ...]');
    process.exit(2);
  }
  const keys = args[1].split(',').filter(Boolean);
  for (const k of keys) if (!safeKey(k)) process.exit(2);
  const files = args.slice(2);
  for (const f of files) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const k of keys) {
      const v = readField(text, k);
      // file<TAB>key=value<NUL>
      process.stdout.write(`${f}\t${k}=${v}\0`);
    }
  }
} else {
  // single: <file> <key>
  if (args.length < 2) { console.error('usage: <file> <key>'); process.exit(2); }
  const [file, key] = args;
  if (!safeKey(key)) process.exit(2);
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { process.exit(0); }
  process.stdout.write(readField(text, key));
}

clearTimeout(HARD);
process.exit(0);

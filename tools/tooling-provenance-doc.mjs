#!/usr/bin/env node
// (note removed for export)
// Generates public-safe TOOLING-PROVENANCE.md from the two provenance ledgers
// (MUSE-TOOLING-PROVENANCE-01.json + the house META-AI-TOOLING-PROVENANCE-LEDGER).
// Fail-closed: refuses when inputs carry a home path, or the output trips any
// enforced scan class (home path, sealed name, internal vocabulary, key-shaped
// 24+) or the house secret detector. Deterministic: same inputs, same bytes.
// CLI: node tools/tooling-provenance-doc.mjs [--muse json] [--house json]
//   [--scan scan02.json] [--out md]
// Exit 0 wrote, 2 usage/refusal.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// (note removed for export)
// for these exact strings). P1 action row pins live inference; the D-E row
// leaves the key-cutoff fallback to the Oct 29 eligibility ruling.
export const LIVE_MODEL = 'muse-spark-1.3';
export const LIVE_MODEL_CITE = 'meta-hackathon-product-v1.md P1 action row';
export const FALLBACK_CANDIDATES = ['Muse Glimmer', 'Muse Spark Open'];
export const FALLBACK_CITE = 'meta-hackathon-product-v1.md P1 D-E row';
export const FALLBACK_RULING = 'HO eligibility ruling Thu Oct 29 12:00 PDT';

function at(argv, flag) { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; }
function shaFile(p) { return createHash('sha256').update(readFileSync(p)).digest('hex'); }

// Absolute home roots, built from parts so this source carries no contiguous
// absolute-path literal (rev-2 lesson). Matches the scan01 absolute-path rule
// shape (/Users/<name>/ or /home/<name>/) without quoting it whole.
const SEP = '/';
const USERS_ROOT = SEP + 'Users' + SEP;
const HOME_ROOT = SEP + 'home' + SEP;

function parseReceiptRegex(literal) {
  const m = /^\/([\s\S]*)\/([a-z]*)$/.exec(literal);
  if (!m) throw new Error('bad receipt regex: ' + literal.slice(0, 60));
  return new RegExp(m[1], m[2]);
}

export function loadClassRules(scan) {
  const rules = { home: [], sealed: [], vocab: [] };
  for (const r of scan.method.deltaRules) {
    const re = parseReceiptRegex(r.regex);
    if (r.class === 'delta: home path') rules.home.push(re);
    else if (r.class === 'delta: sealed name') rules.sealed.push(re);
    else if (r.class === 'delta: internal vocabulary') rules.vocab.push(re);
  }
  return rules;
}

function matchAny(res, text) {
  for (const re of res) {
    re.lastIndex = 0;
    if (re.test(text)) return true;
  }
  return false;
}

export function hasHomePath(text, rules) {
  return text.includes(USERS_ROOT) || text.includes(HOME_ROOT) || matchAny(rules.home, text);
}

// Scan-02 keyShapedRule: a segment (split on - and _) of 20+ chars with upper,
// lower and digit that is not camelCase word chunks.
export function findKeyShaped(text) {
  const found = [];
  for (const tok of text.split(/[^A-Za-z0-9_-]+/)) {
    for (const seg of tok.split(/[-_]/)) {
      if (seg.length >= 20 && /[A-Z]/.test(seg) && /[a-z]/.test(seg) && /[0-9]/.test(seg) && !/[a-z][A-Z]/.test(seg)) {
        found.push(seg.slice(0, 24));
      }
    }
  }
  return found;
}

// Public-safe emission: sealed handles and absolute paths never leave the
// generator. Deterministic; the output scan below verifies the result.
export function sanitize(text) {
  return String(text)
    .replace(/@[A-Za-z0-9_-]+/g, '[handle]')
    .replace(/\/(?:Users|home)\/[^\s]*/g, '[abs path]')
    .replace(/~\/[^\s]*/g, '[abs path]');
}

export function relReceiptsPath(p) {
  const s = String(p);
  const i = s.indexOf('house-only/receipts');
  if (i >= 0) return s.slice(i + 'house-only/receipts'.length);
  if (s.startsWith('/')) return basename(s);
  return s;
}

function humanizeWo(wo) {
  return String(wo).replace(/^muse-/, '').replace(/-01$/, '').replace(/-/g, ' ');
}

function verifierText(row) {
  if (row.verifier && row.verifier.sha256) {
    const open = /finding|diverge/i.test(row.verifier.verdict || '') ? ', finding open' : '';
    return `independent verification (receipt sha ${String(row.verifier.sha256).slice(0, 12)}${open})`;
  }
  if (row.plateId === 'M-NEXT-13') return `independent review lane (HO post ${row.ho.postUtc})`;
  if (row.plateId === 'M-NEXT-24') return 'independent verification running (no receipt yet)';
  return 'HO direct (no independent receipt)';
}

function museRow(r) {
  const files = r.files.map((f) => {
    const rel = relReceiptsPath(f.path);
    if (f.state === 'superseded') {
      return `${rel} (superseded by ${f.supersededBy}; rev sha ${f.sha256})`;
    }
    return `${rel} (sha ${f.sha256})`;
  });
  const wo = r.files.map((f) => f.wo).filter(Boolean);
  return {
    plate: r.plateId,
    built: `${humanizeWo(r.wo)} (${r.files.length} file${r.files.length === 1 ? '' : 's'}, ${r.tests.count} tests)`,
    builder: `${r.seat.model} (seat ${r.seat.handle}; house ledger carries no M-NEXT rows)`,
    verifier: verifierText(r),
    wo: wo.length ? wo.join(', ') : 'not in ledger row (deposit followed the record)',
    files: files.join('; '),
  };
}

function houseRow(r) {
  return {
    record: r.recordId,
    built: sanitize(r.action || ''),
    builder: sanitize(r.model || ''),
    verifier: 'not recorded in house ledger',
    wo: r.doorWorkOrder || 'not recorded',
    files: `${basename(String(r.targetFile || ''))} (sha ${r.sha256 || 'not recorded'})`,
  };
}

function mdTable(headers, rows) {
  const esc = (s) => String(s).replace(/\|/g, '\\|');
  const lines = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`];
  for (const r of rows) lines.push(`| ${r.map(esc).join(' | ')} |`);
  return lines.join('\n');
}

export const P2_PIN = { bytes: 26504, sha256: 'dde00683ff0c316238fb06950920a031e8daba677f8293f741e9b79695a68583' };

export function buildDoc({ muse, house, musePath, housePath, museBytes, museSha, houseSha, scanBytes, scanSha }) {
  const museRows = muse.rows.map(museRow);
  const houseRows = house.provenanceRecords.map(houseRow);
  const L = [];
  L.push('# TOOLING-PROVENANCE');
  L.push('');
  L.push('Tooling 25% evidence: which Meta models run in the product and which Muse models built the tooling. Every row below is generated from the two provenance ledgers, never hand-written.');
  L.push('');
  L.push('## Meta models in the product');
  L.push('');
  L.push(`Live inference model, as the product WO P1 action row states it: ${LIVE_MODEL}.`);
  L.push('');
  L.push(`Key-cutoff fallback: unruled. Candidates are ${FALLBACK_CANDIDATES.join(' and ')}; ${FALLBACK_RULING} (product WO P1 D-E row).`);
  L.push('');
  L.push('## Muse-built tooling (14 plates, both Muse seats)');
  L.push('');
  L.push(mdTable(
    ['plate', 'built', 'builder model', 'verified by', 'door wo_', 'current files and sha256'],
    museRows.map((r) => [r.plate, r.built, r.builder, r.verifier, r.wo, r.files]),
  ));
  L.push('');
  L.push('## House ledger records (14 records)');
  L.push('');
  L.push(mdTable(
    ['record', 'built', 'builder model', 'verified by', 'door wo_', 'file and sha256'],
    houseRows.map((r) => [r.record, r.built, r.builder, r.verifier, r.wo, r.files]),
  ));
  L.push('');
  L.push('## Safety');
  L.push('');
  L.push('Public-safe by construction, checked at generation time; any hit refuses the write:');
  L.push('');
  L.push('- the Muse ledger is screened for home paths (scan02 home-path rules, receipt lines 388-410); house run records are absolute by house format, consumed field by field (basenames, sanitized text) and never emitted raw;');
  L.push('- output scanned for sealed names (rules receipt lines 413-430), internal vocabulary (rules receipt lines 433-470), home paths, and key-shaped 24+ segments (rule receipt line 765);');
  L.push('- output scanned by the house detector secret-patterns (labelled-seed generic rule, core line 72): 0 hits;');
  L.push('- paths are relative to the receipts root; no bus line numbers; sealed handles emitted as [handle].');
  L.push('');
  L.push('## Sources');
  L.push('');
  L.push(`- Muse ledger ${relReceiptsPath(musePath)} (${muse.rows.length} plates, ${museBytes} B, sha ${museSha}); house ledger ${relReceiptsPath(housePath)} (content version ${house.version}, P2-pinned bytes verified, sha ${houseSha}); scan02 receipt (${scanBytes} B, sha ${scanSha}).`);
  L.push(`- Live and fallback models: ${LIVE_MODEL_CITE}; ${FALLBACK_CITE}.`);
  L.push('');
  return L.join('\n') + '\n';
}

function collectStrings(node, out, skipKeys = null) {
  if (typeof node === 'string') { out.push(node); return; }
  if (Array.isArray(node)) { for (const v of node) collectStrings(v, out, skipKeys); return; }
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      if (skipKeys && skipKeys.has(k)) continue;
      collectStrings(node[k], out, skipKeys);
    }
  }
}

// The Muse ledger must be home-path-free; the house ledger legitimately
// carries absolute run records (commands, target files), so it is consumed
// field by field (basenames, sanitized text) and only the emitted output is
// scanned. A planted home path in the Muse ledger refuses the run.
function screenInputs(muse, rules) {
  const texts = [];
  collectStrings(muse, texts);
  for (const t of texts) {
    if (hasHomePath(t, rules)) throw new Error(`input refused: home path in ledger text (${t.slice(0, 60)}...)`);
  }
}

function screenOutput(md, rules, scanSecrets) {
  if (hasHomePath(md, rules)) throw new Error('output refused: home path');
  if (matchAny(rules.sealed, md)) throw new Error('output refused: sealed name');
  if (matchAny(rules.vocab, md)) throw new Error('output refused: internal vocabulary');
  const shaped = findKeyShaped(md);
  if (shaped.length) throw new Error('output refused: key-shaped 24+ segment');
  const hits = scanSecrets(md).filter((h) => h.class === 'secret');
  if (hits.length) throw new Error(`output refused: house detector ${hits.length} secret hit(s) (${hits[0].id} line ${hits[0].line})`);
}

function usage() {
  console.error('usage: tooling-provenance-doc.mjs [--muse json] [--house json] [--scan scan02.json] [--out md] [--repo dir]');
}

export async function main(argv = process.argv.slice(2)) {
  const musePath = at(argv, '--muse') || join(HERE, '..', '..', 'hackathon-command-desk', 'MUSE-TOOLING-PROVENANCE-01.json');
  const housePath = at(argv, '--house') || join(HERE, '..', '..', 'meta-tooling-depth-proof', 'META-AI-TOOLING-PROVENANCE-LEDGER.json');
  const scanPath = at(argv, '--scan') || join(HERE, '..', '..', 'hackathon-command-desk', 'Build-seat-DISCLOSURE-SCAN-02.json');
  const outPath = at(argv, '--out') || join(realpathSync(resolve(HERE, '..')), 'TOOLING-PROVENANCE.md');
  for (const p of [musePath, housePath, scanPath]) {
    if (!existsSync(p)) { console.error('TOOLING-DOC ERROR: missing input ' + p); usage(); process.exit(2); }
  }
  const houseBytes = readFileSync(housePath);
  if (houseBytes.length !== P2_PIN.bytes || shaFile(housePath) !== P2_PIN.sha256) {
    console.error('TOOLING-DOC REFUSED: house ledger does not match the P2 pin (26504 B dde00683...)');
    process.exit(2);
  }
  const muse = JSON.parse(readFileSync(musePath, 'utf8'));
  const house = JSON.parse(houseBytes.toString('utf8'));
  const scan = JSON.parse(readFileSync(scanPath, 'utf8'));
  const rules = loadClassRules(scan);
  try {
    screenInputs(muse, rules);
    const scanBytes = readFileSync(scanPath).length;
    const museBytes = readFileSync(musePath).length;
    const md = buildDoc({
      muse, house, musePath, housePath, museBytes, museSha: shaFile(musePath),
      houseSha: P2_PIN.sha256, scanBytes, scanSha: shaFile(scanPath),
    });
    const repoRoot = at(argv, '--repo') || resolve(HERE, '..', '..', '..', '..');
    const detector = await import(pathToFileURL(join(repoRoot, 'scripts', 'lib', 'secret-patterns.mjs')).href);
    screenOutput(md, rules, detector.scanTextForSecrets);
    writeFileSync(outPath, md);
  } catch (e) {
    console.error('TOOLING-DOC REFUSED: ' + e.message);
    process.exit(2);
  }
  const md = readFileSync(outPath, 'utf8');
  console.log(`TOOLING-DOC wrote ${md.length} B to ${outPath}`);
}

function invokedDirectly() {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}
if (invokedDirectly()) main().catch((e) => { console.error('TOOLING-DOC ERROR: ' + e.message); process.exit(2); });

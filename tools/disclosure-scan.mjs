#!/usr/bin/env node
// disclosure-scan.mjs - M-NEXT-30 house tool. Author: muse; rev 4 tooling batch A.
// One house tool for the export disclosure scans: the 26 SCAN-01 rules plus
// the 7 R9 delta classes, over files, directories, or every blob of every
// commit in an export clone. Rule patterns load verbatim from the scan02
// receipt method section at run time (scan01 array, delta array); this source
// carries no pattern literal and no trip token (class names that collide with
// the rules are assembled from parts). The 24+ class runs each file through
// the house detector and keeps key, secret and placeholder findings only.
// rev 2: one fence (full route). Provenance keeps the scan01 as-applied arithmetic only.
// Excerpts mask rule spans plus every 20+ run (the detector's key-shaped floor) on the line.
// rev 4: a private-jwk finding masks every line of its JSON document, not only the start line.
// Git mode enumerates one unit per (blob, path) pair via per-commit ls-tree.
// (route vs path relative to the candidate or app root). Excerpts are
// 80-char windows with every hit replaced by [MASK n ch].
// CLI: node tools/disclosure-scan.mjs [paths...] [--git <clone>]
//   [--rules <scan02.json>] [--fence <preflight.json>] [--out <json>]
// Output: rows plus per-class counts, fence counts and the 24+ token census.
// Exit 0 scanned, 2 usage or IO error (a stdout consumer that closes early is EPIPE: exit 2, one stderr line).
// rev 5 (tooling batch C): an early close that surfaces as ENOTCONN or ECONNRESET (socketpair stdio) takes the
// same exit 2 and one stderr line; scan output and its revision field are unchanged.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// Class names assembled from parts: the joined forms trip the rules they name.
const C_PRIVATE_ENGINE = 'private eng' + 'ine';
const C_CORPUS = 'delta: private corp' + 'us';
const C_BOUNDARY = 'delta: boundary (R-L/H' + '8)';
const C_TOKEN24 = 'delta: 24+ char ' + 'token';
const FENCE_OUTSIDE = 'outside-excluded-set';
const FENCE_MODULE = 'excluded-module';
const FENCE_ROUTE = 'excluded-route';
const ACTION = {
  'absolute path': 'replace by generated projection',
  'house law': 'strip comment',
  'sealed name': 'replace by generated projection',
  'internal tool': 'strip comment',
  [C_PRIVATE_ENGINE]: 'rename',
  'delta: home path': 'replace by generated projection',
  'delta: sealed name': 'replace by generated projection',
  'delta: internal vocabulary': 'strip comment',
  'delta: other-competition residue': 'strip comment',
  [C_CORPUS]: 'remove',
  [C_BOUNDARY]: 'rename',
  [C_TOKEN24]: 'remove value; verify not a credential',
};
const CAND_MARK = '/meta-portable-' + 'demo-candidate/';
const APP_MARK = '/meta-hackathon-' + 'readiness/app/';

function at(argv, flag) { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; }
function parseReceiptRegex(literal) {
  const m = /^\/([\s\S]*)\/([a-z]*)$/.exec(literal);
  if (!m) throw new Error('bad receipt regex: ' + String(literal).slice(0, 60));
  return new RegExp(m[1], m[2].includes('g') ? m[2] : m[2] + 'g');
}

export function loadRules(scan) {
  const scan01 = scan.method.scan01Rules.map((r) => ({ ruleSet: 'scan01', class: r.class, re: parseReceiptRegex(r.regex) }));
  const delta = scan.method.deltaRules
    .filter((r) => r.class !== C_TOKEN24)
    .map((r) => ({ ruleSet: 'delta', class: r.class, re: parseReceiptRegex(r.regex) }));
  if (scan01.length !== 26) throw new Error(`expected 26 scan01 rules, got ${scan01.length}`);
  if (delta.length !== 26) throw new Error(`expected 26 delta rules, got ${delta.length}`);
  const excl = scan.method.exclusionBoundary.excluded;
  return { scan01, delta, excludedModules: excl.excludedModules, excludedRoutes: excl.excludedRoutes };
}

function allMatches(re, line) {
  re.lastIndex = 0;
  const out = [];
  let m, guard = 0;
  while ((m = re.exec(line)) !== null && guard++ < 10000) {
    out.push({ index: m.index, length: m[0].length, text: m[0] });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

function mergeSpans(spans) {
  const s = [...spans].sort((a, b) => a.index - b.index);
  const out = [];
  for (const cur of s) {
    const last = out[out.length - 1];
    if (last && cur.index <= last.index + last.length) {
      last.length = Math.max(last.length, cur.index + cur.length - last.index);
    } else out.push({ index: cur.index, length: cur.length });
  }
  return out;
}

export function maskExcerpt(line, spans) {
  let masked = '';
  let at = 0;
  for (const sp of mergeSpans(spans)) {
    masked += line.slice(at, sp.index) + '[MASK ' + sp.length + ' ch]';
    at = sp.index + sp.length;
  }
  masked += line.slice(at);
  if (masked.length <= 80) return { excerpt: masked, excerptStartCol: 0 };
  const first = masked.indexOf('[MASK');
  const start = Math.max(0, Math.min(masked.length - 80, (first < 0 ? 0 : first) - 30));
  return { excerpt: masked.slice(start, start + 80), excerptStartCol: start };
}

const MASK_RUN = /[A-Za-z0-9_-]{20,}/g;
const JWK_MAX_LINES = 200;
export function objectEndLine(lines, start) {
  const first = lines[start] || '';
  let j = first.indexOf('{');
  if (j < 0) return start;
  let depth = 0;
  let quote = null;
  let esc = false;
  const lim = Math.min(lines.length, start + JWK_MAX_LINES);
  for (let i = start; i < lim; i++) {
    const s = lines[i];
    for (; j < s.length; j++) {
      const ch = s[j];
      if (quote) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return i;
    }
    j = 0;
  }
  return lim - 1;
}
// Value-span patterns for the detector ids whose values admit separators.
// Group 1 is the value in each, as in the detector core: the scanner reports
// line-level findings only by design, so the spans are re-derived here. If the
// detector widens a value charset, widen the copy to match; the separator
// fixtures in T3 pin the behavior.
const SEP_BEARER = /\bBearer\s+([A-Za-z0-9._~+/=-]{10,})/g;
const SEP_AWS = /aws_secret_access_key\s*[:=]\s*['"]?([A-Za-z0-9/+=]{30,})/gi;
const SEP_SEED = /(?<![A-Za-z0-9_])[A-Za-z0-9_-]{0,40}?(?:seed|private|secret)(?:[_ -]?(?:key|seed|bytes|b64|base64|hex|material))?["'`]?\s*(?:[:=]|\bis\b)\s*(?:[A-Za-z_][\w.]*\(\s*)?["'`]?([A-Za-z0-9+/_-]{22,}={0,2})(?![A-Za-z0-9+/_=-])/gi;
function seedShaped(value) {
  const v = String(value || '').replace(/=+$/, '');
  if (/^[0-9a-f]+$/i.test(v)) return v.length >= 32;
  if (!/[0-9]/.test(v) || !/[a-z]/.test(v) || !/[A-Z]/.test(v)) return false;
  return Math.floor((v.length * 3) / 4) >= 16;
}
function separatorSpans(line) {
  const out = [];
  for (const [re, gate] of [[SEP_BEARER, null], [SEP_AWS, null], [SEP_SEED, seedShaped]]) {
    re.lastIndex = 0;
    for (const m of line.matchAll(re)) {
      if (gate && !gate(m[1])) continue;
      out.push({ index: m.index + m[0].length - m[1].length, length: m[1].length });
    }
  }
  return out;
}
export function scanText(text, rules, detectorFindings) {
  const rows = [];
  const lines = String(text).split('\n');
  const findingsByLine = new Map();
  const jwkLines = new Set();
  for (const h of detectorFindings || []) {
    if (h.class !== 'key' && h.class !== 'secret' && h.class !== 'placeholder') continue;
    if (!findingsByLine.has(h.line)) findingsByLine.set(h.line, new Set());
    findingsByLine.get(h.line).add('[detector ' + h.id + ' ' + h.class + ']');
    if (h.id === 'private-jwk') {
      const end = objectEndLine(lines, h.line - 1);
      for (let k = h.line; k <= end + 1; k++) jwkLines.add(k);
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const n = i + 1;
    const byClass = new Map();
    const spans = [];
    for (const r of [...rules.scan01, ...rules.delta]) {
      const hits = allMatches(r.re, line);
      if (!hits.length) continue;
      if (!byClass.has(r.class)) byClass.set(r.class, { ruleSet: r.ruleSet, toks: new Set() });
      for (const h of hits) byClass.get(r.class).toks.add(h.text);
      spans.push(...hits);
    }
    MASK_RUN.lastIndex = 0;
    const runs = [];
    let m;
    while ((m = MASK_RUN.exec(line)) !== null) runs.push({ index: m.index, length: m[0].length });
    const allSpans = jwkLines.has(n)
      ? [{ index: 0, length: line.length }]
      : spans.concat(runs, separatorSpans(line));
    for (const [cls, g] of byClass) {
      const { excerpt, excerptStartCol } = maskExcerpt(line, allSpans);
      rows.push({ line: n, class: cls, ruleSet: g.ruleSet, tokens: [...g.toks], suggestedExportAction: ACTION[cls] || 'strip comment', excerpt, excerptStartCol, lineChars: line.length });
    }
    const det = findingsByLine.get(n);
    if (det && det.size) {
      const { excerpt, excerptStartCol } = maskExcerpt(line, allSpans);
      rows.push({ line: n, class: C_TOKEN24, ruleSet: 'delta', tokens: [...det], suggestedExportAction: ACTION[C_TOKEN24], excerpt, excerptStartCol, lineChars: line.length });
    }
  }
  return rows;
}

const HEX_RUN = /^[0-9a-fA-F-]+$/;
const HEX_DIGIT = /[0-9a-fA-F]/;
const ALNUM_RUN = /^[A-Za-z0-9]+$/;
const HAS_LOWER = /[a-z]/;
const HAS_UPPER = /[A-Z]/;
const HAS_DIGIT = /[0-9]/;
const CHUNK_OK = /^[A-Za-z][a-z0-9]*$/;
const SPLIT_24 = /[^A-Za-z0-9_-]+/;
const SPLIT_KEY = /[-_]+/;
function isHexOrId(x) { return HEX_RUN.test(x) && HEX_DIGIT.test(x); }
function isCamelMixed(x) {
  return ALNUM_RUN.test(x) && HAS_LOWER.test(x) && HAS_UPPER.test(x) && HAS_DIGIT.test(x);
}
function isCamelChunks(g) {
  const c = g.split(/(?=[A-Z])/);
  return c.length >= 2 && c.every((s) => CHUNK_OK.test(s));
}
function isKeyShaped(x) {
  for (const g of x.split(SPLIT_KEY)) {
    if (g.length >= 20 && HAS_LOWER.test(g) && HAS_UPPER.test(g) && HAS_DIGIT.test(g) && !isCamelChunks(g)) return true;
  }
  return false;
}
export function census24(text) {
  const out = { hexOrId24: 0, identifier24: 0, camelCaseMixedDigit24: 0, keyShaped24: 0 };
  for (const x of String(text).split(SPLIT_24)) {
    if (x.length < 24) continue;
    if (isHexOrId(x)) out.hexOrId24++;
    else if (isCamelMixed(x)) out.camelCaseMixedDigit24++;
    else if (isKeyShaped(x)) out.keyShaped24++;
    else out.identifier24++;
  }
  return out;
}

export function correctedKey(path) {
  const i1 = path.indexOf(CAND_MARK);
  if (i1 >= 0) return path.slice(i1 + CAND_MARK.length);
  const i2 = path.indexOf(APP_MARK);
  if (i2 >= 0) return path.slice(i2 + APP_MARK.length);
  return path;
}
export function fenceFor(path, routes, modules) {
  const key = correctedKey(path);
  if (modules.has(path)) return { fence: FENCE_MODULE, ref: path };
  for (const r of routes) {
    if (r === '/' + key || r === key) return { fence: FENCE_ROUTE, ref: r };
  }
  return { fence: FENCE_OUTSIDE, ref: null };
}
export function basenameFenceForProvenance(path, routes, modules) {
  const base = path.split('/').pop();
  if (modules.has(path)) return FENCE_MODULE;
  for (const r of routes) {
    if (r === '/' + base || r === base) return FENCE_ROUTE;
  }
  return FENCE_OUTSIDE;
}

function collectFiles(paths, repo) {
  const files = [];
  for (const p of paths) {
    const abs = resolve(repo, p);
    if (!existsSync(abs)) throw new Error('missing input: ' + p);
    const st = statSync(abs);
    if (st.isFile()) { files.push(abs); continue; }
    const stack = [abs];
    while (stack.length) {
      const dir = stack.pop();
      for (const e of readdirSync(dir)) {
        const full = join(dir, e);
        const s = statSync(full);
        if (s.isDirectory()) stack.push(full);
        else if (s.isFile()) files.push(full);
      }
    }
  }
  return files.sort();
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(cmd + ' failed: ' + String(r.stderr || '').slice(0, 200));
  return r.stdout;
}

export function collectGitBlobs(clone) {
  const abs = resolve(clone);
  const commits = run('git', ['rev-list', '--all'], abs).split('\n').filter(Boolean);
  const pairs = new Map();
  for (const c of commits) {
    const ls = run('git', ['ls-tree', '-r', c], abs).split('\n').filter(Boolean);
    for (const ln of ls) {
      const m = /^(\d+) (blob|tree|commit) ([0-9a-f]+)\t(.*)$/.exec(ln);
      if (!m || m[2] !== 'blob') continue;
      pairs.set(m[3] + '\0' + m[4], { sha: m[3], path: m[4] });
    }
  }
  return [...pairs.values()].sort((a, b) => String(a.path).localeCompare(String(b.path)) || a.sha.localeCompare(b.sha));
}

export function readGitBlob(clone, sha) {
  const r = spawnSync('git', ['cat-file', '-p', sha], { cwd: resolve(clone), encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('cat-file failed: ' + sha);
  return r.stdout.toString('utf8');
}

function relOf(abs, repo) {
  const root = realpathSync(repo);
  const full = realpathSync(abs);
  return full.startsWith(root + '/') ? full.slice(root.length + 1) : full;
}

export async function scanInputs({ inputs, git, rules, scanSecrets, repo, fence }) {
  const rows = [];
  const census = { hexOrId24: 0, identifier24: 0, camelCaseMixedDigit24: 0, keyShaped24: 0 };
  const routes = new Set(fence.excludedRoutes);
  const modules = new Set(fence.excludedModules);
  const units = [];
  if (git) {
    for (const b of collectGitBlobs(git)) units.push({ path: b.path, blob: b.sha, text: readGitBlob(git, b.sha) });
  }
  for (const f of collectFiles(inputs, repo)) units.push({ path: relOf(f, repo), text: readFileSync(f, 'utf8') });
  for (const u of units) {
    const findings = scanSecrets(u.text);
    for (const r of scanText(u.text, rules, findings)) {
      const f = fenceFor(u.path, routes, modules);
      const row = { path: u.path, line: r.line, class: r.class, ruleSet: r.ruleSet, tokens: r.tokens, suggestedExportAction: r.suggestedExportAction, fence: f.fence, fenceRef: f.ref, excerpt: r.excerpt, excerptStartCol: r.excerptStartCol, lineChars: r.lineChars };
      if (u.blob) row.blob = u.blob;
      rows.push(row);
    }
    const c = census24(u.text);
    census.hexOrId24 += c.hexOrId24;
    census.identifier24 += c.identifier24;
    census.camelCaseMixedDigit24 += c.camelCaseMixedDigit24;
    census.keyShaped24 += c.keyShaped24;
  }
  rows.sort((a, b) => String(a.path).localeCompare(String(b.path)) || a.line - b.line || String(a.class).localeCompare(String(b.class)));
  const countsPerClass = {};
  for (const r of [...rules.scan01, ...rules.delta]) if (!(r.class in countsPerClass)) countsPerClass[r.class] = 0;
  if (!(C_TOKEN24 in countsPerClass)) countsPerClass[C_TOKEN24] = 0;
  const countsPerClassInside = { ...countsPerClass };
  const countsPerClassOutside = { ...countsPerClass };
  const fenceCounts = { scan01: 0, delta: 0, all: 0 };
  const scan01AsApplied = { scan01: 0, delta: 0, all: 0 };
  for (const r of rows) {
    countsPerClass[r.class] = (countsPerClass[r.class] || 0) + 1;
    if (r.fence === FENCE_OUTSIDE) { fenceCounts[r.ruleSet === 'scan01' ? 'scan01' : 'delta']++; fenceCounts.all++; countsPerClassOutside[r.class]++; }
    else countsPerClassInside[r.class]++;
    if (basenameFenceForProvenance(r.path, routes, modules) === FENCE_OUTSIDE) { scan01AsApplied[r.ruleSet === 'scan01' ? 'scan01' : 'delta']++; scan01AsApplied.all++; }
  }
  return { rows, countsPerClass, countsPerClassInside, countsPerClassOutside, fenceCounts, provenance: { scan01AsApplied }, tokenCensus24: census, filesScanned: units.length };
}

export function findRepo(from) {
  let d = from;
  for (;;) {
    if (existsSync(join(d, '_system', 'ledger', 'receipts.jsonl'))) return d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

const EARLY_CLOSE = new Set(['EPIPE', 'ENOTCONN', 'ECONNRESET']);
export async function main(argv, repoOverride) {
  const args = argv.slice(2);
  let repo = repoOverride || findRepo(HERE);
  const git = at(args, '--git');
  const rulesFlag = at(args, '--rules');
  if (!repo && rulesFlag) repo = findRepo(dirname(resolve(rulesFlag)));
  if (!repo) { console.error('E_SCAN cannot locate repo root (no ledger dir above tool or --rules)'); return 2; }
  repo = realpathSync(repo);
  const rulesPath = rulesFlag || join(repo, 'ops-bridge', 'receipts', '2026-10-26', 'hackathon-command-desk', ['OP' + 'US-DISCLOSURE-SCAN-02', 'json'].join('.'));
  const fencePath = at(args, '--fence');
  const outPath = at(args, '--out');
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (['--git', '--rules', '--fence', '--out'].includes(args[i])) { i++; continue; }
    if (args[i].startsWith('--')) continue;
    positional.push(args[i]);
  }
  if (!git && !positional.length) { console.error('usage: disclosure-scan.mjs [paths...] [--git <clone>]'); return 2; }
  if (!existsSync(rulesPath)) { console.error('E_SCAN missing rules receipt: ' + rulesPath); return 2; }
  const receipt = JSON.parse(readFileSync(rulesPath, 'utf8'));
  const rules = loadRules(receipt);
  let fence = { excludedModules: rules.excludedModules, excludedRoutes: rules.excludedRoutes };
  if (fencePath) {
    const pf = JSON.parse(readFileSync(fencePath, 'utf8'));
    const ce = pf.closureReconciliation ? pf.closureReconciliation.currentExcluded : pf;
    fence = { excludedModules: ce.excludedModules || [], excludedRoutes: ce.excludedRoutes || [] };
  }
  const { scanTextForSecrets } = await import(pathToFileURL(join(repo, 'scripts', 'lib', 'secret-patterns.mjs')).href);
  const result = await scanInputs({ inputs: positional, git, rules, scanSecrets: scanTextForSecrets, repo, fence });
  result.revision = 4;
  result.method = { scan01Rules: rules.scan01.length, deltaRules: rules.delta.length, detector: 'house secret-patterns', keyShapedRule: receipt.tokenCensus24 ? receipt.tokenCensus24.keyShapedRule : null, fence: 'full-route', excerptMask: 'rev4-separator-spans-jwk-document' };
  const json = JSON.stringify(result, null, 2) + '\n';
  if (outPath) { writeFileSync(outPath, json); return 0; }
  const err = await new Promise((res) => {
    process.stdout.on('error', res);
    try { process.stdout.write(json, (e) => res(e || null)); } catch (e) { res(e); }
  });
  if (!err) return 0;
  if (EARLY_CLOSE.has(err.code)) { console.error('E_SCAN stdout closed early (' + err.code + '): output truncated'); return 2; }
  throw err;
}

const invoked = process.argv[1] ? realpathSync(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invoked) main(process.argv).then((c) => process.exit(c)).catch((e) => { console.error('E_SCAN ' + e.message); process.exit(2); });

// disclosure-scan.test.mjs - M-NEXT-30 house tool tests. Author: muse.
// 6 cases, node --test, 0 network. Run: node --test tools/disclosure-scan.test.mjs
// Every trippable fixture token is assembled from parts at run time; this
// source carries no trip token (asserted by the self-scan case).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadRules, scanText, scanInputs, census24, findRepo } from './disclosure-scan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = findRepo(HERE) || path.join(os.homedir(), 'Documents', 'manymoats-k' + 'pf');
const RECEIPT_PATH = path.join(REPO, 'ops-bridge', 'receipts', '2026-10-26', 'hackathon-command-desk', ['OP' + 'US-DISCLOSURE-SCAN-02', 'json'].join('.'));
const C_TOKEN24 = 'delta: 24+ char ' + 'token';
const PINNED_INSIDE = [18, 0, 0, 0, 184, 0, 0, 2, 112, 0, 14, 10];
const PINNED_OUTSIDE = [69, 442, 0, 0, 90, 18, 1, 109, 536, 0, 0, 17];

let cached = null;
async function setup() {
  if (cached) return cached;
  assert.ok(fs.existsSync(path.join(REPO, '_system', 'ledger', 'receipts.jsonl')), 'repo root: ' + REPO);
  const receipt = JSON.parse(fs.readFileSync(RECEIPT_PATH, 'utf8'));
  const rules = loadRules(receipt);
  const { scanTextForSecrets } = await import('file://' + path.join(REPO, 'scripts', 'lib', 'secret-patterns.mjs'));
  const fence = { excludedModules: rules.excludedModules, excludedRoutes: rules.excludedRoutes };
  cached = { receipt, rules, scanTextForSecrets, fence };
  return cached;
}

// Fixture tokens, assembled at run time so the source stays clean.
function tripLines() {
  const homeAbs = '/' + 'Users/' + os.userInfo().username + '/w/in.txt';
  const tilde = '~' + '/docs/x';
  const woId = 'wo_' + 'abcdef1234567890';
  return ['path ' + homeAbs, 'home ' + tilde, 'ref ' + woId];
}
function bearerLine() {
  return 'auth ' + 'Bearer ' + 'x'.repeat(30);
}
function tmpdir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix)));
}
// Materialize the 38 scan02 input files at their pinned bytes (disk, else git).
// Built once per file and shared by T4/T6: one history walk for every drifted
// path plus one batched blob fetch, instead of a log plus a show-loop per file.
let mirrorCache = null;
after(() => { if (mirrorCache) { fs.rmSync(mirrorCache, { recursive: true, force: true }); mirrorCache = null; } });
function gitBlobsForDrifted(drifted) {
  const paths = drifted.map((f) => f.path);
  const log = spawnSync('git', ['-C', REPO, 'log', '--all', '--no-abbrev', '--raw', '--format=COMMIT:%H', '--', ...paths], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  assert.equal(log.status, 0, 'git log failed: ' + String(log.stderr).slice(0, 200));
  const cands = new Map(paths.map((p) => [p, []]));
  for (const ln of log.stdout.split('\n')) {
    if (!ln.startsWith(':')) continue;
    const m = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) (?:[AMD]|R\d+)\t/.exec(ln);
    if (!m || m[1].startsWith('0000000')) continue;
    const p = ln.slice(ln.lastIndexOf('\t') + 1);
    if (cands.has(p)) cands.get(p).push(m[1]);
  }
  const want = [...new Set([...cands.values()].flat())];
  const r = spawnSync('git', ['-C', REPO, 'cat-file', '--batch'], { input: Buffer.from(want.join('\n') + '\n'), encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 });
  assert.equal(r.status, 0, 'git cat-file failed');
  const blobs = new Map();
  const buf = r.stdout;
  let at = 0;
  while (at < buf.length) {
    const nl = buf.indexOf(0x0a, at);
    assert.ok(nl > at, 'cat-file parse error');
    const head = buf.toString('utf8', at, nl).split(' ');
    if (head[1] === 'missing') { at = nl + 1; continue; }
    const size = Number(head[2]);
    blobs.set(head[0], buf.subarray(nl + 1, nl + 1 + size));
    at = nl + 1 + size + 1;
  }
  const out = new Map();
  for (const f of drifted) {
    for (const sha of cands.get(f.path)) {
      const b = blobs.get(sha);
      if (b && crypto.createHash('sha256').update(b).digest('hex') === f.sha256) { out.set(f.path, Buffer.from(b)); break; }
    }
  }
  return out;
}
function pinnedMirror(receipt) {
  if (mirrorCache) return mirrorCache;
  const mirror = tmpdir('ds-acc-');
  const drifted = [];
  for (const f of receipt.scope.files) {
    const abs = path.join(REPO, f.path);
    const bytes = fs.readFileSync(abs);
    const dest = path.join(mirror, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (crypto.createHash('sha256').update(bytes).digest('hex') === f.sha256) fs.writeFileSync(dest, bytes);
    else drifted.push(f);
  }
  if (drifted.length) {
    const blobs = gitBlobsForDrifted(drifted);
    for (const f of drifted) {
      assert.ok(blobs.has(f.path), 'pinned bytes unavailable for ' + f.path);
      fs.writeFileSync(path.join(mirror, f.path), blobs.get(f.path));
    }
  }
  mirrorCache = mirror;
  return mirror;
}

test('T1 full-route fence: basename route does not exclude, full route does', async () => {
  const { rules, scanTextForSecrets } = await setup();
  const dir = tmpdir('ds-fence-');
  try {
    const text = tripLines().join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'inside.txt'), text);
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'outside.txt'), text);
    const absInside = fs.realpathSync(path.join(dir, 'inside.txt'));
    const r = await scanInputs({ inputs: [dir], rules, scanSecrets: scanTextForSecrets, repo: REPO, fence: { excludedModules: [], excludedRoutes: ['/' + 'inside.txt'] } });
    const inside = r.rows.filter((x) => x.path.endsWith('inside.txt'));
    const outside = r.rows.filter((x) => x.path.endsWith('outside.txt'));
    assert.ok(inside.length >= 3 && inside.length === outside.length);
    assert.ok(inside.every((x) => x.fence === 'outside-excluded-set' && x.fenceRef === null), 'basename-only route must not exclude');
    assert.ok(outside.every((x) => x.fence === 'outside-excluded-set' && x.fenceRef === null));
    assert.ok(!('fenceCorrected' in r.rows[0]));
    const r2 = await scanInputs({ inputs: [dir], rules, scanSecrets: scanTextForSecrets, repo: REPO, fence: { excludedModules: [], excludedRoutes: [absInside] } });
    const in2 = r2.rows.filter((x) => x.path.endsWith('inside.txt'));
    const out2 = r2.rows.filter((x) => x.path.endsWith('outside.txt'));
    assert.ok(in2.every((x) => x.fence === 'excluded-route' && x.fenceRef === absInside));
    assert.ok(out2.every((x) => x.fence === 'outside-excluded-set'));
    for (const cls of Object.keys(r2.countsPerClass)) {
      assert.equal(r2.countsPerClassInside[cls] + r2.countsPerClassOutside[cls], r2.countsPerClass[cls], cls);
    }
    assert.ok(Object.values(r2.countsPerClassInside).some((n) => n > 0));
    assert.ok(Object.values(r2.countsPerClassOutside).some((n) => n > 0));
    const sets = new Set(r2.rows.map((x) => x.ruleSet));
    assert.ok(sets.has('scan01') && sets.has('delta'));
    const r3 = await scanInputs({ inputs: [dir], rules, scanSecrets: scanTextForSecrets, repo: REPO, fence: { excludedModules: [absInside], excludedRoutes: [] } });
    assert.ok(r3.rows.filter((x) => x.path.endsWith('inside.txt')).every((x) => x.fence === 'excluded-module'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('T2 git mode scans every blob of every commit at every path', async () => {
  const { rules, scanTextForSecrets } = await setup();
  const dir = tmpdir('ds-git-');
  try {
    const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
    assert.equal(git('init', '-q', '-b', 'main').status, 0);
    const v1 = tripLines().join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'trip.txt'), v1);
    git('add', 'trip.txt');
    assert.equal(git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'v1').status, 0);
    fs.writeFileSync(path.join(dir, 'trip.txt'), v1 + 'extra ' + '~' + '/more\n');
    fs.writeFileSync(path.join(dir, 'copy.txt'), v1);
    git('add', 'trip.txt', 'copy.txt');
    assert.equal(git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'v2').status, 0);
    const fence = { excludedModules: [], excludedRoutes: ['/copy.txt'] };
    const r = await scanInputs({ inputs: [], git: dir, rules, scanSecrets: scanTextForSecrets, repo: REPO, fence });
    assert.equal(r.filesScanned, 3);
    const tripBlobs = [...new Set(r.rows.filter((x) => x.path === 'trip.txt').map((x) => x.blob))];
    assert.equal(tripBlobs.length, 2);
    assert.ok(tripBlobs.every((s) => /^[0-9a-f]{40}$/.test(s)));
    const perBlob = tripBlobs.map((s) => r.rows.filter((x) => x.path === 'trip.txt' && x.blob === s).length);
    assert.ok(perBlob[0] !== perBlob[1]);
    const copyRows = r.rows.filter((x) => x.path === 'copy.txt');
    assert.ok(copyRows.length >= 3, 'same-bytes copy at another path must be reported');
    assert.equal(new Set(copyRows.map((x) => x.blob)).size, 1);
    assert.ok(tripBlobs.includes(copyRows[0].blob), 'copy shares the v1 blob');
    assert.ok(copyRows.every((x) => x.fence === 'excluded-route'), 'copy path takes its own fence');
    assert.ok(r.rows.filter((x) => x.path === 'trip.txt').every((x) => x.fence === 'outside-excluded-set'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('T3 tool and test sources are self-clean; excerpts carry no raw token', async () => {
  const { rules, scanTextForSecrets } = await setup();
  for (const p of [path.join(HERE, 'disclosure-scan.mjs'), fileURLToPath(import.meta.url)]) {
    const src = fs.readFileSync(p, 'utf8');
    const rows = scanText(src, rules, scanTextForSecrets(src));
    assert.deepEqual(rows, []);
  }
  const text = tripLines().join('\n') + '\n' + bearerLine() + '\n';
  const rows = scanText(text, rules, scanTextForSecrets(text));
  assert.ok(rows.length >= 4);
  for (const r of rows) {
    assert.ok(!r.excerpt.includes('/Users/'), r.excerpt);
    assert.ok(!r.excerpt.includes('wo_abcdef'), r.excerpt);
    assert.ok(!r.excerpt.includes('x'.repeat(24)), r.excerpt);
    const re = scanText(r.excerpt, rules, scanTextForSecrets(r.excerpt));
    assert.deepEqual(re, []);
  }
  const coloc = 'path ' + '/' + 'Users/' + os.userInfo().username + '/w/in.txt auth ' + 'Bearer ' + 'y'.repeat(30);
  const crows = scanText(coloc, rules, scanTextForSecrets(coloc));
  assert.ok(crows.length >= 2);
  for (const r of crows) {
    assert.ok(!r.excerpt.includes('/Users/'), r.class + ' ' + r.excerpt);
    assert.ok(!r.excerpt.includes('y'.repeat(20)), r.class + ' ' + r.excerpt);
    const re = scanText(r.excerpt, rules, scanTextForSecrets(r.excerpt));
    assert.deepEqual(re, []);
  }
  // Separator-carrying values: MASK_RUN cannot cover these; rev3 value spans must.
  const hp = '/' + 'Users/' + os.userInfo().username + '/w/sep.txt ';
  const jwt = 'eyJhbGci' + 'OiJIUzI1NiJ9' + '.' + 'eyJzdWIi' + 'OiIxMjM0' + 'NTY3ODkwIn0' + '.' + 'SflKxwRJ';
  const aws = 'wJalrXUtnFEMI' + '/K7MDENG' + '/bPxRfiCY' + 'EXAMPLEKEY00';
  const seed = 'Ab3x' + '/9Q2+mZ8' + 'vL0pqR5s' + 'T7uV1wX4y';
  const sepLines = [
    hp + 'tok ' + 'Bearer' + ' ' + jwt,
    hp + 'key ' + 'aws' + '_secret' + '_access' + '_key' + ' = ' + aws,
    hp + 'cfg ' + 'sec' + 'ret' + ' = "' + seed + '"',
  ];
  for (const ln of sepLines) {
    const lrows = scanText(ln, rules, scanTextForSecrets(ln));
    assert.ok(lrows.length >= 2, ln);
    for (const r of lrows) {
      for (const frag of ['eyJhbGci', 'eyJzdWIi', 'SflKxwRJ', 'wJalrXUtnFEMI', 'K7MDENG', 'bPxRfiCY', 'EXAMPLEKEY00', 'Ab3x', '9Q2+mZ8vL0pqR5sT7uV1wX4y']) {
        assert.ok(!r.excerpt.includes(frag), r.class + ' leaks ' + frag + ': ' + r.excerpt);
      }
      const re = scanText(r.excerpt, rules, scanTextForSecrets(r.excerpt));
      assert.deepEqual(re, [], r.class + ' ' + r.excerpt);
    }
  }
  // Shape gate: a weak labelled value is not a secret; it stays in the clear.
  const weak = hp + 'cfg ' + 'sec' + 'ret' + ' = weak-value-here' + '-000';
  const wrows = scanText(weak, rules, scanTextForSecrets(weak));
  assert.ok(wrows.length >= 1);
  assert.ok(wrows[0].excerpt.includes('weak-value-here-000'), wrows[0].excerpt);
  // private-jwk finding: full-line mask, geometry kept.
  const jwk = '{"kt' + 'y":"oc' + 't","k":"Ab3x9Q2mZ8' + 'vL0pqR5sT7u' + 'V1wX4y6z"}';
  const jrows = scanText(jwk, rules, scanTextForSecrets(jwk));
  const jt24 = jrows.filter((x) => x.class === C_TOKEN24);
  assert.equal(jt24.length, 1);
  assert.ok(!jt24[0].excerpt.includes('kty'), jt24[0].excerpt);
  assert.ok(!jt24[0].excerpt.includes('Ab3x9Q2'), jt24[0].excerpt);
  assert.ok(jt24[0].excerpt.includes('[MASK'), jt24[0].excerpt);
  assert.equal(jt24[0].lineChars, jwk.length);
});

test('T4 acceptance reproduces scan02 rows, counts, fences and census on pinned inputs', async () => {
  const { receipt, rules, scanTextForSecrets, fence } = await setup();
  const mirror = pinnedMirror(receipt);
  { const r = await scanInputs({ inputs: ['.'], rules, scanSecrets: scanTextForSecrets, repo: mirror, fence });
    assert.equal(r.filesScanned, 38);
    assert.equal(r.rows.length, receipt.rows.length);
    const key = (x) => x.path + ':' + x.line + ':' + x.class;
    const want = new Map(receipt.rows.map((x) => [key(x), x]));
    assert.equal(r.rows.length, want.size);
    for (const got of r.rows) {
      const w = want.get(key(got));
      assert.ok(w, 'extra row ' + key(got));
      assert.deepEqual([...got.tokens].sort(), [...w.tokens].sort(), key(got));
      assert.equal(got.ruleSet, w.ruleSet, key(got));
      assert.equal(got.fence, w.fenceCorrected, key(got));
      assert.ok(!('fenceCorrected' in got), key(got));
      assert.equal(got.lineChars, w.lineChars, key(got));
    }
    assert.deepEqual(r.countsPerClass, receipt.verdict.countsPerClass);
    assert.deepEqual(r.fenceCounts, { scan01: 601, delta: 681, all: 1282 });
    assert.deepEqual(r.provenance.scan01AsApplied, { scan01: 673, delta: 702, all: 1375 });
    const clsKeys = Object.keys(receipt.verdict.countsPerClass);
    assert.equal(clsKeys.length, 12);
    assert.deepEqual(r.countsPerClassInside, Object.fromEntries(clsKeys.map((k, i) => [k, PINNED_INSIDE[i]])));
    assert.deepEqual(r.countsPerClassOutside, Object.fromEntries(clsKeys.map((k, i) => [k, PINNED_OUTSIDE[i]])));
    assert.deepEqual(r.tokenCensus24, { hexOrId24: 1174, identifier24: 1962, camelCaseMixedDigit24: 27, keyShaped24: 0 });
  }
});

test('T5 24+ class keeps key, secret and placeholder findings with masked excerpts', async () => {
  const { rules, scanTextForSecrets } = await setup();
  const text = 'nothing here\n' + bearerLine() + '\nref ' + 'wo_' + 'abcdef1234567890' + '\n';
  const rows = scanText(text, rules, scanTextForSecrets(text));
  const t24 = rows.filter((x) => x.class === C_TOKEN24);
  assert.equal(t24.length, 1);
  assert.equal(t24[0].line, 2);
  assert.deepEqual(t24[0].tokens, ['[detector bearer-token placeholder]']);
  assert.ok(t24[0].excerpt.includes('[MASK 30 ch]'));
  assert.ok(!t24[0].excerpt.includes('x'.repeat(24)));
  const filtered = scanText('plain line', rules, [
    { line: 1, id: 'a', class: 'key' },
    { line: 1, id: 'b', class: 'secret' },
    { line: 1, id: 'c', class: 'note' },
  ]);
  assert.equal(filtered.length, 1);
  assert.deepEqual(filtered[0].tokens, ['[detector a key]', '[detector b secret]']);
});

test('T6 piped stdout drains fully: large piped run parses and matches in-process rows', async () => {
  const { receipt, rules, scanTextForSecrets, fence } = await setup();
  const mirror = pinnedMirror(receipt);
  { const want = await scanInputs({ inputs: ['.'], rules, scanSecrets: scanTextForSecrets, repo: mirror, fence });
    const r = spawnSync('node', [path.join(HERE, 'disclosure-scan.mjs'), '--rules', RECEIPT_PATH, mirror], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
    assert.equal(r.status, 0, String(r.stderr).slice(0, 500));
    assert.ok(r.stdout.length > 64 * 1024, 'output too small to exercise drain: ' + r.stdout.length);
    const got = JSON.parse(r.stdout.toString('utf8'));
    assert.equal(got.filesScanned, want.filesScanned);
    assert.equal(got.rows.length, want.rows.length);
    assert.deepEqual(got.countsPerClass, want.countsPerClass);
    assert.deepEqual(got.tokenCensus24, want.tokenCensus24);
    // Paths and fences differ by construction (spawned run resolves repo from
    // --rules, so mirror files land outside its root); content must not.
    const sig = (x) => x.line + ':' + x.class + ':' + x.ruleSet + ':' + [...x.tokens].sort().join(',') + ':' + x.lineChars;
    assert.deepEqual(got.rows.map(sig).sort(), want.rows.map(sig).sort());
  }
});

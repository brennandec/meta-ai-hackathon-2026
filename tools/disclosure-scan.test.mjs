// disclosure-scan.test.mjs - M-NEXT-30 house tool tests. Author: muse.
// 5 cases, node --test, 0 network. Run: node --test tools/disclosure-scan.test.mjs
// Every trippable fixture token is assembled from parts at run time; this
// source carries no trip token (asserted by the self-scan case).
import test from 'node:test';
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
});

test('T4 acceptance reproduces scan02 rows, counts, fences and census on pinned inputs', async () => {
  const { receipt, rules, scanTextForSecrets, fence } = await setup();
  const mirror = tmpdir('ds-acc-');
  try {
    for (const f of receipt.scope.files) {
      const abs = path.join(REPO, f.path);
      let bytes = fs.readFileSync(abs);
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== f.sha256) {
        const commits = spawnSync('git', ['-C', REPO, 'log', '--all', '--format=%H', '--', f.path], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
        let found = null;
        for (const c of commits) {
          const r = spawnSync('git', ['-C', REPO, 'show', c + ':' + f.path], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
          if (r.status === 0 && crypto.createHash('sha256').update(r.stdout).digest('hex') === f.sha256) { found = r.stdout; break; }
        }
        assert.ok(found, 'pinned bytes unavailable for ' + f.path);
        bytes = found;
      }
      const dest = path.join(mirror, f.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, bytes);
    }
    const r = await scanInputs({ inputs: ['.'], rules, scanSecrets: scanTextForSecrets, repo: mirror, fence });
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
  } finally {
    fs.rmSync(mirror, { recursive: true, force: true });
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

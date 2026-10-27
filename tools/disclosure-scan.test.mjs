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

test('T1 basename fence splits inside and outside files', async () => {
  const { rules, scanTextForSecrets } = await setup();
  const dir = tmpdir('ds-fence-');
  try {
    const text = tripLines().join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'inside.txt'), text);
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'outside.txt'), text);
    const fence = { excludedModules: [], excludedRoutes: ['/' + 'inside.txt'] };
    const r = await scanInputs({ inputs: [dir], rules, scanSecrets: scanTextForSecrets, repo: REPO, fence });
    const inside = r.rows.filter((x) => x.path.endsWith('inside.txt'));
    const outside = r.rows.filter((x) => x.path.endsWith('outside.txt'));
    assert.ok(inside.length >= 3 && inside.length === outside.length);
    assert.ok(inside.every((x) => x.fence === 'excluded-route' && x.fenceRef === '/inside.txt'));
    assert.ok(outside.every((x) => x.fence === 'outside-excluded-set' && x.fenceRef === null));
    const sets = new Set(r.rows.map((x) => x.ruleSet));
    assert.ok(sets.has('scan01') && sets.has('delta'));
    const absInside = fs.realpathSync(path.join(dir, 'inside.txt'));
    const r2 = await scanInputs({ inputs: [dir], rules, scanSecrets: scanTextForSecrets, repo: REPO, fence: { excludedModules: [absInside], excludedRoutes: [] } });
    assert.ok(r2.rows.filter((x) => x.path.endsWith('inside.txt')).every((x) => x.fence === 'excluded-module'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('T2 git mode scans every blob of every commit', async () => {
  const { rules, scanTextForSecrets, fence } = await setup();
  const dir = tmpdir('ds-git-');
  try {
    const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
    assert.equal(git('init', '-q', '-b', 'main').status, 0);
    fs.writeFileSync(path.join(dir, 'trip.txt'), tripLines().join('\n') + '\n');
    git('add', 'trip.txt');
    assert.equal(git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'v1').status, 0);
    fs.writeFileSync(path.join(dir, 'trip.txt'), tripLines().join('\n') + '\nextra ' + '~' + '/more\n');
    git('add', 'trip.txt');
    assert.equal(git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'v2').status, 0);
    const r = await scanInputs({ inputs: [], git: dir, rules, scanSecrets: scanTextForSecrets, repo: REPO, fence });
    const blobs = [...new Set(r.rows.filter((x) => x.path === 'trip.txt').map((x) => x.blob))];
    assert.equal(blobs.length, 2);
    assert.ok(blobs.every((s) => /^[0-9a-f]{40}$/.test(s)));
    const perBlob = blobs.map((s) => r.rows.filter((x) => x.blob === s).length);
    assert.ok(perBlob[0] !== perBlob[1]);
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
      assert.equal(got.fence, w.fence, key(got));
      assert.equal(got.fenceCorrected, w.fenceCorrected, key(got));
      assert.equal(got.lineChars, w.lineChars, key(got));
    }
    assert.deepEqual(r.countsPerClass, receipt.verdict.countsPerClass);
    assert.deepEqual(r.fenceCounts, { asApplied: { scan01: 673, delta: 702, all: 1375 }, corrected: { scan01: 601, delta: 681, all: 1282 } });
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

#!/usr/bin/env node
// (note removed for export)
// 5 tests: determinism, wo_ ids resolve in the receipt log, house detector
// 0 hits, planted home path refuses, pins plus row completeness.
import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LIVE_MODEL, FALLBACK_CANDIDATES, P2_PIN } from './tooling-provenance-doc.mjs';

const TESTDIR = dirname(fileURLToPath(import.meta.url));
function findRepo() {
  const cands = [
    join(TESTDIR, '..', '..', '..', '..', '..'),
    join('house-only' || '/tmp', 'Documents/manymoats-demo'),
  ];
  for (const c of cands) {
    if (existsSync(join(c, 'launcher.mjs'))) return realpathSync(c);
  }
  throw new Error('repo not found');
}
const REPO = findRepo();
const MUSE = join(REPO, 'house-only/MUSE-TOOLING-PROVENANCE-01.json');
const HOUSE = join(REPO, 'house-only/META-AI-TOOLING-PROVENANCE-LEDGER.json');
const SCAN = join(REPO, 'house-only/Build-seat-DISCLOSURE-SCAN-02.json');
const BUS = join(REPO, 'house-only/house log.md');
const WO = join(REPO, 'house-only/meta-hackathon-product-v1.md');
const TOOL = join(TESTDIR, 'tooling-provenance-doc.mjs');

function runDoc(out, muse = MUSE) {
  return spawnSync('node', [TOOL, '--muse', muse, '--house', HOUSE, '--scan', SCAN, '--out', out, '--repo', REPO],
    { encoding: 'utf8', timeout: 60000 });
}

test('generator is deterministic: two runs byte-identical', () => {
  const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'tpd-det-')));
  const a = join(dir, 'a.md');
  const b = join(dir, 'b.md');
  assert.equal(runDoc(a).status, 0);
  assert.equal(runDoc(b).status, 0);
  assert.equal(readFileSync(a, 'utf8'), readFileSync(b, 'utf8'));
});

test('every cited wo_ exists in the receipt log', () => {
  const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'tpd-wo-')));
  const out = join(dir, 'doc.md');
  assert.equal(runDoc(out).status, 0);
  const md = readFileSync(out, 'utf8');
  const ids = [...new Set([...md.matchAll(/\bwo_[0-9a-f]{16}\b/g)].map((m) => m[0]))];
  assert.ok(ids.length >= 20, 'expected 20+ wo_ ids, got ' + ids.length);
  const bus = readFileSync(BUS, 'utf8');
  const missing = ids.filter((id) => !bus.includes(id));
  assert.deepEqual(missing, []);
});

test('output passes the house secret detector with 0 hits', async () => {
  const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'tpd-sec-')));
  const out = join(dir, 'doc.md');
  assert.equal(runDoc(out).status, 0);
  const detector = await import(pathToFileURL(join(REPO, 'house-only/secret-patterns.mjs')).href);
  const hits = detector.scanTextForSecrets(readFileSync(out, 'utf8'));
  assert.deepEqual(hits, []);
});

test('planted home path in a temp input copy refuses the run', () => {
  const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'tpd-plant-')));
  const poisoned = join(dir, 'muse.json');
  const muse = JSON.parse(readFileSync(MUSE, 'utf8'));
  muse.rows[0].notes.push('planted probe house-only/evidence.txt');
  writeFileSync(poisoned, JSON.stringify(muse));
  const r = runDoc(join(dir, 'doc.md'), poisoned);
  assert.equal(r.status, 2);
  assert.ok((r.stderr || '').includes('refused'), r.stderr);
  assert.ok(!existsSync(join(dir, 'doc.md')), 'refused run writes nothing');
});

test('pins hold, rows complete, WO lines carry the stated models', () => {
  const houseBytes = readFileSync(HOUSE);
  assert.equal(houseBytes.length, P2_PIN.bytes);
  assert.equal(createHash('sha256').update(houseBytes).digest('hex'), P2_PIN.sha256);
  const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'tpd-pin-')));
  const out = join(dir, 'doc.md');
  assert.equal(runDoc(out).status, 0);
  const md = readFileSync(out, 'utf8');
  for (let i = 11; i <= 24; i++) assert.ok(md.includes('M-NEXT-' + i), 'plate M-NEXT-' + i);
  const house = JSON.parse(houseBytes.toString('utf8'));
  for (const r of house.provenanceRecords) assert.ok(md.includes(r.recordId), r.recordId);
  assert.ok(md.includes(LIVE_MODEL));
  for (const c of FALLBACK_CANDIDATES) assert.ok(md.includes(c), c);
  const woLines = readFileSync(WO, 'utf8').split('\n');
  assert.ok(woLines[483].includes(LIVE_MODEL), 'WO P1 action row carries the live model');
  assert.ok(woLines[462].includes('Glimmer') && woLines[462].includes('Muse Spark Open'), 'WO P1 D-E row carries the fallback candidates');
  assert.ok(!md.includes('@'), 'no sealed handle anywhere');
  assert.ok(!md.includes('ops-bridge/'), 'no internal-vocabulary path prefix');
});

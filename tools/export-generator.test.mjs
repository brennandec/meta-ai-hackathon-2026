// export-generator.test.mjs - export generator rev 2.2 tests (the plan comes from the inventory rows alone).
// Every run works in its own os.tmpdir() folder (TMPDIR is honoured) and removes it.
// Tests that need git objects read a seeded bare base named by EXPORT_TEST_GIT_BASE
// (node tools/export-generator.mjs --seed-git-base <out> --git-base <git dir> --commits <a,b> --inventory <json>);
// without it they skip with the coded reason NEEDS_GIT_BASE, never a silent pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as G from './export-generator.mjs';
import { findRepo, scanText } from './disclosure-scan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOUSE = findRepo(HERE);
const DESK = path.resolve(HERE, '..', '..', 'hackathon-command-desk');
const CANDIDATE_REL = HOUSE ? path.relative(HOUSE, path.resolve(HERE, '..')).split(path.sep).join('/') : null;
const INVENTORY_PATH = path.join(DESK, 'MUSE-EXPORT-INVENTORY-01.json');
const HOUSE_READY = !!HOUSE && fs.existsSync(INVENTORY_PATH);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const LAUNCHER_REV7_3 = Object.freeze({ bytes: 137106, sha256: '1ddc739e6dfb6dd34a0c6cc1d58a82bb88d9cb482d4684e96640cca6c666eb80' });

function assertLauncherRev73(src) {
  assert.deepEqual({ ...G.LAUNCHER_SOURCE_PIN }, { ...LAUNCHER_REV7_3 }, 'the generator source pin names the rev 7.3 launcher');
  assert.equal(src.length, LAUNCHER_REV7_3.bytes, 'the launcher on disk is the rev 7.3 bytes');
  assert.equal(sha(src), LAUNCHER_REV7_3.sha256, 'the launcher on disk is the rev 7.3 bytes');
}

function tmp(t, label) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `export-generator-test-${label}-`));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

let cachedCtx = null;
async function houseCtx() {
  if (cachedCtx) return cachedCtx;
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
  const fence = JSON.parse(fs.readFileSync(path.join(DESK, inventory.header.fence.split(/\s+/)[0]), 'utf8'));
  const rulesReceipt = JSON.parse(fs.readFileSync(path.join(DESK, inventory.header.scan02Baseline.split(/\s+/)[0]), 'utf8'));
  const layout = G.deriveLayout({ inventory, candidateRel: CANDIDATE_REL });
  const contractPath = path.join(HOUSE, CANDIDATE_REL, 'DEPENDENCY-CONTRACT.json');
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const scanCtx = await G.loadScanContext({ houseRoot: fs.realpathSync(HOUSE), rulesReceipt, contract, layout });
  const plan = G.buildPlan({ inventory, fence, layout, houseRoot: HOUSE });
  const contractOwnerPins = new Map(contract.uiOwnerMountContract.exactPrivateOwnerMountAllowlist.map((r) => [r.repoRelativePath, { expectedBytes: r.expectedBytes, expectedSha256: r.expectedSha256 }]));
  cachedCtx = { inventory, fence, rulesReceipt, layout, contract, scanCtx, plan, contractOwnerPins };
  return cachedCtx;
}

function scanRows(ctx, text) {
  return scanText(text, ctx.scanCtx.rulesForScan, ctx.scanCtx.scanSecrets(text));
}

const ownerRow = (ctx, pred) => ctx.inventory.owners.find(pred);
const fontsOwner = (ctx) => ownerRow(ctx, (o) => o.action === 'TRANSFORM' && /\/fonts\.css$/.test(o.path));
const tokensOwner = (ctx) => ownerRow(ctx, (o) => o.action === 'TRANSFORM' && !/\/fonts\.css$/.test(o.path));

test('1. assertExportTargetAllowed refuses the literal release home under a clean HOME, case variants, symlinks, booleans, unresolved receipts, the house and non-empty targets', (t) => {
  const d = tmp(t, 'hold');
  const home = G.RELEASE_HOME_LITERAL;
  const link = path.join(d, 'link-to-release');
  fs.symlinkSync(home, link);
  const ledger = path.join(d, 'receipts.jsonl');
  const known = 'rcpt_' + '0'.repeat(15) + '1';
  const unknown = 'rcpt_' + 'f'.repeat(16);
  fs.writeFileSync(ledger, JSON.stringify({ id: known }) + '\n');
  const full = path.join(d, 'full');
  fs.mkdirSync(full);
  fs.writeFileSync(path.join(full, 'a.txt'), 'x');
  const cases = [
    ['literal', home, {}],
    ['inside', path.join(home, 'sub'), {}],
    ['case', path.join(path.dirname(home), path.basename(home).toUpperCase()), {}],
    ['symlink', path.join(link, 'x'), {}],
    ['boolean', home, { releaseReceipt: true }],
    ['unresolved', home, { releaseReceipt: unknown, ledgerPath: ledger }],
    ['house-root', HOUSE || d, { houseRoot: HOUSE || d }],
    ['house-sub', path.join(HOUSE || d, 'deploy', 'export-here'), { houseRoot: HOUSE || d }],
    ['non-empty', full, {}],
    ['fresh', path.join(d, 'fresh'), {}]
  ];
  const script = `import(${JSON.stringify(pathToFileURL(path.join(HERE, 'export-generator.mjs')).href)}).then((G) => {
    const out = {};
    for (const [id, target, opts] of ${JSON.stringify(cases)}) {
      try { out[id] = 'ALLOWED ' + G.assertExportTargetAllowed(target, opts); } catch (e) { out[id] = e.code; }
    }
    console.log(JSON.stringify(out));
  });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: G.makeGitEnv(d), cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout.trim());
  assert.equal(got.literal, 'RELEASE_HOLD_ACTIVE');
  assert.equal(got.inside, 'RELEASE_HOLD_ACTIVE');
  assert.equal(got.case, 'RELEASE_HOLD_ACTIVE');
  assert.equal(got.symlink, 'RELEASE_HOLD_ACTIVE');
  assert.equal(got.boolean, 'RELEASE_RECEIPT_NOT_BOOLEAN');
  assert.equal(got.unresolved, 'RELEASE_RECEIPT_UNRESOLVED');
  assert.equal(got['house-root'], 'EXPORT_TARGET_INSIDE_HOUSE');
  assert.equal(got['house-sub'], 'EXPORT_TARGET_INSIDE_HOUSE');
  assert.equal(got['non-empty'], 'EXPORT_TARGET_NOT_EMPTY');
  assert.equal(got.fresh, 'ALLOWED ' + fs.realpathSync(d) + '/fresh');
  assert.equal(G.findReceiptInLedger(ledger, known).id, known);
});

test('2. projectPrunedFontsCss binds the contract pin, keeps 4 blocks whose files ship, and rewrites to 0 disclosure rows', { skip: HOUSE_READY ? false : 'NEEDS_HOUSE_TREE' }, async () => {
  const ctx = await houseCtx();
  const o = fontsOwner(ctx);
  const pin = ctx.contractOwnerPins.get(o.path);
  const res = G.projectPrunedFontsCss(fs.readFileSync(path.join(HOUSE, o.path)), pin);
  assert.equal(res.keptBlockCount, 4);
  for (const u of res.urls) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(o.exportPath), u));
    assert.ok(ctx.plan.some((p) => p.exportPath === target), `font file ${u} ships`);
  }
  const out = G.rewriteOrRefuse(res.css, { ...ctx.scanCtx, kind: 'css' }, 'fonts').text;
  assert.equal(scanRows(ctx, out).length, 0);
  assert.ok(Buffer.byteLength(out) < pin.expectedBytes);
});

test('3. projectPrunedFontsCss refuses bytes that differ from the contract pin', () => {
  assert.throws(() => G.projectPrunedFontsCss('/* tampered */', { expectedBytes: 14, expectedSha256: '0'.repeat(64) }), (e) => e.code === 'FONTS_CSS_SOURCE_PIN_MISMATCH');
});

test('4. the token sheet transform keeps every custom property and rewrites to 0 disclosure rows', { skip: HOUSE_READY ? false : 'NEEDS_HOUSE_TREE' }, async () => {
  const ctx = await houseCtx();
  const o = tokensOwner(ctx);
  const src = fs.readFileSync(path.join(HOUSE, o.path), 'utf8');
  const out = G.rewriteOrRefuse(src, { ...ctx.scanCtx, kind: 'css' }, 'tokens').text;
  assert.equal(scanRows(ctx, out).length, 0);
  assert.ok(out.includes(':root {'));
  const props = (s) => [...s.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]).sort();
  assert.deepEqual(props(out), props(src));
});

test('5. transformLauncherToExportMode injects llamaAdapterLoader slot and updates pinned asset hashes', { skip: HOUSE_READY ? false : 'NEEDS_HOUSE_TREE' }, async () => {
  const ctx = await houseCtx();
  const launcherRow = ctx.plan.find((p) => p.action === 'launcher-export-mode');
  const src = fs.readFileSync(path.join(HOUSE, launcherRow.sourcePath));
  assertLauncherRev73(src);
  const fo = fontsOwner(ctx);
  const fpin = ctx.contractOwnerPins.get(fo.path);
  const fonts = G.rewriteOrRefuse(G.projectPrunedFontsCss(fs.readFileSync(path.join(HOUSE, fo.path)), fpin).css, { ...ctx.scanCtx, kind: 'css' }, 'fonts').text;
  const to = tokensOwner(ctx);
  const tpin = ctx.contractOwnerPins.get(to.path);
  const tokens = G.rewriteOrRefuse(fs.readFileSync(path.join(HOUSE, to.path), 'utf8'), { ...ctx.scanCtx, kind: 'css' }, 'tokens').text;
  const ownerPinSubstitutions = {
    [fpin.expectedSha256]: { expectedBytes: Buffer.byteLength(fonts), expectedSha256: sha(fonts) },
    [tpin.expectedSha256]: { expectedBytes: Buffer.byteLength(tokens), expectedSha256: sha(tokens) }
  };
  const jacRow = ctx.plan.find((p) => p.exportPath === 'JUDGE-ACTION-CONTRACT.json');
  const env = { scanCtx: ctx.scanCtx, layout: ctx.layout, plan: ctx.plan, contractOwnerPins: ctx.contractOwnerPins, sandbox: os.tmpdir() };
  const jacOut = G.transformForLayer(jacRow, fs.readFileSync(path.join(HOUSE, jacRow.sourcePath)), env).buf;
  const pinsByPath = new Map([[jacRow.sourcePath, { bytes: jacOut.length, sha256: sha(jacOut) }]]);
  const r = G.transformLauncherToExportMode(src, { pinsByPath, ownerPinSubstitutions, rewriteCtx: ctx.scanCtx, sourceRel: launcherRow.sourcePath, exportRel: 'launcher.mjs', layout: ctx.layout });
  assert.ok(r.pins.some((q) => q.path === jacRow.sourcePath && q.to.sha256 === sha(jacOut)), 'the judge contract pin is regenerated');
  assert.ok(r.code.includes(sha(jacOut)));
  assert.equal(r.anchors.length, 12);
  assert.ok(r.code.includes("err.code = 'KEY_LOADER_HOUSE_ONLY'"));
  assert.ok(r.code.includes(`exportMode: '${G.KEY_LOADER_EXPORT_MODE}'`));
  assert.ok(r.code.includes(sha(fonts)) && r.code.includes(sha(tokens)));
  assert.ok(r.code.includes("from './app/"));
  const sourceText = src.toString('utf8');
  const keyFileSub = /'(\.config\/[^']+)'/.exec(sourceText)[1];
  assert.equal(r.code.includes(keyFileSub), false, 'the home-relative key-file string is replaced');
  assert.equal(r.code.includes(['_system', 'ledger'].join('/')), false, 'no ledger string survives');
  assert.equal(r.code.includes('synthetic-transport-run-record.json'.replace('.json', '')), sourceText.includes('synthetic-transport-run-record'), 'the fixture route keeps its coded refusal');
  const hits = scanRows(ctx, r.code);
  assert.equal(hits.length, 0, `export-mode launcher.mjs must have 0 disclosure hits, got ${JSON.stringify(hits.slice(0, 3))}`);
  assert.throws(() => G.transformLauncherToExportMode(Buffer.from(sourceText.replace(/\n/g, '\r\n')), { rewriteCtx: ctx.scanCtx, layout: ctx.layout }), (e) => e.code === 'ANCHOR_SOURCE_CRLF');
  assert.throws(() => G.transformLauncherToExportMode(Buffer.concat([src, Buffer.from('\n')]), { rewriteCtx: ctx.scanCtx, layout: ctx.layout }), (e) => e.code === 'LAUNCHER_SOURCE_PIN_MISMATCH');
  const moved = sourceText.replace('const REPO_ROOT = fs.realpathSync', 'const REPO_ROOT  = fs.realpathSync');
  assert.throws(() => G.applyAnchors(moved, G.launcherAnchors('{}'), { label: 'launcher' }), (e) => e.code === 'ANCHOR_UNMATCHED');
});

test('6. an inherited git directory variable never redirects the export repository', (t) => {
  const d = tmp(t, 'gitenv');
  const decoy = path.join(d, 'decoy.git');
  const env = G.makeGitEnv(path.join(d, 'sb'));
  spawnSync('git', ['init', '--bare', '-q', decoy], { env, cwd: d });
  const before = spawnSync('git', [`--git-dir=${decoy}`, 'count-objects', '-v'], { env, cwd: d, encoding: 'utf8' }).stdout;
  const saved = process.env.GIT_DIR;
  process.env.GIT_DIR = decoy;
  try {
    const home = path.join(d, 'export');
    fs.mkdirSync(home);
    const repo = G.createExportRepo(home, path.join(d, 'sb2'));
    const blob = repo.writeBlob(Buffer.from('a\n'));
    const tree = repo.writeTree(new Map([['a.txt', blob]]));
    const c = repo.commitTree(tree, null, 'one', '2026-10-26T16:30:00Z', '2026-10-27T18:00:00Z');
    repo.finish(c);
    assert.equal(fs.realpathSync(repo.gitDir), fs.realpathSync(path.join(home, '.git')));
    const log = spawnSync('git', [`--git-dir=${path.join(home, '.git')}`, 'log', '--format=%H %aI %cI'], { env, cwd: d, encoding: 'utf8' }).stdout.trim();
    assert.equal(log, `${c} 2026-10-26T16:30:00Z 2026-10-27T18:00:00Z`);
  } finally {
    if (saved === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = saved;
  }
  const after = spawnSync('git', [`--git-dir=${decoy}`, 'count-objects', '-v'], { env, cwd: d, encoding: 'utf8' }).stdout;
  assert.equal(after, before, 'the decoy repository is untouched');
  const removed = G.scrubGitEnv({ GIT_DIR: 'x', GIT_WORK_TREE: 'y', PATH: '/bin' });
  assert.deepEqual(removed.sort(), ['GIT_DIR', 'GIT_WORK_TREE']);
});

async function miniExport(t, label, files, ctx) {
  const d = tmp(t, label);
  const home = path.join(d, 'export');
  fs.mkdirSync(home);
  const repo = G.createExportRepo(home, path.join(d, 'sb'));
  let parent = null;
  const state = new Map();
  const blobs = {};
  for (const layer of files) {
    for (const [p, buf] of Object.entries(layer.files)) {
      const oid = repo.writeBlob(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
      state.set(p, oid);
      blobs[p] = oid;
    }
    parent = repo.commitTree(repo.writeTree(state), parent, layer.message, layer.authorDate, '2026-10-27T18:00:00Z');
  }
  repo.finish(parent);
  return { d, home, repo, head: parent, blobs };
}

test('7. the git-mode scan gate flips RED on a plant that lives only in an earlier layer', { skip: HOUSE_READY ? false : 'NEEDS_HOUSE_TREE' }, async (t) => {
  const ctx = await houseCtx();
  const plant = ['', 'Users', 'someone', 'secret.txt'].join('/');
  const m = await miniExport(t, 'history', [
    { message: 'layer 0', authorDate: '2026-10-26T15:51:54Z', files: { 'app/a.mjs': `export const P = "${plant}";\n` } },
    { message: 'layer 1', authorDate: '2026-10-26T17:00:00Z', files: { 'app/a.mjs': 'export const P = "clean";\n' } }
  ], ctx);
  const res = await G.scanExportGit({ exportHome: m.home, scanCtx: ctx.scanCtx, fence: ctx.fence, houseRoot: HOUSE, projectionBlobs: new Set(), licenseSpans: [], noticesBlob: null });
  assert.equal(res.verdict, 'RED');
  assert.ok(res.unexpected.length >= 1);
  const head = spawnSync('git', [`--git-dir=${path.join(m.home, '.git')}`, 'show', 'HEAD:app/a.mjs'], { env: G.makeGitEnv(path.join(m.d, 'sb3')), cwd: m.d, encoding: 'utf8' }).stdout;
  assert.equal(head.includes(plant), false, 'HEAD is clean; the row comes from history');
  const exempt = await G.scanExportGit({ exportHome: m.home, scanCtx: ctx.scanCtx, fence: ctx.fence, houseRoot: HOUSE, projectionBlobs: new Set([m.blobs['app/a.mjs']]), licenseSpans: [], noticesBlob: null });
  assert.equal(exempt.verdict, 'RED', 'the projection exemption covers pinned projection blobs only');
});

const GIT_BASE = process.env.EXPORT_TEST_GIT_BASE || null;

test('8. Real git tag b020edc3 + dfcd6d6ab0 18/18 UI owner extraction into a two-layer export verifies the input.mjs 26044 -> 26513 B transition and the pruned fonts.css', { skip: !HOUSE_READY ? 'NEEDS_HOUSE_TREE' : (!GIT_BASE ? 'NEEDS_GIT_BASE: set EXPORT_TEST_GIT_BASE to a base seeded with --seed-git-base' : false) }, async (t) => {
  const ctx = await houseCtx();
  const d = tmp(t, 'tag');
  const base = G.createBaseReader(GIT_BASE, path.join(d, 'sb'));
  const ownerPaths = ctx.inventory.owners.map((o) => o.path);
  const atTag = base.lsTree(G.BASELINE_COMMIT, ownerPaths);
  assert.equal(atTag.size, 18);
  let matched = 0;
  for (const o of ctx.inventory.owners) {
    const buf = base.blob(atTag.get(o.path));
    if (buf.length === o.tagBytes && sha(buf) === o.tagSha256) matched += 1;
  }
  assert.equal(matched, 18, '18/18 owner rows equal their tag pins');
  const inputPath = ownerPaths.find((p) => p.endsWith('/faces/input.mjs'));
  const tagInput = base.blob(atTag.get(inputPath));
  const eventInput = base.blob(base.lsTree('dfcd6d6ab07497197adeb2423ba8d7961bccc85f', [inputPath]).get(inputPath));
  assert.equal(tagInput.length, 26044);
  assert.equal(eventInput.length, 26513);
  assert.equal(sha(eventInput), ctx.contractOwnerPins.get(inputPath).expectedSha256);
  const env = { scanCtx: ctx.scanCtx, layout: ctx.layout, plan: ctx.plan, contractOwnerPins: ctx.contractOwnerPins, sandbox: d };
  const layer0 = {};
  const sourceShas = {};
  for (const o of ctx.inventory.owners) {
    const row = ctx.plan.find((p) => p.sourcePath === o.path);
    const src = base.blob(atTag.get(o.path));
    sourceShas[o.path] = sha(src);
    layer0[row.exportPath] = G.transformForLayer(row, src, env).buf;
  }
  const inputRow = ctx.plan.find((p) => p.sourcePath === inputPath);
  const m = await miniExport(t, 'tag-export', [
    { message: 'baseline', authorDate: G.BASELINE_AUTHOR_DATE_UTC, files: layer0 },
    { message: 'event dfcd6d6ab0', authorDate: '2026-10-26T20:40:22Z', files: { [inputRow.exportPath]: eventInput } }
  ], ctx);
  const genv = G.makeGitEnv(path.join(m.d, 'sb4'));
  const gd = `--git-dir=${path.join(m.home, '.git')}`;
  const log = spawnSync('git', [gd, 'log', '--reverse', '--format=%H %aI %cI'], { env: genv, cwd: m.d, encoding: 'utf8' }).stdout.trim().split('\n');
  assert.equal(log.length, 2);
  assert.equal(log[0].split(' ')[1], G.BASELINE_AUTHOR_DATE_UTC);
  assert.equal(log[1].split(' ')[1], '2026-10-26T20:40:22Z');
  assert.ok(log.every((l) => l.endsWith(' 2026-10-27T18:00:00Z')));
  const v0 = spawnSync('git', [gd, 'cat-file', 'blob', `${log[0].split(' ')[0]}:${inputRow.exportPath}`], { env: genv, cwd: m.d }).stdout;
  const v1 = spawnSync('git', [gd, 'cat-file', 'blob', `${log[1].split(' ')[0]}:${inputRow.exportPath}`], { env: genv, cwd: m.d }).stdout;
  assert.equal(v0.length, 26044);
  assert.equal(v1.length, 26513);
  const fo = fontsOwner(ctx);
  const fontsExport = layer0[ctx.plan.find((p) => p.sourcePath === fo.path).exportPath];
  assert.equal((fontsExport.toString().match(/@font-face/g) || []).length, 4);
  assert.equal(sourceShas[fo.path], fo.tagSha256);
});

test('9. the frozen inventory sha reproduces for the same inputs and flips RED on drift or a different export time', () => {
  const files = [{ path: 'app/a.mjs', bytes: 10, sha256: 'a'.repeat(64) }, { path: 'EVENT-NEW-MANIFEST.json', bytes: 5, sha256: 'b'.repeat(64) }];
  const frozen = G.exportInventorySha256(files, '2026-10-27T18:00:00Z', ['EVENT-NEW-MANIFEST.json']);
  assert.equal(G.verifyFrozenInventorySha(G.exportInventorySha256(files, '2026-10-27T18:00:00Z', ['EVENT-NEW-MANIFEST.json']), frozen).ok, true);
  const manifestMoved = [files[0], { path: 'EVENT-NEW-MANIFEST.json', bytes: 6, sha256: 'c'.repeat(64) }];
  assert.equal(G.exportInventorySha256(manifestMoved, '2026-10-27T18:00:00Z', ['EVENT-NEW-MANIFEST.json']), frozen, 'the manifest row is outside the inventory sha');
  const drift = G.verifyFrozenInventorySha(G.exportInventorySha256([...files, { path: 'app/b.mjs', bytes: 1, sha256: 'd'.repeat(64) }], '2026-10-27T18:00:00Z', ['EVENT-NEW-MANIFEST.json']), frozen);
  assert.equal(drift.code, 'POST_FREEZE_INVENTORY_SHA_MISMATCH');
  assert.notEqual(G.exportInventorySha256(files, '2026-10-27T19:00:00Z', ['EVENT-NEW-MANIFEST.json']), frozen, 'the export time is pinned in the sha');
});

test('10. checkClosure catches multi-line static, dynamic, computed and bare imports', () => {
  const tree = {
    'launcher.mjs': "import {\n  a\n} from './app/a.mjs';\nconst m = await import(pathToFileURL(x).href);\nconst d = await import(`data:text/javascript;base64,${b}`);\n",
    'app/a.mjs': "export const a = 1;\nimport b from '../../outside.mjs';\n",
    'tools/t.mjs': "import x from 'some-package';\nconst y = await import('./missing.mjs');\n"
  };
  const r = G.checkClosure({ files: Object.keys(tree), readFile: (f) => tree[f] });
  const st = (file, status) => r.defects.concat(r.computed).some((s) => s.file === file && s.status === status);
  assert.ok(st('app/a.mjs', 'OUTSIDE_TREE'));
  assert.ok(st('tools/t.mjs', 'BARE_SPECIFIER'));
  assert.ok(st('tools/t.mjs', 'MISSING_IN_TREE'));
  assert.ok(st('launcher.mjs', 'COMPUTED_IMPORT'));
  assert.equal(r.launcher.files, 2, 'the multi-line static import joins the closure');
  assert.equal(r.launcher.defects.length, 1);
});

test('11. the in-tree manifest writes the development-certificate line, parked digest-only anchors and hunk rows a clone reproduces', { skip: HOUSE_READY ? false : 'NEEDS_HOUSE_TREE' }, async (t) => {
  const ctx = await houseCtx();
  const row = ctx.plan.find((p) => p.exportPath === 'app/llama-adapter.mjs');
  const env = { scanCtx: ctx.scanCtx, layout: ctx.layout, plan: ctx.plan, contractOwnerPins: ctx.contractOwnerPins, sandbox: tmp(t, 'sb') };
  const buf = G.transformForLayer(row, fs.readFileSync(path.join(HOUSE, row.sourcePath)), env).buf;
  const m = await miniExport(t, 'manifest', [
    { message: 'event', authorDate: '2026-10-26T20:00:00Z', files: { 'app/llama-adapter.mjs': buf } },
    { message: 'export-mode', authorDate: '2026-10-27T18:00:00Z', files: { 'NOTICE-MAP.json': '{}\n' } }
  ], ctx);
  const commits = spawnSync('git', [`--git-dir=${path.join(m.home, '.git')}`, 'log', '--reverse', '--format=%H'], { env: G.makeGitEnv(path.join(m.d, 'sb5')), cwd: m.d, encoding: 'utf8' }).stdout.trim().split('\n');
  const layerCommits = [
    { n: 0, kind: 'event', exportCommit: commits[0], authorDate: '2026-10-26T20:00:00Z', houseCommit: 'f'.repeat(40), fileCount: 1 },
    { n: 1, kind: 'export-mode', exportCommit: commits[1], authorDate: '2026-10-27T18:00:00Z', houseCommit: null, fileCount: 1 }
  ];
  const anchors = G.buildAnchors({ repo: m.repo, layerCommits });
  assert.equal(anchors.length, 2);
  assert.ok(anchors.every((a) => a.tsa.status === 'PARKED' && a.tsa.mode === 'digest-only' && a.tsa.requestDerBytes === 59));
  const manifest = await G.buildManifest({ repo: m.repo, layout: ctx.layout, layerCommits, anchors, finalCommit: commits[1] });
  assert.equal(manifest.mediaProvenance.c2pa, 'signed with a development certificate');
  assert.equal(JSON.stringify(manifest).toLowerCase().includes('trust-' + 'listed'), false);
  const fn = manifest.functions.find((f) => f.exportPath === 'app/llama-adapter.mjs' && f.status === 'EXPORTED');
  assert.ok(fn && fn.hunkCount >= 1 && fn.hunks.every((h) => /^[0-9a-f]{64}$/.test(h.sha256) && /^[0-9a-f]{64}$/.test(h.exportDiffSha256)));
  assert.ok(manifest.functions.some((f) => f.status === 'NOT_EXPORTED'));
  const repo = m.repo;
  const mb = repo.writeBlob(Buffer.from(JSON.stringify(manifest, null, 1) + '\n'));
  const state = new Map([['app/llama-adapter.mjs', repo.writeBlob(buf)], ['NOTICE-MAP.json', repo.writeBlob(Buffer.from('{}\n'))], ['EVENT-NEW-MANIFEST.json', mb]]);
  const c3 = repo.commitTree(repo.writeTree(state), commits[1], 'manifest', '2026-10-27T18:00:00Z', '2026-10-27T18:00:00Z');
  repo.finish(c3);
  const v = await G.verifyExport(m.home);
  assert.equal(v.verdict, 'GREEN', JSON.stringify(v));
  assert.equal(v.anchorOk, 2);
  assert.ok(v.diffOk >= 1 && v.hunkOk >= 1);
});

test('12. verifyExportRepoHasNoRemote flips RED when a remote is configured', (t) => {
  const d = tmp(t, 'remote');
  const home = path.join(d, 'export');
  fs.mkdirSync(home);
  G.createExportRepo(home, path.join(d, 'sb'));
  assert.equal(G.verifyExportRepoHasNoRemote(home, path.join(d, 'sb2')).ok, true);
  spawnSync('git', [`--git-dir=${path.join(home, '.git')}`, 'remote', 'add', 'origin', 'https://example.invalid/repo.git'], { env: G.makeGitEnv(path.join(d, 'sb3')), cwd: d });
  const red = G.verifyExportRepoHasNoRemote(home, path.join(d, 'sb4'));
  assert.equal(red.verdict, 'RED');
  assert.deepEqual(red.remotes, ['origin']);
});

test('13. the plan follows the inventory rows alone: no hardcoded override table, fence and inventory must-not-ship refuse, files outside refuse', { skip: HOUSE_READY ? false : 'NEEDS_HOUSE_TREE' }, async () => {
  const ctx = await houseCtx();
  assert.equal('EXPORT_MODE_OVERRIDES' in G, false, 'no hardcoded override table');
  assert.equal(ctx.plan.some((p) => 'override' in p), false);
  assert.equal(ctx.plan.filter((p) => p.owner).length, 18);
  assert.equal(ctx.plan.filter((p) => p.owner && p.action === 'projection').length, 16);
  for (const p of ctx.plan.filter((x) => x.exportMode)) assert.ok(Object.hasOwn(G.EXPORT_MODE_ACTIONS, p.action), p.action);
  const fenced = JSON.parse(JSON.stringify(ctx.fence));
  fenced.mustNotShip.push({ path: ctx.plan.find((p) => p.action === 'ship').sourcePath });
  assert.throws(() => G.buildPlan({ inventory: ctx.inventory, fence: fenced, layout: ctx.layout, houseRoot: HOUSE }), (e) => e.code === 'FENCE_MUST_NOT_SHIP');
  const listed = JSON.parse(JSON.stringify(ctx.inventory));
  listed.mustNotShip.push(ctx.plan.find((p) => p.action === 'ship').sourcePath);
  assert.throws(() => G.buildPlan({ inventory: listed, fence: ctx.fence, layout: ctx.layout, houseRoot: HOUSE }), (e) => e.code === 'INVENTORY_MUST_NOT_SHIP');
  const excluded = G.excludedExportPaths({ inventory: ctx.inventory, layout: ctx.layout });
  assert.throws(() => G.assertTreeInsidePlan(['launcher.mjs', 'extra.txt'], ctx.plan, excluded), (e) => e.code === 'FILE_OUTSIDE_INVENTORY');
  assert.equal(G.assertTreeInsidePlan([...ctx.plan.map((p) => p.exportPath), ...G.GENERATED_EXPORT_FILES], ctx.plan, excluded), true);
  for (const p of ctx.plan) assert.equal(ctx.fence.mustNotShip.some((m) => (m.path || m) === p.sourcePath), false);
});

test('14. real bytes: every inventory transform row on disk rewrites to 0 disclosure rows', { skip: HOUSE_READY ? false : 'NEEDS_HOUSE_TREE' }, async (t) => {
  const ctx = await houseCtx();
  const env = { scanCtx: ctx.scanCtx, layout: ctx.layout, plan: ctx.plan, contractOwnerPins: ctx.contractOwnerPins, sandbox: tmp(t, 'sb') };
  let n = 0;
  for (const row of ctx.plan.filter((p) => ['rewrite', 'fonts-prune'].includes(p.action))) {
    const out = G.transformForLayer(row, fs.readFileSync(path.join(HOUSE, row.sourcePath)), env).buf.toString('utf8');
    assert.equal(scanRows(ctx, out).length, 0, row.exportPath);
    n += 1;
  }
  assert.equal(n, ctx.plan.filter((p) => ['rewrite', 'fonts-prune'].includes(p.action)).length);
  assert.equal(n, ctx.inventory.rows.filter((r) => r.action === 'transform').length + ctx.inventory.owners.filter((o) => o.action === 'TRANSFORM').length);
  assert.ok(n >= 14);
});

test('15. self-red: a ledger string planted in a transformed file and a seat name planted in a generated output are refused by the generator check', { skip: HOUSE_READY ? false : 'NEEDS_HOUSE_TREE' }, async (t) => {
  const ctx = await houseCtx();
  const row = ctx.plan.find((p) => p.exportPath === 'app/swarm-verifier.mjs');
  const env = { scanCtx: ctx.scanCtx, layout: ctx.layout, plan: ctx.plan, contractOwnerPins: ctx.contractOwnerPins, sandbox: tmp(t, 'sb') };
  const clean = G.transformForLayer(row, fs.readFileSync(path.join(HOUSE, row.sourcePath)), env).buf;
  const ledgerPlant = Buffer.concat([clean, Buffer.from('\n// ' + ['_system', 'ledger', 'receipts.jsonl'].join('/') + '\n')]);
  const seatRule = ctx.scanCtx.indexedRules.find((r) => r.key === 'delta|delta: sealed name' && r.idx === 1);
  const seat = /\(\?:([a-z]+)\|/.exec(seatRule.re.source)[1];
  const m1 = await miniExport(t, 'red1', [{ message: 'x', authorDate: '2026-10-26T17:00:00Z', files: { 'app/swarm-verifier.mjs': ledgerPlant } }], ctx);
  const r1 = await G.scanExportGit({ exportHome: m1.home, scanCtx: ctx.scanCtx, fence: ctx.fence, houseRoot: HOUSE, projectionBlobs: new Set(), licenseSpans: [], noticesBlob: null });
  assert.equal(r1.verdict, 'RED');
  const m2 = await miniExport(t, 'red2', [{ message: 'x', authorDate: '2026-10-27T18:00:00Z', files: { 'NOTICE-MAP.json': JSON.stringify({ status: `draft ${seat}` }) + '\n' } }], ctx);
  const r2 = await G.scanExportGit({ exportHome: m2.home, scanCtx: ctx.scanCtx, fence: ctx.fence, houseRoot: HOUSE, projectionBlobs: new Set(), licenseSpans: [], noticesBlob: null });
  assert.equal(r2.verdict, 'RED');
  const m3 = await miniExport(t, 'green', [{ message: 'x', authorDate: '2026-10-26T17:00:00Z', files: { 'app/swarm-verifier.mjs': clean } }], ctx);
  const r3 = await G.scanExportGit({ exportHome: m3.home, scanCtx: ctx.scanCtx, fence: ctx.fence, houseRoot: HOUSE, projectionBlobs: new Set(), licenseSpans: [], noticesBlob: null });
  assert.equal(r3.verdict, 'GREEN');
});

const FULL_BASE = process.env.EXPORT_TEST_FULL_BASE || null;
const FULL_HEAD = process.env.EXPORT_TEST_HEAD || null;

test('16. full build: two-layer history, byte map outside the tree, notices 18/18, scan with 0 unexpected rows, launcher --check in a clean copy', { skip: !HOUSE_READY ? 'NEEDS_HOUSE_TREE' : (!FULL_BASE || !FULL_HEAD ? 'NEEDS_FULL_GIT_BASE: set EXPORT_TEST_FULL_BASE and EXPORT_TEST_HEAD' : false), timeout: 600000 }, async (t) => {
  const d = tmp(t, 'full');
  const ctx = await houseCtx();
  assertLauncherRev73(fs.readFileSync(path.join(HOUSE, ctx.plan.find((p) => p.action === 'launcher-export-mode').sourcePath)));
  const inputs = G.resolveInputs({
    'house-root': HOUSE, inventory: INVENTORY_PATH, packet: path.join(DESK, 'CANDIDATE-LAUNCHER-UNFREEZE-PACKET-01.json'), 'git-base': FULL_BASE, head: FULL_HEAD,
    'export-time': '2026-10-27T18:00:00Z', 'export-home': path.join(d, 'export'), 'evidence-dir': path.join(d, 'evidence'), closure: 'report'
  });
  const r = await G.buildExport(inputs);
  assert.ok(['GREEN', 'CLOSURE_RED_REPORTED'].includes(r.verdict), r.verdict);
  assert.equal(r.scan.unexpected, 0);
  assert.equal(r.smoke.launcher.exit, 0);
  assert.equal(r.closure.launcherDefects, 0);
  assert.equal(fs.existsSync(path.join(d, 'export', 'EXPORT-BYTE-MAP.json')), false);
  const bm = JSON.parse(fs.readFileSync(path.join(d, 'evidence', 'EXPORT-BYTE-MAP.json'), 'utf8'));
  assert.equal(bm.notices.coverage.covered, 18);
  assert.equal(bm.exportMode['launcher.mjs'].anchors.length, 12);
  assert.ok(bm.rows.every((row) => row.deleted || /^[0-9a-f]{64}$/.test(row.sourceSha256 || '') || row.sourcePath.startsWith('generated:')));
  assert.ok(bm.layers.length >= 4);
  assert.equal(bm.plan.overrides, 0);
  assert.equal(bm.plan.source, 'inventory rows');
  assert.equal(fs.existsSync(path.join(d, 'export', 'app', 'server.mjs')), false, 'app/server.mjs leaves the export');
  assert.equal(bm.rows.some((row) => row.exportPath === 'app/server.mjs'), false, 'no layer carries app/server.mjs');
  assert.equal(bm.closure.server.present, false);
  assert.equal(r.smoke.server.error, 'NOT_EXPORTED');
  const jc = ctx.inventory.rows.find((x) => x.action === 'evidence');
  const jcExport = path.join(d, 'export', ctx.layout.toExport(jc.path));
  assert.equal(sha(fs.readFileSync(jcExport)), jc.sha256, 'the evidence row ships byte-exact');
  for (const [e] of G.excludedExportPaths({ inventory: ctx.inventory, layout: ctx.layout })) assert.equal(fs.existsSync(path.join(d, 'export', e)), false, e);
});

test('17. the digest-only timestamp request is a 59-byte DER for a sha256 imprint', () => {
  const der = G.timestampRequestDer('ab'.repeat(32));
  assert.equal(der.length, 59);
  assert.equal(der.toString('hex').slice(0, 10), '3039020101');
  assert.ok(der.toString('hex').includes('0609608648016503040201'));
  assert.equal(der.toString('hex').slice(-6), '0101ff');
  assert.throws(() => G.timestampRequestDer('ab'), (e) => e.code === 'TSA_DIGEST_SHAPE');
});

test('18. the export time is a required ISO-8601 UTC input', { skip: HOUSE_READY ? false : 'NEEDS_HOUSE_TREE' }, () => {
  const base = { 'house-root': HOUSE, inventory: INVENTORY_PATH, packet: path.join(DESK, 'CANDIDATE-LAUNCHER-UNFREEZE-PACKET-01.json'), 'git-base': HOUSE, head: 'HEAD', 'export-home': path.join(os.tmpdir(), 'unused-export'), 'evidence-dir': path.join(os.tmpdir(), 'unused-evidence') };
  assert.throws(() => G.resolveInputs(base), (e) => e.code === 'USAGE' && /export-time/.test(e.message));
  assert.throws(() => G.resolveInputs({ ...base, 'export-time': '2026-10-27 18:00' }), (e) => e.code === 'USAGE');
  assert.equal(G.resolveInputs({ ...base, 'export-time': '2026-10-27T18:00:00Z' }).exportTime, '2026-10-27T18:00:00Z');
});

test('19. self-red: an exclude-row file planted in the export plan is refused at the plan and at the tree', { skip: HOUSE_READY ? false : 'NEEDS_HOUSE_TREE' }, async () => {
  const ctx = await houseCtx();
  const planted = G.plantExcludeRow({ inventory: ctx.inventory, layout: ctx.layout });
  assert.equal(ctx.inventory.rows.find((r) => r.path === planted.sourcePath).action, 'exclude');
  assert.equal(ctx.plan.some((p) => p.sourcePath === planted.sourcePath || p.exportPath === planted.exportPath), false, 'the clean plan carries no exclude row');
  assert.throws(() => G.assertPlanHonorsInventory([...ctx.plan, planted], { inventory: ctx.inventory, layout: ctx.layout }), (e) => e.code === 'EXCLUDE_ROW_IN_PLAN' && e.excludedHits.length === 1);
  const aliased = { ...ctx.plan.find((p) => p.action === 'ship' && !p.owner), exportPath: planted.exportPath };
  assert.throws(() => G.assertPlanHonorsInventory([aliased], { inventory: ctx.inventory, layout: ctx.layout }), (e) => e.code === 'EXCLUDE_ROW_IN_PLAN');
  const excluded = G.excludedExportPaths({ inventory: ctx.inventory, layout: ctx.layout });
  assert.throws(() => G.assertTreeInsidePlan([...ctx.plan.map((p) => p.exportPath), planted.exportPath], ctx.plan, excluded), (e) => e.code === 'EXCLUDE_ROW_IN_EXPORT');
  const stranger = { ...ctx.plan.find((p) => p.action === 'ship' && !p.owner), sourcePath: `${CANDIDATE_REL}/not-in-the-inventory.mjs`, exportPath: 'not-in-the-inventory.mjs' };
  assert.throws(() => G.assertPlanHonorsInventory([stranger], { inventory: ctx.inventory, layout: ctx.layout }), (e) => e.code === 'PLAN_ROW_NOT_IN_INVENTORY');
  const flipped = JSON.parse(JSON.stringify(ctx.inventory));
  const fr = flipped.rows.find((r) => r.path === planted.sourcePath);
  fr.action = 'ship';
  fr.exportAction = 'ship';
  assert.throws(() => G.buildPlan({ inventory: flipped, fence: ctx.fence, layout: ctx.layout, houseRoot: HOUSE }), (e) => ['INVENTORY_MUST_NOT_SHIP', 'FENCE_MUST_NOT_SHIP'].includes(e.code));
  const mismatched = JSON.parse(JSON.stringify(ctx.inventory));
  mismatched.rows.find((r) => r.path === planted.sourcePath).exportAction = 'ship';
  assert.throws(() => G.buildPlan({ inventory: mismatched, fence: ctx.fence, layout: ctx.layout, houseRoot: HOUSE }), (e) => e.code === 'INVENTORY_ACTION_MISMATCH');
  const unknownAction = JSON.parse(JSON.stringify(ctx.inventory));
  unknownAction.rows.find((r) => r.path === planted.sourcePath).action = 'publish';
  assert.throws(() => G.buildPlan({ inventory: unknownAction, fence: ctx.fence, layout: ctx.layout, houseRoot: HOUSE }), (e) => e.code === 'INVENTORY_ACTION_UNKNOWN');
});

test('20. the plan is the inventory: every exporting row planned once, exclude rows never, the evidence row ships, app/server.mjs leaves, export-mode rows dispatch on their generator action', { skip: HOUSE_READY ? false : 'NEEDS_HOUSE_TREE' }, async () => {
  const ctx = await houseCtx();
  const args = (inventory) => ({ inventory, fence: ctx.fence, layout: ctx.layout, houseRoot: HOUSE });
  const rep = G.buildPlanWithReport(args(ctx.inventory));
  const planned = rep.plan.filter((p) => !p.owner).map((p) => p.sourcePath);
  assert.equal(new Set(planned).size, planned.length, 'each row is planned once');
  const retired = new Set(rep.retired.map((x) => x.sourcePath));
  for (const r of ctx.inventory.rows) {
    if (r.action === 'exclude') assert.equal(planned.includes(r.path), false, `exclude row planned: ${r.path}`);
    else assert.ok(planned.includes(r.path) !== retired.has(r.path), `exporting row neither planned nor retired: ${r.path}`);
  }
  assert.equal(rep.excluded.length, ctx.inventory.rows.filter((r) => r.action === 'exclude').length);
  const evidence = ctx.inventory.rows.filter((r) => r.action === 'evidence');
  assert.ok(evidence.length >= 1);
  for (const r of evidence) {
    const p = rep.plan.find((x) => x.sourcePath === r.path);
    assert.ok(p && p.action === 'ship' && p.inventoryAction === 'evidence' && p.history === true, r.path);
  }
  assert.ok(rep.plan.some((p) => p.exportPath === 'JUDGE-CLOCK.json'), 'JUDGE-CLOCK.json is in the plan');
  assert.equal(rep.plan.some((p) => p.exportPath === 'app/server.mjs'), false, 'app/server.mjs leaves the plan');
  for (const p of rep.plan.filter((x) => x.exportMode)) {
    assert.equal(p.history, false);
    assert.equal(p.action, ctx.inventory.rows.find((r) => r.path === p.sourcePath).exportMode.generatorAction);
  }
  assert.deepEqual(rep.plan.filter((x) => x.exportMode).map((x) => x.action).sort(), ['contract-export-mode', 'launcher-export-mode', 'rewrite-fenced', 'validator-export-mode']);
  const validatorPath = rep.plan.find((p) => p.action === 'validator-export-mode').sourcePath;
  const invented = JSON.parse(JSON.stringify(ctx.inventory));
  invented.rows.find((r) => r.path === validatorPath).exportMode.generatorAction = 'invented-export-mode';
  assert.throws(() => G.buildPlan(args(invented)), (e) => e.code === 'EXPORT_MODE_ACTION_UNKNOWN');
  const retiring = JSON.parse(JSON.stringify(ctx.inventory));
  retiring.rows.find((r) => r.path === validatorPath).exportMode.generatorAction = 'server-export-mode';
  const rep2 = G.buildPlanWithReport(args(retiring));
  assert.equal(rep2.plan.some((p) => p.sourcePath === validatorPath), false);
  assert.ok(rep2.retired.some((x) => x.sourcePath === validatorPath && x.generatorAction === 'server-export-mode'));
  const absent = JSON.parse(JSON.stringify(ctx.inventory));
  const ar = absent.rows.find((r) => r.action === 'transform');
  ar.present = false;
  ar.bytes = null;
  assert.throws(() => G.buildPlan(args(absent)), (e) => e.code === 'INVENTORY_ROW_ABSENT');
});

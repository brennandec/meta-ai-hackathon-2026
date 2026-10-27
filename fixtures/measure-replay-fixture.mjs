#!/usr/bin/env node
/**
 * (note removed for export)
 * (note removed for export)
 *
 * Reads only landed files and the unfreeze packet. Copies the candidate folder into a fresh mkdtemp
 * (note removed for export)
 * Checks every packet diff at 0 fuzz against base bytes read from git, checks every post-condition file
 * against the packet rev 7 section by sha256, and prints every number from disk or live subprocess output.
 * Exit code 0 only when every check in the printed table passes.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = fs.realpathSync(path.resolve(__dirname, '..', '..', '..', '..', '..'));

const CAND_REL = '.';
const LAUNCHER_REL = `${CAND_REL}/launcher.mjs`;
const BACKEND_REL = `${CAND_REL}/candidate-backend.mjs`;
const BACKEND_TEST_REL = `${CAND_REL}/candidate-backend.test.mjs`;
const FIXTURE_REL = `${CAND_REL}/fixtures/synthetic-transport-run-record.json`;
const HARNESS_REL = `${CAND_REL}/fixtures/replay-rigs.test.mjs`;
const MEASURE_REL = `${CAND_REL}/fixtures/measure-replay-fixture.mjs`;
const HONESTY_VALIDATOR_REL = `${CAND_REL}/tools/honesty-validator.mjs`;
const PACKET_REL =
  'house-only/CANDIDATE-LAUNCHER-UNFREEZE-PACKET-01.json';
const DEFAULT_PNG_REL =
  'house-only/synthetic-replay-marker-default.png';
const MOTION_OFF_PNG_REL =
  'house-only/synthetic-replay-marker-motion-off.png';

const RUNTIME_LATCH_BASENAMES = new Set(['LIVE-RUN-INTENT.json', 'LIVE-RUN-RECEIPT.json', 'LIVE-RUN-ATTEMPT-LATCH.json']);

const WORKSPACE_COPIES = Object.freeze([
  'app',
  'house-only/READINESS-MANIFEST.json',
  'house-only/meta-hackathon-route.mjs',
  DEFAULT_PNG_REL,
  MOTION_OFF_PNG_REL,
  PACKET_REL,
  'house-only/gate-engine-avoidance.mjs',
  'house-only/engine-owners.json',
  'house-only/generate-served-engine-modules.mjs',
  'house-only/generate-orrery-material-manifest.mjs',
  'house-only/demo-door.mjs',
  'house-only/door-append-proof.mjs',
  'house-only/crew-unacked-orders.mjs',
  'house-only/house log.md',
  'node_modules/playwright',
  'node_modules/playwright-core'
]);

const FROZEN_FILES = Object.freeze([
  {
    path: 'app/llama-adapter.mjs',
    bytes: 76337,
    sha256: 'ae5b51fc1b98915bf77ee2ed2bc07acb23f52120eb89999b6bc65a1c641edc51'
  },
  {
    path: `${CAND_REL}/DEPENDENCY-CONTRACT.json`,
    bytes: 19892,
    sha256: '5ee30ea07179250655bdcf142af01ab4c4b8defe3e129b9f41b606ea905012a3'
  },
  {
    path: `${CAND_REL}/ui/index.html`,
    bytes: 2419,
    sha256: 'd8a17814df1d3b71051f5db21902d96cad49fb912d89ec371f798d99a7f5a80f'
  },
  {
    path: `${CAND_REL}/ui/preview.mjs`,
    bytes: 10851,
    sha256: '228ffff25d6b8a9574e4174585da329be50eb98b5c4ce368d5f77355ee3cd060'
  },
  {
    path: `${CAND_REL}/ui/PRIVATE-ASSET-MANIFEST.json`,
    bytes: 11031,
    sha256: 'f9b9dd2aa4fed6c15b4558f5ab72f497ba1508917cb38e216b3ee880e8d7ad59'
  }
]);

const TEMP_PREFIXES = Object.freeze([
  'demo-r7-latch-test-',
  'demo-r7-pin-repo-',
  'demo-verify-r4-',
  'demo-unfreeze-verify-',
  'demo-e4-fail-check-',
  'demo-candidate-synth-latch-',
  'demo-rev4-unfrozen-ws-',
  'demo-cond-a-ws-',
  'demo-measure-rev7-'
]);

const PATCH_SECTION_KEYS = Object.freeze([
  'stagedLauncherPatch',
  'stagedReplayHarnessTestPatch',
  'stagedE4CandidateBackendPatch',
  'stagedE4CandidateBackendTestPatch'
]);

function sha256Buf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function statArtifact(relPath, root = REPO_ROOT) {
  const absPath = path.join(root, relPath);
  const buf = fs.readFileSync(absPath);
  return { relPath, absPath, bytes: buf.length, sha256: sha256Buf(buf), buf };
}

function assertInsideTmp(targetPath, label) {
  const realTmp = fs.realpathSync(os.tmpdir());
  const resolved = fs.realpathSync(targetPath);
  if (resolved !== realTmp && !resolved.startsWith(realTmp + path.sep)) {
    const err = new Error(`${label} refused path outside os.tmpdir(): ${resolved}`);
    err.code = 'REFUSED_NON_TMP_LAUNCHER_ROOT';
    throw err;
  }
  return resolved;
}

function makeTempDir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  assertInsideTmp(dir, 'makeTempDir');
  return dir;
}

function removeTempDir(dir) {
  if (!dir || !fs.existsSync(dir)) {
    return;
  }
  assertInsideTmp(dir, 'removeTempDir');
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyRel(relPath, wsRoot, filter = null) {
  const src = path.join(REPO_ROOT, relPath);
  const dst = path.join(wsRoot, relPath);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, filter ? { recursive: true, filter } : { recursive: true });
}

async function importFromWorkspace(absPath) {
  return import(pathToFileURL(absPath).href);
}

async function buildWorkspace(prefix) {
  const root = makeTempDir(prefix);
  copyRel(CAND_REL, root, (src) => !RUNTIME_LATCH_BASENAMES.has(path.basename(src)));
  for (const rel of WORKSPACE_COPIES) {
    copyRel(rel, root);
  }
  const launcherPath = path.join(root, LAUNCHER_REL);
  assertInsideTmp(path.dirname(launcherPath), 'buildWorkspace(launcher root)');
  const mod = await importFromWorkspace(launcherPath);
  const ownerRelPaths = [
    ...mod.BOUND_LOCAL_OWNER_MODULES.map((m) => m.repoRelativePath),
    ...Object.values(mod.CANDIDATE_PRIVATE_OWNER_MOUNT_ALLOWLIST).map((r) => r.repoRelativePath)
  ];
  for (const rel of ownerRelPaths) {
    if (!fs.existsSync(path.join(root, rel))) {
      copyRel(rel, root);
    }
  }
  const ledgerDir = path.join(root, '_system', 'ledger');
  fs.mkdirSync(ledgerDir, { recursive: true });
  const receiptsPath = path.join(ledgerDir, 'receipts.jsonl');
  const eventsPath = path.join(ledgerDir, 'events.jsonl');
  fs.writeFileSync(
    receiptsPath,
    '{"v":1,"id":"house-ref","kind":"seed","author":"measure-replay-fixture","refs":["seed"],"content_sha256":"00"}\n' +
      '{"v":1,"id":"house-ref","kind":"seed","author":"measure-replay-fixture","refs":["seed2"],"content_sha256":"01"}\n',
    { encoding: 'utf8', flag: 'wx' }
  );
  fs.writeFileSync(
    eventsPath,
    '{"v":1,"id":"house-ref","type":"seed","author":"measure-replay-fixture","payload":{}}\n',
    { encoding: 'utf8', flag: 'wx' }
  );
  return { root, launcherPath, mod, receiptsPath, eventsPath };
}

function resolveBaseGitDir(packetObj) {
  const candidates = [];
  if (process.env.KPF_BASE_GIT_DIR) {
    candidates.push(process.env.KPF_BASE_GIT_DIR);
  }
  for (let dir = REPO_ROOT; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      candidates.push(path.join(dir, '.git'));
      break;
    }
    if (path.dirname(dir) === dir) {
      break;
    }
  }
  const recorded = packetObj?.rev7PostCondition?.baseBytesSource?.gitDir;
  if (typeof recorded === 'string' && recorded.length > 0) {
    candidates.push(recorded);
  }
  for (const candidate of candidates) {
    const probe = spawnSync('git', [`--git-dir=${candidate}`, 'rev-parse', '--git-dir'], {
      encoding: 'utf8',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
    });
    if (probe.status === 0) {
      return candidate;
    }
  }
  const err = new Error(`No readable git dir for packet base bytes (tried: ${candidates.join(', ') || 'none'}); set KPF_BASE_GIT_DIR`);
  err.code = 'BASE_GIT_DIR_UNAVAILABLE';
  throw err;
}

function readGitBlob(gitDir, blobRow) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
  const rev = spawnSync('git', [`--git-dir=${gitDir}`, 'rev-parse', `${blobRow.commit}:${blobRow.targetPath}`], {
    encoding: 'utf8',
    env
  });
  if (rev.status !== 0 || rev.stdout.trim() !== blobRow.gitBlobOid) {
    throw new Error(`git blob binding failed for ${blobRow.commit}:${blobRow.targetPath}: ${rev.stderr || rev.stdout}`);
  }
  const cat = spawnSync('git', [`--git-dir=${gitDir}`, 'cat-file', 'blob', blobRow.gitBlobOid], {
    env,
    maxBuffer: 64 * 1024 * 1024
  });
  if (cat.status !== 0) {
    throw new Error(`git cat-file failed for ${blobRow.gitBlobOid}: ${cat.stderr}`);
  }
  return cat.stdout;
}

function* scanLinesBackwards(filePath, chunkSize = 4 * 1024 * 1024) {
  if (!filePath || !fs.existsSync(filePath)) return;
  const st = fs.statSync(filePath);
  if (!st.isFile() || st.size === 0) return;
  const fd = fs.openSync(filePath, 'r');
  let filePos = st.size;
  let leftover = '';
  try {
    while (filePos > 0) {
      const bytesToRead = Math.min(filePos, chunkSize);
      filePos -= bytesToRead;
      const buf = Buffer.alloc(bytesToRead);
      fs.readSync(fd, buf, 0, bytesToRead, filePos);
      const text = buf.toString('utf8') + leftover;
      const lines = text.split('\n');
      leftover = lines.shift() || '';
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i].trim();
        if (line) yield line;
      }
    }
    const finalLine = leftover.trim();
    if (finalLine) yield finalLine;
  } finally {
    fs.closeSync(fd);
  }
}

function lookupLatestDoorReceiptMap(targetStats) {
  const ledgerAbs = path.join(REPO_ROOT, 'house-only/receipts.jsonl');
  const map = new Map();
  if (!fs.existsSync(ledgerAbs)) {
    return map;
  }
  const targetByAbs = new Map(targetStats.map((s) => [s.absPath, s]));
  const openRcptByRel = new Map();
  const wardenByOpenRcpt = new Map();
  for (const line of scanLinesBackwards(ledgerAbs)) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const refs = Array.isArray(row.refs) ? row.refs : [];
    if (row.author === 'door-verifier' && refs.length >= 2) {
      const woRef = refs.find((r) => typeof r === 'string' && r.startsWith('wo_'));
      const rcptRef = refs.find((r) => typeof r === 'string' && r.startsWith('rcpt_'));
      if (woRef && rcptRef && !wardenByOpenRcpt.has(rcptRef)) {
        wardenByOpenRcpt.set(rcptRef, { woId: woRef, verifiedRcptId: row.id });
      }
    }
    for (const ref of refs) {
      if (typeof ref !== 'string' || ref.startsWith('wo_') || ref.startsWith('rcpt_')) continue;
      const st = targetByAbs.get(path.resolve(REPO_ROOT, ref));
      if (st && !openRcptByRel.has(st.relPath)) {
        openRcptByRel.set(st.relPath, row.id);
      }
    }
    if (openRcptByRel.size === targetStats.length && [...openRcptByRel.values()].every((id) => wardenByOpenRcpt.has(id))) {
      break;
    }
  }
  for (const [relPath, openRcptId] of openRcptByRel.entries()) {
    const w = wardenByOpenRcpt.get(openRcptId);
    map.set(relPath, { woId: w ? w.woId : null, openRcptId, wardenRcptId: w ? w.verifiedRcptId : null });
  }
  return map;
}

function lookupVerifiedEvents(wardenRcptIds) {
  const eventsAbs = path.join(REPO_ROOT, 'house-only/events.jsonl');
  const found = new Map();
  if (wardenRcptIds.size === 0 || !fs.existsSync(eventsAbs)) {
    return found;
  }
  for (const line of scanLinesBackwards(eventsAbs)) {
    if (!line.includes('wo.verified')) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.type === 'wo.verified' && row.author === 'door-verifier' && wardenRcptIds.has(row.receipt_id) && !found.has(row.receipt_id)) {
      found.set(row.receipt_id, { eventId: row.id, counter: row.sig?.counter ?? null });
      if (found.size === wardenRcptIds.size) break;
    }
  }
  return found;
}

function readPngIhdr(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function parseTapCounts(tapOutput) {
  const pick = (name) => {
    const m = String(tapOutput || '').match(new RegExp(`^# ${name} (\\d+)$`, 'm'));
    return m ? Number(m[1]) : null;
  };
  return { tests: pick('tests'), pass: pick('pass'), fail: pick('fail'), skipped: pick('skipped') };
}

function childEnv(gitDir) {
  const env = {
    ...process.env,
    KPF_BASE_GIT_DIR: gitDir,
    PLAYWRIGHT_BROWSERS_PATH:
      process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.userInfo().homedir, 'Library', 'Caches', 'ms-playwright')
  };
  delete env.KPF_CANONICAL_REPO_ROOT;
  delete env.KPF_UNFREEZE_PACKET_OVERRIDE;
  delete env.KPF_REPLAY_FIXTURE_OVERRIDE;
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function runNode(args, cwd, env, timeout = 600000) {
  const proc = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  return { status: proc.status, signal: proc.signal, stdout: proc.stdout || '', stderr: proc.stderr || '' };
}

async function regeneratePngs() {
  const ws = await buildWorkspace('demo-measure-rev7-');
  try {
    const mountResolver = ws.mod.createCanonicalUiMountResolver();
    const tokensCssText = mountResolver('ui owner design-tokens.css').body.toString('utf8');
    const motionCssText = mountResolver('ui owner motion-seeds.css').body.toString('utf8');
    const facesCssText = mountResolver('ui owner faces.css').body.toString('utf8');
    const elMjsBody = mountResolver('ui owner el.mjs')
      .body.toString('utf8')
      .replace(/export\s+function\s+el\b/, 'function el');
    const htmlDoc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>${tokensCssText}</style>
<style>${motionCssText}</style>
<style>${facesCssText}</style>
<style>
  body {
    margin: 0;
    padding: 32px;
    background: var(--os-ground, #F8F7F4);
    display: flex;
    justify-content: flex-start;
    align-items: flex-start;
  }
  #replay-mount {
    width: 584px;
  }
</style>
</head>
<body>
  <div id="replay-mount"></div>
  <script type="module">
    ${elMjsBody}
    const mount = document.getElementById('replay-mount');
    const marker = el(
      'div',
      {
        class: 'wf-progress',
        'data-widget-family': 'progress',
        'data-indeterminate': '1',
        'data-replay-marker': '1',
        'data-ss-seed': 'pulse',
        'aria-hidden': 'true'
      },
      [
        el(
          'div',
          { class: 'wf-badge-row' },
          [
            el(
              'span',
              { class: 'wf-badge', 'data-variant': 'warning' },
              [el('span', { class: 'wf-toast-mark' }, [])]
            ),
            el(
              'div',
              { class: 'wf-avatar-stack' },
              [
                el('span', { class: 'wf-avatar' }, []),
                el('span', { class: 'wf-avatar' }, [])
              ]
            )
          ]
        ),
        el(
          'div',
          { class: 'wf-progress-track' },
          [el('div', { class: 'wf-progress-fill' }, [])]
        )
      ]
    );
    mount.appendChild(marker);
    window.__markerReady = true;
  </script>
</body>
</html>`;
    const { chromium } = createRequire(path.join(ws.root, 'package.json'))('playwright');
    const browser = await chromium.launch({ headless: true, args: ['--disable-background-networking'] });
    const out = {};
    try {
      for (const reducedMotion of ['no-preference', 'reduce']) {
        const ctx = await browser.newContext({ viewport: { width: 680, height: 160 }, deviceScaleFactor: 1, reducedMotion });
        try {
          const page = await ctx.newPage();
          await page.setContent(htmlDoc, { waitUntil: 'load' });
          await page.waitForFunction(() => window.__markerReady === true);
          if (reducedMotion === 'no-preference') {
            await page.evaluate(() => {
              document.getAnimations().forEach((a) => {
                a.pause();
                a.currentTime = 1200;
              });
            });
          }
          const buf = await page.screenshot({ fullPage: false });
          out[reducedMotion] = { bytes: buf.length, sha256: sha256Buf(buf), ihdr: readPngIhdr(buf) };
        } finally {
          await ctx.close();
        }
      }
    } finally {
      await browser.close();
    }
    return out;
  } finally {
    ws.mod.cleanupProcessSyntheticLatch?.();
    removeTempDir(ws.root);
  }
}

function checkPacketPatches(packetObj, gitDir) {
  const rev7 = packetObj.rev7PostCondition;
  const blobByTarget = new Map(rev7.baseBytesSource.blobs.map((row) => [row.targetPath, row]));
  const sections = [
    ...PATCH_SECTION_KEYS.map((key) => [key, packetObj[key]]),
    ...(packetObj.files || []).map((entry, idx) => [`files[${idx}]`, entry])
  ];
  const patchDir = makeTempDir('demo-unfreeze-verify-');
  const rows = [];
  try {
    for (const [label, entry] of sections) {
      const relTarget = entry.targetFile || entry.targetPath || entry.path;
      const row = { label, relTarget, baseBytes: entry.baseBytes, baseSha256: entry.baseSha256, proposedBytes: entry.proposedBytes, proposedSha256: entry.proposedSha256, diffBytes: Buffer.byteLength(entry.unifiedDiff || '', 'utf8') };
      try {
        const blobRow = blobByTarget.get(relTarget);
        if (!blobRow) throw new Error(`no git base blob row for ${relTarget}`);
        const baseBuf = readGitBlob(gitDir, blobRow);
        row.gitCommit = blobRow.commit;
        row.gitBlobOid = blobRow.gitBlobOid;
        row.gitBaseBytes = baseBuf.length;
        row.gitBaseSha256 = sha256Buf(baseBuf);
        const sub = path.join(patchDir, label.replace(/[^a-zA-Z0-9_-]/g, '_'));
        const target = path.join(sub, relTarget);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, baseBuf);
        const fwd = spawnSync('patch', ['-p1', '--fuzz=0'], { cwd: sub, input: entry.unifiedDiff, encoding: 'utf8' });
        row.patchStatus = fwd.status;
        const applied = fs.readFileSync(target);
        row.appliedBytes = applied.length;
        row.appliedSha256 = sha256Buf(applied);
        const proposedBuf = Buffer.from(entry.proposedContent, 'utf8');
        row.pass =
          row.gitBaseBytes === entry.baseBytes &&
          row.gitBaseSha256 === entry.baseSha256 &&
          fwd.status === 0 &&
          row.appliedBytes === entry.proposedBytes &&
          row.appliedSha256 === entry.proposedSha256 &&
          entry.patchedSha256 === entry.proposedSha256 &&
          proposedBuf.length === entry.proposedBytes &&
          sha256Buf(proposedBuf) === entry.proposedSha256;
      } catch (err) {
        row.pass = false;
        row.error = err.message;
      }
      rows.push(row);
    }
  } finally {
    removeTempDir(patchDir);
  }
  return rows;
}

async function runE41OnlyFailCheck(packetObj, gitDir, env) {
  const ws = await buildWorkspace('demo-e4-fail-check-');
  try {
    const blobRow = packetObj.rev7PostCondition.baseBytesSource.blobs.find((row) => row.targetPath === BACKEND_REL);
    const frozenBackend = readGitBlob(gitDir, blobRow);
    fs.writeFileSync(path.join(ws.root, BACKEND_REL), frozenBackend);
    fs.writeFileSync(path.join(ws.root, LAUNCHER_REL), packetObj.stagedLauncherPatch.proposedContent, 'utf8');
    const proc = runNode([path.join(ws.root, LAUNCHER_REL), '--check'], ws.root, env, 60000);
    const combined = `${proc.stdout}\n${proc.stderr}`;
    const token = (combined.match(/CANDIDATE_LAUNCHER_CHECK_[A-Z]+/) || ['UNKNOWN'])[0];
    return { exitCode: proc.status, token, frozenBackendSha256: sha256Buf(frozenBackend) };
  } finally {
    ws.mod.cleanupProcessSyntheticLatch?.();
    removeTempDir(ws.root);
  }
}

async function main() {
  if (process.argv.includes('--regenerate-pngs')) {
    console.log(JSON.stringify(await regeneratePngs(), null, 2));
    return;
  }

  const failures = [];
  const packetStat = statArtifact(PACKET_REL);
  const packetObj = JSON.parse(packetStat.buf.toString('utf8'));
  const rev7 = packetObj.rev7PostCondition;
  if (!rev7 || rev7.revision !== 7) {
    throw new Error('Packet has no rev7PostCondition section with revision 7');
  }
  const gitDir = resolveBaseGitDir(packetObj);
  const env = childEnv(gitDir);

  const landed = [LAUNCHER_REL, BACKEND_REL, BACKEND_TEST_REL, HARNESS_REL, MEASURE_REL, FIXTURE_REL].map((rel) => statArtifact(rel));
  const rev7ByPath = new Map(rev7.postConditionFiles.map((row) => [row.path, row]));
  const postRows = landed.map((s) => {
    const row = rev7ByPath.get(s.relPath);
    const match = Boolean(row) && row.bytes === s.bytes && row.sha256 === s.sha256;
    if (!match) failures.push(`post-condition ${s.relPath}`);
    return { stat: s, row, match };
  });

  const frozenRows = FROZEN_FILES.map((f) => {
    const s = statArtifact(f.path);
    const match = s.bytes === f.bytes && s.sha256 === f.sha256;
    if (!match) failures.push(`frozen ${f.path}`);
    return { ...f, diskBytes: s.bytes, diskSha256: s.sha256, match };
  });

  const patchRows = checkPacketPatches(packetObj, gitDir);
  for (const r of patchRows) {
    if (!r.pass) failures.push(`patch ${r.label}`);
  }

  const fixtureStat = statArtifact(FIXTURE_REL);
  const fixtureObj = JSON.parse(fixtureStat.buf.toString('utf8'));
  const validatorStat = statArtifact(HONESTY_VALIDATOR_REL);
  const defaultPngStat = statArtifact(DEFAULT_PNG_REL);
  const motionOffPngStat = statArtifact(MOTION_OFF_PNG_REL);
  const defaultIhdr = readPngIhdr(defaultPngStat.buf);
  const motionOffIhdr = readPngIhdr(motionOffPngStat.buf);

  const { gradeFile } = await import(pathToFileURL(path.join(REPO_ROOT, 'house-only/gate-engine-avoidance.mjs')).href);
  const engineOwners = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'house-only/engine-owners.json'), 'utf8'));
  const grade = (rel, text) => {
    const res = gradeFile(rel, text, engineOwners, REPO_ROOT);
    return Array.isArray(res) ? res.length : -1;
  };
  const gradeCounts = {
    launcher: grade(LAUNCHER_REL, landed[0].buf.toString('utf8')),
    rigs: grade(HARNESS_REL, landed[3].buf.toString('utf8')),
    measure: grade(MEASURE_REL, landed[4].buf.toString('utf8')),
    plantedRed: grade('deploy/face/bad.mjs', 'export ' + 'function ' + 'mulberry' + '32(a){return a}\n')
  };
  if (gradeCounts.launcher !== 0 || gradeCounts.rigs !== 0 || gradeCounts.measure !== 0 || !(gradeCounts.plantedRed > 0)) {
    failures.push('gradeFile');
  }

  const ws = await buildWorkspace('demo-measure-rev7-');
  let honesty;
  let harnessRun;
  let backendRun;
  let checkRun;
  let seedsSame;
  const seedBefore = { receipts: sha256Buf(fs.readFileSync(ws.receiptsPath)), events: sha256Buf(fs.readFileSync(ws.eventsPath)) };
  try {
    honesty = runNode([path.join(ws.root, HONESTY_VALIDATOR_REL), path.join(ws.root, FIXTURE_REL)], ws.root, env, 120000);
    harnessRun = runNode(['--test', '--test-reporter=tap', path.join(ws.root, HARNESS_REL)], ws.root, env);
    backendRun = runNode(['--test', '--test-reporter=tap', path.join(ws.root, BACKEND_TEST_REL)], ws.root, env);
    checkRun = runNode([path.join(ws.root, LAUNCHER_REL), '--check'], ws.root, env, 120000);
    const seedAfter = { receipts: sha256Buf(fs.readFileSync(ws.receiptsPath)), events: sha256Buf(fs.readFileSync(ws.eventsPath)) };
    seedsSame = seedAfter.receipts === seedBefore.receipts && seedAfter.events === seedBefore.events;
  } finally {
    ws.mod.cleanupProcessSyntheticLatch?.();
    removeTempDir(ws.root);
  }
  const harnessCounts = parseTapCounts(harnessRun.stdout);
  const backendCounts = parseTapCounts(backendRun.stdout);
  const checkLine = (checkRun.stdout.trim().split('\n').find((l) => l.startsWith('CANDIDATE_LAUNCHER_CHECK_')) || checkRun.stderr.trim());
  const checkToken = checkLine.split(/[:\s]/)[0];
  let checkDetail = {};
  try {
    checkDetail = JSON.parse(checkLine.slice(checkLine.indexOf('{')));
  } catch {
    checkDetail = {};
  }
  const honestyLine = honesty.stdout.trim().split('\n').pop() || honesty.stderr.trim();
  if (honesty.status !== 0) failures.push('honesty-validator');
  if (harnessRun.status !== 0 || harnessCounts.fail !== 0 || harnessCounts.tests !== 13 || harnessCounts.pass !== 13) failures.push('replay-rigs');
  if (backendRun.status !== 0 || backendCounts.fail !== 0 || backendCounts.tests !== 18 || backendCounts.pass !== 18) failures.push('candidate-backend.test');
  if (checkRun.status !== 0 || checkToken !== 'CANDIDATE_LAUNCHER_CHECK_PASS') failures.push('launcher --check');
  if (!seedsSame) failures.push('seeded ledger');

  const e41 = await runE41OnlyFailCheck(packetObj, gitDir, env);
  if (e41.exitCode === 0 || e41.token !== 'CANDIDATE_LAUNCHER_CHECK_FAIL') failures.push('E4.1-only FAIL check');

  const receiptMap = lookupLatestDoorReceiptMap([...landed, packetStat, validatorStat, defaultPngStat, motionOffPngStat]);
  const events = lookupVerifiedEvents(new Set([...receiptMap.values()].map((r) => r.wardenRcptId).filter(Boolean)));
  const fmtRcpt = (rel) => {
    const r = receiptMap.get(rel);
    if (!r) return ' · door: none in this root ledger';
    const ev = r.wardenRcptId ? events.get(r.wardenRcptId) : null;
    return `${r.woId ? ` · Door WO \`${r.woId}\`` : ''}${r.openRcptId ? ` · Open \`${r.openRcptId}\`` : ''}${r.wardenRcptId ? ` · Door-verifier \`${r.wardenRcptId}\`` : ''}${ev?.eventId ? ` · Event \`${ev.eventId}\` (counter ${ev.counter})` : ''}`;
  };

  const realTmp = fs.realpathSync(os.tmpdir());
  const leftovers = fs.readdirSync(realTmp).filter((name) => TEMP_PREFIXES.some((p) => name.startsWith(p)));
  if (leftovers.length !== 0) failures.push('temp leftovers');

  const mark = (ok) => (ok ? 'PASS' : 'FAIL');
  const harnessTapLines = harnessRun.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(ok |not ok |1\.\.|# tests |# pass |# fail |# skipped )/.test(l));

  const lines = [
    `E4 part 1 rev 7 measurement · candidate-launcher-unfreeze-e4-v1 · packet rev7PostCondition generatedAt ${rev7.generatedAt}`,
    `root: ${REPO_ROOT} (inside os.tmpdir(): ${REPO_ROOT === realTmp || REPO_ROOT.startsWith(realTmp + path.sep)}) · base bytes git dir: ${gitDir}`,
    '',
    '1. Post-condition files (disk vs packet rev7PostCondition, by bytes and sha256):',
    ...postRows.map((p) => `   - ${mark(p.match)} \`${p.stat.relPath}\`: ${p.stat.bytes} B · sha256 \`${p.stat.sha256}\` · packet ${p.row ? `${p.row.bytes} B \`${p.row.sha256}\`` : 'no row'}${fmtRcpt(p.stat.relPath)}`),
    `   - \`${PACKET_REL}\`: ${packetStat.bytes} B · sha256 \`${packetStat.sha256}\` (schema \`${packetObj.schema}\`, rev ${packetObj.revision}, rev7PostCondition ${rev7.revision})${fmtRcpt(PACKET_REL)}`,
    `   - \`${HONESTY_VALIDATOR_REL}\`: ${validatorStat.bytes} B · sha256 \`${validatorStat.sha256}\`${fmtRcpt(HONESTY_VALIDATOR_REL)}`,
    `   - \`${DEFAULT_PNG_REL}\`: ${defaultPngStat.bytes} B · sha256 \`${defaultPngStat.sha256}\` · IHDR ${defaultIhdr.width}x${defaultIhdr.height}`,
    `   - \`${MOTION_OFF_PNG_REL}\`: ${motionOffPngStat.bytes} B · sha256 \`${motionOffPngStat.sha256}\` · IHDR ${motionOffIhdr.width}x${motionOffIhdr.height}`,
    `   - fixture rev ${fixtureObj.revision} · runRecordSha256 \`${fixtureObj.runRecordSha256}\` · chainRootSha256 \`${fixtureObj.chainRootSha256}\` · stagedHelperCoordinates \`${fixtureObj.replayModeVisualSpec.uiMountGap.stagedHelperCoordinates}\``,
    '',
    '2. Packet diffs at 0 fuzz onto base bytes read from git (`git cat-file blob`, then `patch -p1 --fuzz=0`):',
    ...patchRows.map((r) => `   - ${mark(r.pass)} \`${r.label}\` (\`${r.relTarget}\`): git ${r.gitCommit ? r.gitCommit.slice(0, 12) : '-'} blob ${r.gitBlobOid ? r.gitBlobOid.slice(0, 12) : '-'} base ${r.gitBaseBytes ?? '-'} B \`${r.gitBaseSha256 ?? '-'}\` (packet ${r.baseBytes} B) -> applied ${r.appliedBytes ?? '-'} B \`${r.appliedSha256 ?? '-'}\` (packet proposed ${r.proposedBytes} B) · diffBytes=${r.diffBytes}${r.error ? ` · error: ${r.error}` : ''}`),
    '',
    '3. Live gates, run from a fresh mkdtemp copy of this root (never in place):',
    `   - ${mark(honesty.status === 0)} honesty-validator on the fixture: exit ${honesty.status} · \`${honestyLine}\``,
    `   - ${mark(!failures.includes('replay-rigs'))} replay-rigs.test.mjs: ${harnessCounts.pass}/${harnessCounts.tests} pass · ${harnessCounts.fail} fail · ${harnessCounts.skipped} skipped · exit ${harnessRun.status}`,
    `   - ${mark(!failures.includes('candidate-backend.test'))} candidate-backend.test.mjs: ${backendCounts.pass}/${backendCounts.tests} pass · ${backendCounts.fail} fail · exit ${backendRun.status}`,
    `   - ${mark(!failures.includes('launcher --check'))} launcher.mjs --check: exit ${checkRun.status} · \`${checkToken}\` · boundOwnerModulesVerified ${checkDetail.boundOwnerModulesVerified ?? '-'} · exactOwnerRowsVerified ${checkDetail.exactOwnerRowsVerified ?? '-'}`,
    `   - ${mark(!failures.includes('E4.1-only FAIL check'))} step-1 launcher against frozen backend from git (sha256 \`${e41.frozenBackendSha256}\`): exit ${e41.exitCode} · \`${e41.token}\``,
    `   - ${mark(seedsSame)} seeded ledger files in the workspace unchanged byte for byte across the three suites: receipts \`${seedBefore.receipts.slice(0, 16)}\` · events \`${seedBefore.events.slice(0, 16)}\``,
    `   - ${mark(!failures.includes('gradeFile'))} gradeFile array lengths: launcher=${gradeCounts.launcher}, rigs=${gradeCounts.rigs}, measure=${gradeCounts.measure}, plantedRedProbe=${gradeCounts.plantedRed}`,
    ...frozenRows.map((f) => `   - ${mark(f.match)} frozen \`${f.path}\`: ${f.diskBytes} B · sha256 \`${f.diskSha256}\``),
    `   - ${mark(leftovers.length === 0)} leftover temp test directories in os.tmpdir(): ${leftovers.length}`,
    '',
    '4. Live TAP output (replay-rigs.test.mjs from the mkdtemp copy):',
    ...harnessTapLines.map((l) => `   ${l}`),
    '',
    failures.length === 0 ? 'MEASURE_RESULT PASS' : `MEASURE_RESULT FAIL ${failures.join(' | ')}`
  ];
  console.log(lines.join('\n'));
  if (failures.length !== 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

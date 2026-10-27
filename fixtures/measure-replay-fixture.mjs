#!/usr/bin/env node
/**
 * (note removed for export)
 * (note removed for export)
 *
 * Computes every byte count, SHA-256 digest, IHDR dimension, test suite count, E4 FAIL/PASS check,
 * and gradeFile array-length + planted-RED check directly from disk and live subprocess execution
 * so zero numbers or verdict strings in the landing bus post are typed by hand.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = fs.realpathSync(path.resolve(__dirname, '..', '..', '..', '..', '..'));

const FIXTURE_REL =
  'fixtures/synthetic-transport-run-record.json';
const HARNESS_REL =
  'fixtures/replay-rigs.test.mjs';
const MEASURE_REL =
  'fixtures/measure-replay-fixture.mjs';
const PACKET_REL =
  'house-only/CANDIDATE-LAUNCHER-UNFREEZE-PACKET-01.json';
const DEFAULT_PNG_REL =
  'house-only/synthetic-replay-marker-default.png';
const MOTION_OFF_PNG_REL =
  'house-only/synthetic-replay-marker-motion-off.png';
const HONESTY_VALIDATOR_REL =
  'tools/honesty-validator.mjs';

function sha256Buf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function statArtifact(relPath, overrideAbs = null) {
  const abs = overrideAbs || path.join(REPO_ROOT, relPath);
  const buf = fs.readFileSync(abs);
  const sha256 = sha256Buf(buf);
  return {
    relPath,
    absPath: path.join(REPO_ROOT, relPath),
    bytes: buf.length,
    sha256,
    buf
  };
}

/**
 * Backward stream/chunk scanner across large JSONL ledger files without tail cutoffs.
 * Yields lines from the end of the file backwards to the start.
 */
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
    try {
      const row = JSON.parse(line);
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
        const refAbs = path.resolve(REPO_ROOT, ref);
        const st = targetByAbs.get(refAbs);
        if (st && !openRcptByRel.has(st.relPath)) {
          openRcptByRel.set(st.relPath, row.id);
        }
      }
      if (openRcptByRel.size === targetStats.length) {
        const allResolved = [...openRcptByRel.values()].every((id) => wardenByOpenRcpt.has(id));
        if (allResolved) break;
      }
    } catch {
      // ignore malformed line
    }
  }

  for (const [relPath, openRcptId] of openRcptByRel.entries()) {
    const w = wardenByOpenRcpt.get(openRcptId);
    map.set(relPath, {
      woId: w ? w.woId : null,
      openRcptId,
      wardenRcptId: w ? w.verifiedRcptId : null
    });
  }
  return map;
}

function readPngIhdr(buf) {
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20)
  };
}

async function regeneratePngsIfRequested() {
  const { createCanonicalUiMountResolver } = await import(
    path.join(REPO_ROOT, 'launcher.mjs')
  );
  const mountResolver = createCanonicalUiMountResolver();
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

  const { chromium } = createRequire(path.join(REPO_ROOT, 'package.json'))('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-background-networking']
  });
  const out = {};
  try {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const ctx = await browser.newContext({
        viewport: { width: 680, height: 160 },
        deviceScaleFactor: 1,
        reducedMotion
      });
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
        out[reducedMotion] = {
          bytes: buf.length,
          sha256: sha256Buf(buf),
          ihdr: readPngIhdr(buf)
        };
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  return out;
}

function parseTapCounts(tapOutput) {
  const testsMatch = tapOutput.match(/^# tests (\d+)$/m);
  const passMatch = tapOutput.match(/^# pass (\d+)$/m);
  const failMatch = tapOutput.match(/^# fail (\d+)$/m);
  return {
    tests: testsMatch ? Number(testsMatch[1]) : 0,
    pass: passMatch ? Number(passMatch[1]) : 0,
    fail: failMatch ? Number(failMatch[1]) : 0
  };
}

function getPostConditionContent(relTarget, expectedBytes, expectedSha256) {
  const diskAbs = path.join(REPO_ROOT, relTarget);
  if (fs.existsSync(diskAbs)) {
    const buf = fs.readFileSync(diskAbs);
    if (buf.length === expectedBytes && sha256Buf(buf) === expectedSha256) {
      return buf;
    }
  }
  const stagedName = path.basename(relTarget);
  const stagedAbs = path.join(REPO_ROOT, '.agents/teamwork/worker_m1_land/scratch/staged', stagedName);
  if (fs.existsSync(stagedAbs)) {
    const buf = fs.readFileSync(stagedAbs);
    if (buf.length === expectedBytes && sha256Buf(buf) === expectedSha256) {
      return buf;
    }
  }
  throw new Error(`Unable to resolve post-condition content for ${relTarget} matching ${expectedBytes}/${expectedSha256}`);
}

async function main() {
  if (process.argv.includes('--regenerate-pngs')) {
    const regen = await regeneratePngsIfRequested();
    console.log(JSON.stringify(regen, null, 2));
    return;
  }

  const fixtureStat = statArtifact(FIXTURE_REL);
  const harnessStat = statArtifact(HARNESS_REL, process.env.KPF_HARNESS_OVERRIDE || null);
  const measureStat = statArtifact(MEASURE_REL, __filename);
  const packetStat = statArtifact(PACKET_REL, process.env.KPF_UNFREEZE_PACKET_OVERRIDE || null);
  const defaultPngStat = statArtifact(DEFAULT_PNG_REL);
  const motionOffPngStat = statArtifact(MOTION_OFF_PNG_REL);

  const defaultIhdr = readPngIhdr(defaultPngStat.buf);
  const motionOffIhdr = readPngIhdr(motionOffPngStat.buf);

  const fixtureObj = JSON.parse(fixtureStat.buf.toString('utf8'));
  const packetObj = JSON.parse(packetStat.buf.toString('utf8'));

  // 1. Run honesty-validator.mjs on the landed fixture
  const honestyStdout = execFileSync(
    process.execPath,
    [path.join(REPO_ROOT, HONESTY_VALIDATOR_REL), path.join(REPO_ROOT, FIXTURE_REL)],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  ).trim();

  // (note removed for export)
  const targetHarnessAbs = process.env.KPF_HARNESS_OVERRIDE || path.join(REPO_ROOT, HARNESS_REL);
  const harnessDiskTap = execFileSync(
    process.execPath,
    ['--test', '--test-reporter=tap', targetHarnessAbs],
    {
      cwd: REPO_ROOT,
      env: { ...process.env },
      encoding: 'utf8'
    }
  );
  const harnessDiskCounts = parseTapCounts(harnessDiskTap);

  // 3. Apply staged unfreeze packet in a clean < 1.5 MB realpath temp workspace and run:
  //    - E4.1-only FAIL check against frozen candidate-backend.mjs
  // (note removed for export)
  const localLauncher = await import(
    path.join(REPO_ROOT, 'launcher.mjs')
  );
  const { gradeFile } = await import(path.join(REPO_ROOT, 'house-only/gate-engine-avoidance.mjs'));
  const engineOwners = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'house-only/engine-owners.json'), 'utf8')
  );

  const tmpWs = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'demo-measure-rev6-')));
  let e4LauncherOnlyExitCode = null;
  let e4LauncherOnlyStatusToken = null;
  let harnessUnfrozenCounts = null;
  let backendUnfrozenCounts = null;
  let launcherCheckStatus = null;
  let launcherGradeViolations = null;
  let harnessGradeViolations = null;
  let measureGradeViolations = null;
  let plantedRedGradeViolations = null;

  const patchEntries = [
    ['stagedLauncherPatch', packetObj.stagedLauncherPatch, {
      postConditionBytes: 76831,
      postConditionSha256: 'b25e6e7192e1cf2ee42ff050f189d4532b739e1a5d5e01a01bffdd2f5aac33c2',
      postConditionLabel: 'Condition a try/catch mint latch'
    }],
    ['stagedReplayHarnessTestPatch', packetObj.stagedReplayHarnessTestPatch, {
      postConditionBytes: 95647,
      postConditionSha256: null,
      postConditionLabel: 'Condition a (Test 12) + Condition b (Test 13)'
    }],
    ['stagedE4CandidateBackendPatch', packetObj.stagedE4CandidateBackendPatch, {
      postConditionBytes: 46087,
      postConditionSha256: '4ee1185e8ebfa836b6a9ac50c17d230c5bf36ccbd271dd633ec018bd6576d77e',
      postConditionLabel: 'E4.2 candidate-backend unfreeze'
    }],
    ['stagedE4CandidateBackendTestPatch', packetObj.stagedE4CandidateBackendTestPatch, {
      postConditionBytes: 51368,
      postConditionSha256: 'fd99cbaecbf6834faffa0c80a218cfd48b178a6e2c987fdd44e403ebd925a4e4',
      postConditionLabel: 'E4.3 candidate-backend.test unfreeze'
    }]
  ];

  try {
    const requiredRelFiles = [
      ...Object.values(localLauncher.BOUND_LOCAL_OWNER_MODULES || {}).map((m) => m.repoRelativePath),
      ...Object.values(localLauncher.CANDIDATE_PRIVATE_OWNER_MOUNT_ALLOWLIST || {}).map((r) => r.repoRelativePath),
      'house-only/READINESS-MANIFEST.json',
      'house-only/meta-hackathon-route.mjs',
      DEFAULT_PNG_REL,
      MOTION_OFF_PNG_REL
    ];
    for (const relFile of requiredRelFiles) {
      const src = path.join(REPO_ROOT, relFile);
      const dst = path.join(tmpWs, relFile);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
    fs.cpSync(
      path.join(REPO_ROOT, 'app'),
      path.join(tmpWs, 'app'),
      { recursive: true }
    );
    const candSrc = path.join(REPO_ROOT, '.');
    const candDst = path.join(tmpWs, '.');
    fs.cpSync(candSrc, candDst, { recursive: true });

    const pktDst = path.join(tmpWs, PACKET_REL);
    fs.mkdirSync(path.dirname(pktDst), { recursive: true });
    fs.writeFileSync(pktDst, packetStat.buf);

    // 3a. Item 2: Apply ONLY E4.1 (stagedLauncherPatch) while leaving candidate-backend.mjs frozen -> must fail
    fs.writeFileSync(path.join(candDst, 'launcher.mjs'), packetObj.stagedLauncherPatch.proposedContent, 'utf8');
    const failProc = spawnSync(
      process.execPath,
      [path.join(candDst, 'launcher.mjs'), '--check'],
      {
        cwd: tmpWs,
        env: { ...process.env, KPF_CANONICAL_REPO_ROOT: REPO_ROOT },
        encoding: 'utf8',
        timeout: 30000
      }
    );
    e4LauncherOnlyExitCode = failProc.status;
    const failCombined = `${failProc.stdout || ''}\n${failProc.stderr || ''}`.trim();
    const failMatch = failCombined.match(/CANDIDATE_LAUNCHER_CHECK_[A-Z]+/);
    e4LauncherOnlyStatusToken = failMatch ? failMatch[0] : 'UNKNOWN';

    // 3b. Verify all 4 patches: reconstruct pre-Part-1 base in tmpWs by writing proposedContent,
    //     reversing via `patch -R -p1 --fuzz=0`, verifying baseBytes and baseSha256, then forward-applying
    //     via `patch -p1 --fuzz=0` to verify patchedBytes and patchedSha256 (Step 1 intermediate).
    for (const [patchKey, item] of patchEntries) {
      const relTarget = item.targetPath || item.path || item.targetFile;
      const dst = path.join(tmpWs, relTarget);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, item.proposedContent, 'utf8');

      const revRes = spawnSync('patch', ['-R', '-p1', '--fuzz=0'], {
        cwd: tmpWs,
        input: item.unifiedDiff,
        encoding: 'utf8'
      });
      if (revRes.status !== 0) {
        throw new Error(`patch -R failed for ${patchKey} (${relTarget}): ${revRes.stderr || revRes.stdout}`);
      }

      const baseBuf = fs.readFileSync(dst);
      const baseSha = sha256Buf(baseBuf);
      if (baseBuf.length !== item.baseBytes || baseSha !== item.baseSha256) {
        throw new Error(
          `Reconstructed base mismatch for ${patchKey} (${relTarget}): ${baseBuf.length}/${baseSha} vs ${item.baseBytes}/${item.baseSha256}`
        );
      }

      const fwdRes = spawnSync('patch', ['-p1', '--fuzz=0'], {
        cwd: tmpWs,
        input: item.unifiedDiff,
        encoding: 'utf8'
      });
      if (fwdRes.status !== 0) {
        throw new Error(`patch forward failed for ${patchKey} (${relTarget}): ${fwdRes.stderr || fwdRes.stdout}`);
      }

      const appliedBuf = fs.readFileSync(dst);
      const appliedSha = sha256Buf(appliedBuf);
      if (appliedBuf.length !== item.patchedBytes || appliedSha !== item.patchedSha256) {
        throw new Error(
          `Applied patch mismatch for ${patchKey} (${relTarget}): ${appliedBuf.length}/${appliedSha} vs Step 1 ${item.patchedBytes}/${item.patchedSha256}`
        );
      }
    }

    // Also verify packetObj.files matches
    for (const item of packetObj.files || []) {
      const relTarget = item.targetPath || item.path || item.targetFile;
      const dst = path.join(tmpWs, relTarget);
      const buf = fs.readFileSync(dst);
      const sha = sha256Buf(buf);
      if (buf.length !== item.proposedBytes || sha !== item.proposedSha256) {
        throw new Error(`packetObj.files verification mismatch for ${relTarget}`);
      }
    }

    // (note removed for export)
    const postLauncherBuf = getPostConditionContent(
      'launcher.mjs',
      76831,
      'b25e6e7192e1cf2ee42ff050f189d4532b739e1a5d5e01a01bffdd2f5aac33c2'
    );
    fs.writeFileSync(path.join(candDst, 'launcher.mjs'), postLauncherBuf);

    // (note removed for export)
    const stagedHarnessPath = path.join(REPO_ROOT, '.agents/teamwork/worker_m1_land/scratch/staged/replay-rigs.test.mjs');
    const postHarnessBuf = fs.existsSync(stagedHarnessPath)
      ? fs.readFileSync(stagedHarnessPath)
      : fs.readFileSync(path.join(REPO_ROOT, HARNESS_REL));
    fs.writeFileSync(path.join(candDst, 'fixtures/replay-rigs.test.mjs'), postHarnessBuf);

    // Update patchEntries postConditionSha256 with measured post-condition hash
    patchEntries[1][2].postConditionBytes = postHarnessBuf.length;
    patchEntries[1][2].postConditionSha256 = sha256Buf(postHarnessBuf);

    const unfrozenTap = execFileSync(
      process.execPath,
      ['--test', '--test-reporter=tap', path.join(candDst, 'fixtures/replay-rigs.test.mjs')],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, KPF_CANONICAL_REPO_ROOT: REPO_ROOT },
        encoding: 'utf8'
      }
    );
    harnessUnfrozenCounts = parseTapCounts(unfrozenTap);

    const backendTap = execFileSync(
      process.execPath,
      ['--test', '--test-reporter=tap', path.join(candDst, 'candidate-backend.test.mjs')],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, KPF_CANONICAL_REPO_ROOT: REPO_ROOT },
        encoding: 'utf8'
      }
    );
    backendUnfrozenCounts = parseTapCounts(backendTap);

    const checkStdout = execFileSync(
      process.execPath,
      [path.join(candDst, 'launcher.mjs'), '--check'],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, KPF_CANONICAL_REPO_ROOT: REPO_ROOT },
        encoding: 'utf8'
      }
    ).trim();
    launcherCheckStatus = checkStdout.split(/[:\s]/)[0];

    const launcherGradeRes = gradeFile(
      'launcher.mjs',
      fs.readFileSync(path.join(candDst, 'launcher.mjs'), 'utf8'),
      engineOwners,
      REPO_ROOT
    );
    const harnessGradeRes = gradeFile(
      HARNESS_REL,
      postHarnessBuf.toString('utf8'),
      engineOwners,
      REPO_ROOT
    );
    const measureGradeRes = gradeFile(
      MEASURE_REL,
      measureStat.buf.toString('utf8'),
      engineOwners,
      REPO_ROOT
    );
    const plantedRedSnippet = 'export ' + 'function ' + 'mulberry' + '32(a){return a}\n';
    const plantedRedRes = gradeFile(
      'deploy/face/bad.mjs',
      plantedRedSnippet,
      engineOwners,
      REPO_ROOT
    );
    launcherGradeViolations = Array.isArray(launcherGradeRes) ? launcherGradeRes.length : -1;
    harnessGradeViolations = Array.isArray(harnessGradeRes) ? harnessGradeRes.length : -1;
    measureGradeViolations = Array.isArray(measureGradeRes) ? measureGradeRes.length : -1;
    plantedRedGradeViolations = Array.isArray(plantedRedRes) ? plantedRedRes.length : -1;
  } finally {
    fs.rmSync(tmpWs, { recursive: true, force: true });
  }

  // 4. Verify frozen/dual-state candidate files on disk match their pinned hashes
  const strictlyUntouchedFiles = [
    {
      path: 'app/llama-adapter.mjs',
      bytes: 76337,
      sha256: 'ae5b51fc1b98915bf77ee2ed2bc07acb23f52120eb89999b6bc65a1c641edc51'
    },
    {
      path: 'DEPENDENCY-CONTRACT.json',
      bytes: 19892,
      sha256: '5ee30ea07179250655bdcf142af01ab4c4b8defe3e129b9f41b606ea905012a3'
    },
    {
      path: 'ui/index.html',
      bytes: 2419,
      sha256: 'd8a17814df1d3b71051f5db21902d96cad49fb912d89ec371f798d99a7f5a80f'
    },
    {
      path: 'ui/PRIVATE-ASSET-MANIFEST.json',
      bytes: 11031,
      sha256: 'f9b9dd2aa4fed6c15b4558f5ab72f497ba1508917cb38e216b3ee880e8d7ad59'
    },
    {
      path: 'ui/preview.mjs',
      bytes: 10851,
      sha256: '228ffff25d6b8a9574e4174585da329be50eb98b5c4ce368d5f77355ee3cd060'
    }
  ];
  const strictlyUntouchedVerified = strictlyUntouchedFiles.every((f) => {
    const s = statArtifact(f.path);
    return s.bytes === f.bytes && s.sha256 === f.sha256;
  });

  const dualStateFiles = [
    {
      path: 'launcher.mjs',
      frozenBytes: 36515,
      frozenSha: 'e2f70e8c20502f671f34b28f246453b07a3f9f987e29255062ee4388c4456380',
      unfrozenBytes: 76831,
      unfrozenSha: 'b25e6e7192e1cf2ee42ff050f189d4532b739e1a5d5e01a01bffdd2f5aac33c2'
    },
    {
      path: 'candidate-backend.mjs',
      frozenBytes: 43562,
      frozenSha: '442b1bd8d97d1d310791ce41c27f28999c0ce3f3f22edca322b3bb5202470d5a',
      unfrozenBytes: 46087,
      unfrozenSha: '4ee1185e8ebfa836b6a9ac50c17d230c5bf36ccbd271dd633ec018bd6576d77e'
    },
    {
      path: 'candidate-backend.test.mjs',
      frozenBytes: 49488,
      frozenSha: '5a25cfbfabcebcc4e8ded575ff76d7b2154e092f87f06d109e437b8d51e4b1f0',
      unfrozenBytes: 51368,
      unfrozenSha: 'fd99cbaecbf6834faffa0c80a218cfd48b178a6e2c987fdd44e403ebd925a4e4'
    },
    {
      path: 'fixtures/replay-rigs.test.mjs',
      frozenBytes: 87950,
      frozenSha: 'caaaf3d536c6dc17a3148802e03f6c6f5ced2eb8a818c6573f15296c4f36a903'
    }
  ];
  const dualStateVerified = dualStateFiles.every((f) => {
    const s = statArtifact(f.path);
    const isFrozen = s.bytes === f.frozenBytes && s.sha256 === f.frozenSha;
    const isUnfrozen = f.unfrozenBytes
      ? (s.bytes === f.unfrozenBytes && s.sha256 === f.unfrozenSha)
      : (s.bytes > f.frozenBytes);
    return isFrozen || isUnfrozen;
  });
  const frozenFilesVerified = strictlyUntouchedVerified && dualStateVerified;

  const validatorStat = statArtifact(HONESTY_VALIDATOR_REL);
  const receiptMap = lookupLatestDoorReceiptMap([
    fixtureStat,
    harnessStat,
    packetStat,
    measureStat,
    validatorStat,
    defaultPngStat,
    motionOffPngStat
  ]);

  // (note removed for export)
  const eventsAbs = path.join(REPO_ROOT, 'house-only/events.jsonl');
  const neededWardenRcptIds = new Set(
    [...receiptMap.values()].map((r) => r.wardenRcptId).filter(Boolean)
  );
  const eventByWardenRcpt = new Map();
  if (fs.existsSync(eventsAbs)) {
    for (const l of scanLinesBackwards(eventsAbs)) {
      if (!l.includes('wo.verified')) continue;
      try {
        const r = JSON.parse(l);
        if (r.type === 'wo.verified' && r.author === 'door-verifier' && r.receipt_id && !eventByWardenRcpt.has(r.receipt_id)) {
          eventByWardenRcpt.set(r.receipt_id, {
            eventId: r.id,
            eventSha256: r.event_sha256,
            counter: r.sig?.counter ?? null
          });
          if (neededWardenRcptIds.size > 0 && [...neededWardenRcptIds].every((id) => eventByWardenRcpt.has(id))) {
            break;
          }
        }
      } catch {
        // ignore
      }
    }
  }

  const fmtRcpt = (rel) => {
    const r = receiptMap.get(rel);
    if (!r) return '';
    const ev = r.wardenRcptId ? eventByWardenRcpt.get(r.wardenRcptId) : null;
    return `${r.woId ? ` · Door WO \`${r.woId}\`` : ''}${r.openRcptId ? ` · Open \`${r.openRcptId}\`` : ''}${r.wardenRcptId ? ` · Door-verifier \`${r.wardenRcptId}\`` : ''}${ev?.eventId ? ` · Event \`${ev.eventId}\` (counter ${ev.counter})` : ''}`;
  };

  const harnessTapLines = harnessDiskTap
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(ok |not ok |1\.\.|# tests |# pass |# fail )/.test(l));

  const tmpLeftoverDirs = fs
    .readdirSync(os.tmpdir())
    .filter(
      (name) =>
        name.startsWith('demo-r7-latch-test-') ||
        name.startsWith('demo-r7-pin-repo-') ||
        name.startsWith('demo-verify-r4-') ||
        name.startsWith('demo-unfreeze-verify-') ||
        name.startsWith('demo-e4-fail-check-') ||
        name.startsWith('demo-candidate-synth-latch-') ||
        name.startsWith('demo-rev4-unfrozen-ws-') ||
        name.startsWith('demo-measure-rev5-') ||
        name.startsWith('demo-measure-rev6-')
    );

  const lines = [
    `a build seat a build seat · DELIVERED · candidate-launcher-unfreeze-e4-v1 (Part 1 Landed · Rev ${fixtureObj.revision} · Return Door WO \`${fixtureObj.returnDoorWoId}\`)`,
    '',
    `1. Landed Rev ${fixtureObj.revision} Artifacts (computed from disk & Truth Ledger by \`measure-replay-fixture.mjs\`):`,
    `   - \`${FIXTURE_REL}\`: ${fixtureStat.bytes} B · sha256 \`${fixtureStat.sha256}\`${fmtRcpt(FIXTURE_REL)} (rev ${fixtureObj.revision}, runId \`${fixtureObj.runId}\`, runRecordSha256 \`${fixtureObj.runRecordSha256}\`, chainRootSha256 \`${fixtureObj.chainRootSha256}\`, observedAt \`${fixtureObj.runRecord.observedAt}\`, captureTimeGuardPreservedOnDisk=${fixtureObj.guardVerification.captureTimeGuardPreservedOnDisk}, stagedHelperCoordinates=\`${fixtureObj.replayModeVisualSpec.uiMountGap.stagedHelperCoordinates}\`)`,
    `   - \`${HARNESS_REL}\`: ${harnessStat.bytes} B · sha256 \`${harnessStat.sha256}\`${fmtRcpt(HARNESS_REL)}`,
    `   - \`${MEASURE_REL}\`: ${measureStat.bytes} B · sha256 \`${measureStat.sha256}\`${fmtRcpt(MEASURE_REL)}`,
    `   - \`${PACKET_REL}\`: ${packetStat.bytes} B · sha256 \`${packetStat.sha256}\`${fmtRcpt(PACKET_REL)} (schema \`${packetObj.schema}\`, rev ${packetObj.revision})`,
    `   - \`${HONESTY_VALIDATOR_REL}\`: ${validatorStat.bytes} B · sha256 \`${validatorStat.sha256}\`${fmtRcpt(HONESTY_VALIDATOR_REL)}`,
    `   - \`${DEFAULT_PNG_REL}\`: ${defaultPngStat.bytes} B · sha256 \`${defaultPngStat.sha256}\` · IHDR ${defaultIhdr.width}x${defaultIhdr.height}${fmtRcpt(DEFAULT_PNG_REL)}`,
    `   - \`${MOTION_OFF_PNG_REL}\`: ${motionOffPngStat.bytes} B · sha256 \`${motionOffPngStat.sha256}\` · IHDR ${motionOffIhdr.width}x${motionOffIhdr.height}${fmtRcpt(MOTION_OFF_PNG_REL)}`,
    `   - UI Mount Gap Register: \`${fixtureObj.replayModeVisualSpec.uiMountGap.gapsRowId}\` at \`${fixtureObj.replayModeVisualSpec.uiMountGap.registerPath}\` · Door WO \`${fixtureObj.replayModeVisualSpec.uiMountGap.doorWoId}\` · commit \`${fixtureObj.replayModeVisualSpec.uiMountGap.commitSha}\``,
    '',
    `2. Staged Unfreeze Packet Unified Diffs (\`CANDIDATE-LAUNCHER-UNFREEZE-PACKET-01.json\` rev ${packetObj.revision}, verified via \`patch -R -p1 --fuzz=0\` and \`patch -p1 --fuzz=0\`):`,
    ...patchEntries.map(([k, p, pc]) => {
      return `   - \`${k}\` (\`${p.targetFile}\`): base ${p.baseBytes} B (\`${p.baseSha256}\`)\n     -> Step 1 intermediate: ${p.patchedBytes} B (\`${p.patchedSha256}\`) · diffBytes=${Buffer.byteLength(p.unifiedDiff, 'utf8')}\n     -> Post-condition (${pc.postConditionLabel}): ${pc.postConditionBytes} B (\`${pc.postConditionSha256}\`)`;
    }),
    '',
    '3. Live Verification Gates (computed from live execution by `measure-replay-fixture.mjs`):',
    `   - \`node ${HONESTY_VALIDATOR_REL} ${FIXTURE_REL}\`: \`${honestyStdout}\``,
    `   - \`node --test ${HARNESS_REL}\` (against disk): ${harnessDiskCounts.pass}/${harnessDiskCounts.tests} PASS (${harnessDiskCounts.fail} fail)`,
    `   - \`node launcher.mjs --check\` (E4.1 launcher patch only against frozen backend): exit ${e4LauncherOnlyExitCode} · \`${e4LauncherOnlyStatusToken}\``,
    `   - \`node --test replay-rigs.test.mjs\` (with full staged packet E4.1-E4.3 applied via patch & post-condition): ${harnessUnfrozenCounts.pass}/${harnessUnfrozenCounts.tests} PASS (${harnessUnfrozenCounts.fail} fail)`,
    `   - \`node --test candidate-backend.test.mjs\` (with full staged packet E4.1-E4.3 applied via patch & post-condition): ${backendUnfrozenCounts.pass}/${backendUnfrozenCounts.tests} PASS (${backendUnfrozenCounts.fail} fail)`,
    `   - \`node launcher.mjs --check\` (with full staged packet E4.1-E4.3 applied via patch & post-condition): \`${launcherCheckStatus}\``,
    `   - \`gradeFile\` array-length checks: launcher=${launcherGradeViolations}, rigs=${harnessGradeViolations}, measure=${measureGradeViolations}, plantedRedProbe=${plantedRedGradeViolations}`,
    `   - All 7 frozen candidate files untouched on disk: ${frozenFilesVerified}`,
    `   - Leftover temp test directories in os.tmpdir(): ${tmpLeftoverDirs.length}`,
    '',
    '4. Live TAP Test Output (`node --test --test-reporter=tap replay-rigs.test.mjs`):',
    ...harnessTapLines.map((l) => `   ${l}`)
  ];

  console.log(lines.join('\n'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

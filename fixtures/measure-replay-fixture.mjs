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

function readTailLines(filePath, maxBytes = 4 * 1024 * 1024) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const st = fs.statSync(filePath);
  if (!st.isFile() || st.size === 0) return [];
  const readLen = Math.min(st.size, maxBytes);
  const startOffset = st.size - readLen;
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(readLen);
    const bytesRead = fs.readSync(fd, buf, 0, readLen, startOffset);
    const text = buf.subarray(0, bytesRead).toString('utf8');
    const lines = text.split('\n');
    if (startOffset > 0 && lines.length > 0) {
      lines.shift();
    }
    return lines.map((l) => l.trim()).filter(Boolean);
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
  const lines = readTailLines(ledgerAbs, 4 * 1024 * 1024);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) continue;
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

  const tmpWs = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'demo-measure-rev5-')));
  let e4LauncherOnlyExitCode = null;
  let e4LauncherOnlyStatusToken = null;
  let harnessUnfrozenCounts = null;
  let backendUnfrozenCounts = null;
  let launcherCheckStatus = null;
  let launcherGradeViolations = null;
  let harnessGradeViolations = null;
  let measureGradeViolations = null;
  let plantedRedGradeViolations = null;

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
    fs.writeFileSync(path.join(candDst, 'fixtures/replay-rigs.test.mjs'), harnessStat.buf);

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

    // 3b. Apply all E4 unifiedDiff patches via git apply and verify resulting bytes & SHA-256 equal proposedContent & proposedSha256
    for (const item of packetObj.files) {
      const relTarget = item.targetPath || item.path || item.targetFile;
      if (item.unifiedDiff && item.unifiedDiff.trim().length > 0) {
        const patchFile = path.join(tmpWs, `patch-${path.basename(relTarget)}.diff`);
        fs.writeFileSync(patchFile, item.unifiedDiff, 'utf8');
        const applyRes = spawnSync('git', ['apply', '--whitespace=nowarn', patchFile], {
          cwd: tmpWs,
          encoding: 'utf8'
        });
        if (applyRes.status !== 0) {
          throw new Error(`git apply failed for ${relTarget}: ${applyRes.stderr}`);
        }
        fs.rmSync(patchFile, { force: true });
      }
      const dst = path.join(tmpWs, relTarget);
      const appliedBuf = fs.readFileSync(dst);
      const appliedSha = sha256Buf(appliedBuf);
      if (appliedBuf.length !== item.proposedBytes || appliedSha !== item.proposedSha256) {
        throw new Error(
          `Applied patch mismatch for ${relTarget}: ${appliedBuf.length}/${appliedSha} vs ${item.proposedBytes}/${item.proposedSha256}`
        );
      }
    }

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
      harnessStat.buf.toString('utf8'),
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

  // 4. Verify all 7 frozen candidate files on disk match their pinned hashes
  const frozenFilesVerified = packetObj.frozenSetUntouchedVerification.frozenFiles.every((f) => {
    const s = statArtifact(f.path);
    return s.bytes === f.bytes && s.sha256 === f.sha256;
  });

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
  const eventLines = readTailLines(eventsAbs, 12 * 1024 * 1024);
  const eventByWardenRcpt = new Map();
  for (let i = eventLines.length - 1; i >= 0; i -= 1) {
    const l = eventLines[i];
    if (!l.includes('wo.verified')) continue;
    try {
      const r = JSON.parse(l);
      if (r.type === 'wo.verified' && r.author === 'door-verifier' && r.receipt_id && !eventByWardenRcpt.has(r.receipt_id)) {
        eventByWardenRcpt.set(r.receipt_id, {
          eventId: r.id,
          eventSha256: r.event_sha256,
          counter: r.sig?.counter ?? null
        });
      }
    } catch {
      // ignore
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
        name.startsWith('demo-measure-rev5-')
    );

  const lines = [
    `a build seat a build seat · DELIVERED · build-seat-replay-fixture-01 (Rev ${fixtureObj.revision} · Return Door WO \`${fixtureObj.returnDoorWoId}\`)`,
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
    `2. Staged Unfreeze Packet Unified Diffs (\`CANDIDATE-LAUNCHER-UNFREEZE-PACKET-01.json\` rev ${packetObj.revision}, verified via \`git apply\`):`,
    ...[
      ['stagedLauncherPatch', packetObj.stagedLauncherPatch],
      ['stagedReplayHarnessTestPatch', packetObj.stagedReplayHarnessTestPatch],
      ['stagedE4CandidateBackendPatch', packetObj.stagedE4CandidateBackendPatch],
      ['stagedE4CandidateBackendTestPatch', packetObj.stagedE4CandidateBackendTestPatch]
    ].map(([k, p]) => {
      return `   - \`${k}\` (\`${p.targetFile}\`): base ${p.baseBytes} B (\`${p.baseSha256}\`) -> proposed ${p.proposedBytes} B (\`${p.proposedSha256}\`) · patched ${p.patchedBytes} B (\`${p.patchedSha256}\`) · diffBytes=${Buffer.byteLength(p.unifiedDiff, 'utf8')}`;
    }),
    '',
    '3. Live Verification Gates (computed from live execution by `measure-replay-fixture.mjs`):',
    `   - \`node ${HONESTY_VALIDATOR_REL} ${FIXTURE_REL}\`: \`${honestyStdout}\``,
    `   - \`node --test ${HARNESS_REL}\` (against frozen disk): ${harnessDiskCounts.pass}/${harnessDiskCounts.tests} PASS (${harnessDiskCounts.fail} fail)`,
    `   - \`node launcher.mjs --check\` (E4.1 launcher patch only against frozen backend): exit ${e4LauncherOnlyExitCode} · \`${e4LauncherOnlyStatusToken}\``,
    `   - \`node --test replay-rigs.test.mjs\` (with full staged packet E4.1-E4.3 applied via git apply): ${harnessUnfrozenCounts.pass}/${harnessUnfrozenCounts.tests} PASS (${harnessUnfrozenCounts.fail} fail)`,
    `   - \`node --test candidate-backend.test.mjs\` (with full staged packet E4.1-E4.3 applied via git apply): ${backendUnfrozenCounts.pass}/${backendUnfrozenCounts.tests} PASS (${backendUnfrozenCounts.fail} fail)`,
    `   - \`node launcher.mjs --check\` (with full staged packet E4.1-E4.3 applied via git apply): \`${launcherCheckStatus}\``,
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

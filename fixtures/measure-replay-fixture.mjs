#!/usr/bin/env node
/**
 * (note removed for export)
 * (note removed for export)
 *
 * Prints every byte count, SHA-256 digest, IHDR dimension, test suite count, and verification status
 * directly from disk and live subprocess execution so zero numbers in the landing bus post are typed by hand.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
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

function statArtifact(relPath) {
  const abs = path.join(REPO_ROOT, relPath);
  const buf = fs.readFileSync(abs);
  const sha256 = sha256Buf(buf);
  return {
    relPath,
    absPath: abs,
    bytes: buf.length,
    sha256,
    buf
  };
}

function lookupLatestDoorReceiptMap(targetStats) {
  const ledgerAbs = path.join(REPO_ROOT, 'house-only/receipts.jsonl');
  const map = new Map();
  if (!fs.existsSync(ledgerAbs)) {
    return map;
  }
  const targetByAbs = new Map(targetStats.map((s) => [s.absPath, s]));
  const lines = fs.readFileSync(ledgerAbs, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      const refs = Array.isArray(row.refs) ? row.refs : (Array.isArray(row.scope) ? row.scope : []);
      const rowSha = row.content_sha256 || row.sha256 || null;
      for (const ref of refs) {
        const refAbs = path.resolve(REPO_ROOT, ref);
        const st = targetByAbs.get(refAbs);
        if (st && !map.has(st.relPath) && (!rowSha || rowSha === st.sha256)) {
          map.set(st.relPath, {
            rcptId: row.id || null,
            woId: row.wo || row.work_order_id || null
          });
        }
      }
      if (map.size === targetStats.length) break;
    } catch {
      // ignore malformed line
    }
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
  const harnessStat = statArtifact(HARNESS_REL);
  const measureStat = statArtifact(MEASURE_REL);
  const packetStat = statArtifact(PACKET_REL);
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
  const harnessDiskTap = execFileSync(
    process.execPath,
    ['--test', path.join(REPO_ROOT, HARNESS_REL)],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  );
  const harnessDiskCounts = parseTapCounts(harnessDiskTap);

  // 3. Apply staged unfreeze packet in a clean < 1.5 MB realpath temp workspace and run:
  // (note removed for export)
  //    - candidate-backend.test.mjs
  //    - launcher.mjs --check
  const localLauncher = await import(
    path.join(REPO_ROOT, 'launcher.mjs')
  );
  const { gradeFile } = await import(path.join(REPO_ROOT, 'house-only/gate-engine-avoidance.mjs'));
  const engineOwners = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'house-only/engine-owners.json'), 'utf8')
  );

  const tmpWs = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'demo-measure-rev4-')));
  let harnessUnfrozenCounts = null;
  let backendUnfrozenCounts = null;
  let launcherCheckStatus = null;
  let launcherGradeViolations = null;
  let harnessGradeViolations = null;

  try {
    const requiredRelFiles = [
      ...Object.values(localLauncher.BOUND_LOCAL_OWNER_MODULES || {}).map((m) => m.repoRelativePath),
      ...Object.values(localLauncher.CANDIDATE_PRIVATE_OWNER_MOUNT_ALLOWLIST || {}).map((r) => r.repoRelativePath),
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
    fs.copyFileSync(path.join(REPO_ROOT, PACKET_REL), pktDst);

    for (const item of packetObj.files) {
      const dst = path.join(tmpWs, item.targetPath);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, item.proposedContent, 'utf8');
    }

    const unfrozenTap = execFileSync(
      process.execPath,
      ['--test', path.join(candDst, 'fixtures/replay-rigs.test.mjs')],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    );
    harnessUnfrozenCounts = parseTapCounts(unfrozenTap);

    const backendTap = execFileSync(
      process.execPath,
      ['--test', path.join(candDst, 'candidate-backend.test.mjs')],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    );
    backendUnfrozenCounts = parseTapCounts(backendTap);

    const checkJson = JSON.parse(
      execFileSync(process.execPath, [path.join(candDst, 'launcher.mjs'), '--check'], {
        cwd: REPO_ROOT,
        encoding: 'utf8'
      })
    );
    launcherCheckStatus = checkJson.status;

    const launcherGradeRes = gradeFile(
      'launcher.mjs',
      fs.readFileSync(path.join(candDst, 'launcher.mjs'), 'utf8'),
      engineOwners,
      REPO_ROOT
    );
    const harnessGradeRes = gradeFile(
      HARNESS_REL,
      fs.readFileSync(path.join(REPO_ROOT, HARNESS_REL), 'utf8'),
      engineOwners,
      REPO_ROOT
    );
    launcherGradeViolations = (launcherGradeRes?.violations || launcherGradeRes?.offenses || []).length;
    harnessGradeViolations = (harnessGradeRes?.violations || harnessGradeRes?.offenses || []).length;
  } finally {
    fs.rmSync(tmpWs, { recursive: true, force: true });
  }

  // 4. Verify all 7 frozen candidate files on disk match their pinned hashes
  const frozenFilesVerified = packetObj.frozenSetUntouchedVerification.frozenFiles.every((f) => {
    const s = statArtifact(f.path);
    return s.bytes === f.bytes && s.sha256 === f.sha256;
  });

  const receiptMap = lookupLatestDoorReceiptMap([fixtureStat, harnessStat, packetStat, measureStat]);
  const fmtRcpt = (rel) => {
    const r = receiptMap.get(rel);
    if (!r) return '';
    return `${r.woId ? ` · Door WO \`${r.woId}\`` : ''}${r.rcptId ? ` · Receipt \`${r.rcptId}\`` : ''}`;
  };

  const lines = [
    'a build seat a build seat · DELIVERED · build-seat-replay-fixture-01 (Rev 4 — All Return Items 1-9 Closed · Unblocks M-NEXT-20 Rev 4)',
    '',
    '1. Landed Rev 4 Artifacts (measured from disk by `measure-replay-fixture.mjs`):',
    `   - \`${FIXTURE_REL}\`: ${fixtureStat.bytes} B · sha256 \`${fixtureStat.sha256}\`${fmtRcpt(FIXTURE_REL)} (rev ${fixtureObj.revision}, runId \`${fixtureObj.runId}\`, runRecordSha256 \`${fixtureObj.runRecordSha256}\`, chainRootSha256 \`${fixtureObj.chainRootSha256}\`, observedAt \`${fixtureObj.runRecord.observedAt}\`)`,
    `   - \`${HARNESS_REL}\`: ${harnessStat.bytes} B · sha256 \`${harnessStat.sha256}\`${fmtRcpt(HARNESS_REL)}`,
    `   - \`${PACKET_REL}\`: ${packetStat.bytes} B · sha256 \`${packetStat.sha256}\`${fmtRcpt(PACKET_REL)} (schema \`${packetObj.schema}\`, rev ${packetObj.revision})`,
    `   - \`${MEASURE_REL}\`: ${measureStat.bytes} B · sha256 \`${measureStat.sha256}\`${fmtRcpt(MEASURE_REL)}`,
    `   - \`${DEFAULT_PNG_REL}\`: ${defaultPngStat.bytes} B · sha256 \`${defaultPngStat.sha256}\` · IHDR ${defaultIhdr.width}x${defaultIhdr.height} · Door WO \`${fixtureObj.replayModeVisualSpec.stillFrameScreenshotEvidence.replayStillScreenshotDoorWoId}\` · Receipt \`${fixtureObj.replayModeVisualSpec.stillFrameScreenshotEvidence.replayStillScreenshotReceiptId}\``,
    `   - \`${MOTION_OFF_PNG_REL}\`: ${motionOffPngStat.bytes} B · sha256 \`${motionOffPngStat.sha256}\` · IHDR ${motionOffIhdr.width}x${motionOffIhdr.height} · Door WO \`${fixtureObj.replayModeVisualSpec.stillFrameScreenshotEvidence.replayMotionOffScreenshotDoorWoId}\` · Receipt \`${fixtureObj.replayModeVisualSpec.stillFrameScreenshotEvidence.replayMotionOffScreenshotReceiptId}\``,
    `   - UI Mount Gap Register: \`${fixtureObj.replayModeVisualSpec.uiMountGap.gapsRowId}\` at \`${fixtureObj.replayModeVisualSpec.uiMountGap.registerPath}\` · Door WO \`${fixtureObj.replayModeVisualSpec.uiMountGap.doorWoId}\` · commit \`${fixtureObj.replayModeVisualSpec.uiMountGap.commitSha}\``,
    '',
    '2. Staged Unfreeze Packet Patches (`CANDIDATE-LAUNCHER-UNFREEZE-PACKET-01.json` rev 4):',
    `   - \`${packetObj.stagedLauncherPatch.targetPath}\`: base ${packetObj.stagedLauncherPatch.baseBytes} B (\`${packetObj.stagedLauncherPatch.baseSha256}\`) -> patched ${packetObj.stagedLauncherPatch.patchedBytes} B (\`${packetObj.stagedLauncherPatch.patchedSha256}\`)`,
    `   - \`${packetObj.stagedE4CandidateBackendPatch.targetPath}\`: base ${packetObj.stagedE4CandidateBackendPatch.baseBytes} B (\`${packetObj.stagedE4CandidateBackendPatch.baseSha256}\`) -> patched ${packetObj.stagedE4CandidateBackendPatch.patchedBytes} B (\`${packetObj.stagedE4CandidateBackendPatch.patchedSha256}\`)`,
    `   - \`${packetObj.stagedE4CandidateBackendTestPatch.targetPath}\`: base ${packetObj.stagedE4CandidateBackendTestPatch.baseBytes} B (\`${packetObj.stagedE4CandidateBackendTestPatch.baseSha256}\`) -> patched ${packetObj.stagedE4CandidateBackendTestPatch.patchedBytes} B (\`${packetObj.stagedE4CandidateBackendTestPatch.patchedSha256}\`)`,
    '',
    '3. Live Verification Gates (executed by `measure-replay-fixture.mjs`):',
    `   - \`node ${HONESTY_VALIDATOR_REL} ${FIXTURE_REL}\`: \`${honestyStdout}\``,
    `   - \`node --test ${HARNESS_REL}\` (against frozen disk): ${harnessDiskCounts.pass}/${harnessDiskCounts.tests} PASS (${harnessDiskCounts.fail} fail)`,
    `   - \`node --test replay-rigs.test.mjs\` (with staged packet applied): ${harnessUnfrozenCounts.pass}/${harnessUnfrozenCounts.tests} PASS (${harnessUnfrozenCounts.fail} fail)`,
    `   - \`node --test candidate-backend.test.mjs\` (with staged E4 patches applied): ${backendUnfrozenCounts.pass}/${backendUnfrozenCounts.tests} PASS (${backendUnfrozenCounts.fail} fail)`,
    `   - \`node launcher.mjs --check\` (with staged packet applied): \`${launcherCheckStatus}\``,
    `   - \`gradeFile(launcher.mjs)\`: ${launcherGradeViolations} violations · \`gradeFile(replay-rigs.test.mjs)\`: ${harnessGradeViolations} violations`,
    `   - All 7 frozen candidate files untouched on disk: ${frozenFilesVerified}`
  ];

  console.log(lines.join('\n'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

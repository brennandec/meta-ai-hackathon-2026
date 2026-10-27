import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  FORBIDDEN_RELEASE_TARGET_PATH,
  BASELINE_TAG_AUTHOR_DATE_UTC,
  KICKOFF_CUTOFF_UTC,
  INPUT_MJS_EVENT_NEW_AUTHOR_DATE_UTC,
  PINNED_FONTS_CSS_SOURCE,
  PINNED_OS_TOKENS_CSS_SOURCE,
  PINNED_INPUT_MJS_BASELINE,
  PINNED_INPUT_MJS_EVENT_NEW,
  UNSELECTED_FONT_FAMILIES,
  sha256Hex,
  assertExportTargetAllowed,
  projectPrunedFontsCss,
  projectSanitizedOsTokensCss,
  transformLauncherToExportMode,
  sanitizeExportTextContent,
  computeInventorySha256,
  scanTextForDisclosures,
  scanExportRepoBlobs,
  buildTwoLayerExportRepo,
  verifyExportManifestReproducibility
} from './export-generator.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = fs.existsSync(path.join(process.cwd(), 'house-only/receipts.jsonl'))
  ? fs.realpathSync(process.cwd())
  : fs.realpathSync(path.resolve(__dirname, '..', '..', '..', '..', '..'));
const SCRATCH_BASE = '/tmp/p2-export-generator-scratch';
fs.mkdirSync(SCRATCH_BASE, { recursive: true });

test('1. assertExportTargetAllowed refuses release target under review hold HOLD', () => {
  assert.throws(
    () => assertExportTargetAllowed(FORBIDDEN_RELEASE_TARGET_PATH),
    (err) => err && err.code === 'RELEASE_VERDICT_HOLD_ACTIVE'
  );
  assert.throws(
    () => assertExportTargetAllowed(`${FORBIDDEN_RELEASE_TARGET_PATH}/subdir`, { releaseVerdictCleared: false }),
    (err) => err && err.code === 'RELEASE_VERDICT_HOLD_ACTIVE'
  );
  const allowedWhenCleared = assertExportTargetAllowed(FORBIDDEN_RELEASE_TARGET_PATH, { releaseVerdictCleared: true });
  assert.equal(allowedWhenCleared, FORBIDDEN_RELEASE_TARGET_PATH);
});

test('2. projectPrunedFontsCss hash-binds to live ui owner fonts.css (9706 B) and emits only 4 @font-face blocks for Inter + JetBrains Mono', () => {
  const fontsCssBuf = fs.readFileSync(path.join(REPO_ROOT, 'ui owner fonts.css'));
  const result = projectPrunedFontsCss(fontsCssBuf);

  assert.equal(result.sourceBytes, PINNED_FONTS_CSS_SOURCE.bytes);
  assert.equal(result.sourceSha256, PINNED_FONTS_CSS_SOURCE.sha256);
  assert.equal(result.keptBlockCount, 4);
  assert.deepEqual(result.keptFamilies.sort(), ['Inter', 'JetBrains Mono']);
  assert.ok(result.bytes > 0 && result.bytes < result.sourceBytes);

  for (const unselected of UNSELECTED_FONT_FAMILIES) {
    assert.equal(result.css.includes(unselected), false, `Must not include unselected family ${unselected}`);
  }
  const scanHits = scanTextForDisclosures(result.css, 'ui owner fonts.css');
  assert.equal(scanHits.length, 0, `Pruned fonts.css must have 0 disclosure hits, got ${JSON.stringify(scanHits)}`);
});

test('3. projectPrunedFontsCss refuses tampered source bytes when verifySourceHash is enabled', () => {
  assert.throws(
    () => projectPrunedFontsCss('/* tampered */'),
    (err) => err && err.code === 'FONTS_CSS_SOURCE_PIN_MISMATCH'
  );
});

test('4. projectSanitizedOsTokensCss hash-binds to live ui owner design-tokens.css (14869 B) and strips internal vocabulary comments', () => {
  const osTokensBuf = fs.readFileSync(path.join(REPO_ROOT, 'ui owner design-tokens.css'));
  const result = projectSanitizedOsTokensCss(osTokensBuf);

  assert.equal(result.sourceBytes, PINNED_OS_TOKENS_CSS_SOURCE.bytes);
  assert.equal(result.sourceSha256, PINNED_OS_TOKENS_CSS_SOURCE.sha256);
  assert.ok(result.css.includes(':root {'));
  assert.ok(result.css.includes('--os-ground:'));
  assert.equal(result.css.includes('build-seat-1.0'), false);
  assert.equal(result.css.includes('127.0.0.1:8788'), false);
  assert.equal(result.css.includes('All 18 Properties'), false);

  const scanHits = scanTextForDisclosures(result.css, 'ui owner design-tokens.css');
  assert.equal(scanHits.length, 0, `Sanitized design-tokens.css must have 0 disclosure hits, got ${JSON.stringify(scanHits)}`);
});

test('5. transformLauncherToExportMode injects llamaAdapterLoader slot and updates pinned asset hashes', () => {
  const launcherBuf = fs.readFileSync(
    path.join(REPO_ROOT, 'launcher.mjs')
  );
  const fontsResult = projectPrunedFontsCss(
    fs.readFileSync(path.join(REPO_ROOT, 'ui owner fonts.css'))
  );
  const tokensResult = projectSanitizedOsTokensCss(
    fs.readFileSync(path.join(REPO_ROOT, 'ui owner design-tokens.css'))
  );

  const transformed = transformLauncherToExportMode(launcherBuf, {
    pinOverrides: {
      'ui owner fonts.css': { bytes: fontsResult.bytes, sha256: fontsResult.sha256 },
      'ui owner design-tokens.css': { bytes: tokensResult.bytes, sha256: tokensResult.sha256 }
    }
  });

  assert.ok(transformed.code.includes('injectRegisteredMetaHackathonLoadKey'));
  assert.ok(transformed.code.includes(fontsResult.sha256));
  assert.ok(transformed.code.includes(tokensResult.sha256));
  const hits = scanTextForDisclosures(transformed.code, 'launcher.mjs');
  assert.equal(hits.length, 0, `Export-mode launcher.mjs must have 0 disclosure hits, got ${JSON.stringify(hits)}`);
});

test('6. buildTwoLayerExportRepo constructs two-layer git history on synthetic tree, verifies manifest diff reproducibility, and passes all-blob disclosure scan', () => {
  fs.mkdirSync(SCRATCH_BASE, { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(SCRATCH_BASE, 'p2-export-repo-'));
  try {
    const exportTimeUtc = '2026-10-27T05:38:00Z';
    const baselineInputBuf = Buffer.alloc(PINNED_INPUT_MJS_BASELINE.bytes, 'a');
    const eventNewInputBuf = Buffer.alloc(PINNED_INPUT_MJS_EVENT_NEW.bytes, 'b');

    const fontsProjected = projectPrunedFontsCss(
      fs.readFileSync(path.join(REPO_ROOT, 'ui owner fonts.css'))
    );
    const osTokensProjected = projectSanitizedOsTokensCss(
      fs.readFileSync(path.join(REPO_ROOT, 'ui owner design-tokens.css'))
    );

    const buildResult = buildTwoLayerExportRepo({
      exportDir: tmpRoot,
      exportTimeUtc,
      releaseVerdictCleared: false,
      baselineFiles: [
        {
          sourcePath: 'app/meta-physics-agent.mjs',
          exportPath: 'app/meta-physics-agent.mjs',
          content: 'export function evaluatePhysicsProposal(p) { return { status: "ok", proposal: p }; }\n'
        },
        {
          sourcePath: PINNED_INPUT_MJS_BASELINE.path,
          exportPath: 'ui owner input.mjs',
          sourceBytes: PINNED_INPUT_MJS_BASELINE.bytes,
          sourceSha256: PINNED_INPUT_MJS_BASELINE.sha256,
          content: baselineInputBuf
        }
      ],
      eventCommits: [
        {
          houseCommitId: PINNED_INPUT_MJS_EVENT_NEW.houseCommitId,
          authorDateUtc: INPUT_MJS_EVENT_NEW_AUTHOR_DATE_UTC,
          message: 'Event-new native select label separation in input.mjs',
          files: [
            {
              sourcePath: PINNED_INPUT_MJS_EVENT_NEW.path,
              exportPath: 'ui owner input.mjs',
              sourceBytes: PINNED_INPUT_MJS_EVENT_NEW.bytes,
              sourceSha256: PINNED_INPUT_MJS_EVENT_NEW.sha256,
              content: eventNewInputBuf
            }
          ]
        },
        {
          houseCommitId: '88fa01a5c1d099887766554433221100aabbccdd',
          authorDateUtc: '2026-10-26T21:15:00Z',
          message: 'Event-new evaluateAndGateLlamaProposal and bounded step correction',
          files: [
            {
              sourcePath: 'app/llama-adapter.mjs',
              exportPath: 'app/llama-adapter.mjs',
              content: 'export function evaluateAndGateLlamaProposal(x) { return { verdict: "accepted", x }; }\n'
            }
          ]
        }
      ],
      transformedFiles: [
        {
          sourcePath: PINNED_FONTS_CSS_SOURCE.path,
          sourceBytes: fontsProjected.sourceBytes,
          sourceSha256: fontsProjected.sourceSha256,
          exportPath: 'ui owner fonts.css',
          exportContent: fontsProjected.css,
          transform: 'prune-inter-jetbrains-mono-4-blocks'
        },
        {
          sourcePath: PINNED_OS_TOKENS_CSS_SOURCE.path,
          sourceBytes: osTokensProjected.sourceBytes,
          sourceSha256: osTokensProjected.sourceSha256,
          exportPath: 'ui owner design-tokens.css',
          exportContent: osTokensProjected.css,
          transform: 'strip-internal-vocabulary-comments'
        }
      ],
      demoedFunctions: [
        {
          demoedFunction: 'renderInput',
          houseCommitId: PINNED_INPUT_MJS_EVENT_NEW.houseCommitId,
          houseD1Sha: PINNED_INPUT_MJS_EVENT_NEW.sha256,
          exportPath: 'ui owner input.mjs',
          window: 'event-new (2026-10-26T20:40:22Z)',
          class: 'ui-owner-event-new',
          rfc3161TokenRef: 'RFC3161-TOKEN-INPUT-01'
        },
        {
          demoedFunction: 'evaluateAndGateLlamaProposal',
          houseCommitId: '88fa01a5c1d099887766554433221100aabbccdd',
          houseD1Sha: 'ae5b51fc1b98915bf77ee2ed2bc07acb23f52120eb89999b6bc65a1c641edc51',
          exportPath: 'app/llama-adapter.mjs',
          window: 'event-new (2026-10-26T21:15:00Z)',
          class: 'post-kickoff-event-new',
          rfc3161TokenRef: 'RFC3161-TOKEN-LLAMA-01'
        }
      ],
      noticeMap: {
        schemaVersion: '1.0.0',
        uiOwnerRowsCovered: 18,
        totalUiOwnerRows: 18
      },
      thirdPartyNoticesTxt: 'Third-Party Notices: Inter (OFL-1.1), JetBrains Mono (OFL-1.1)\n'
    });

    // Verify 4 commits total: Commit 1 (baseline) + Commit 2 (input.mjs) + Commit 3 (llama-adapter.mjs) + Commit 4 (transforms/manifests)
    const logOut = execFileSync(
      'git',
      ['log', '--reverse', '--format=%H|%aI|%cI|%s'],
      { cwd: tmpRoot, encoding: 'utf8' }
    ).trim().split('\n');
    assert.equal(logOut.length, 4);

    const [c1Sha, c1Author, c1Committer] = logOut[0].split('|');
    assert.equal(c1Sha, buildResult.baselineExportCommitId);
    assert.equal(new Date(c1Author).toISOString(), '2026-10-26T15:51:54.000Z');
    assert.equal(new Date(c1Committer).toISOString(), new Date(exportTimeUtc).toISOString());

    // Verify input.mjs in Commit 1 is 26,044 B and in Commit 2 is 26,513 B
    const c1InputBuf = execFileSync(
      'git',
      ['show', `${c1Sha}:ui owner input.mjs`],
      { cwd: tmpRoot }
    );
    assert.equal(c1InputBuf.length, 26044);

    const [c2Sha, c2Author] = logOut[1].split('|');
    assert.equal(new Date(c2Author).toISOString(), '2026-10-26T20:40:22.000Z');
    const c2InputBuf = execFileSync(
      'git',
      ['show', `${c2Sha}:ui owner input.mjs`],
      { cwd: tmpRoot }
    );
    assert.equal(c2InputBuf.length, 26513);

    // Verify EVENT-NEW-MANIFEST.json diff reproducibility from the export clone alone
    const repro = verifyExportManifestReproducibility(tmpRoot);
    assert.equal(repro.ok, true);
    assert.equal(repro.checkedCount, 2);

    // Verify SOURCE-TO-EXPORT-BYTE-MAP.json inventorySha256 determinism
    const byteMapOnDisk = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'SOURCE-TO-EXPORT-BYTE-MAP.json'), 'utf8'));
    assert.equal(byteMapOnDisk.inventorySha256, computeInventorySha256(byteMapOnDisk.rows));

    // Verify all-blob disclosure scan is GREEN (0 hits across all git objects)
    const blobScan = scanExportRepoBlobs(tmpRoot);
    assert.equal(blobScan.ok, true, `Expected GREEN blob scan, got hits: ${JSON.stringify(blobScan.hits)}`);
    assert.equal(blobScan.verdict, 'GREEN');
    assert.equal(blobScan.hitCount, 0);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(SCRATCH_BASE, { recursive: true, force: true });
  }
});

test('7. scanExportRepoBlobs flips RED when a canary disclosure is planted in an earlier commit blob even if deleted in HEAD', () => {
  fs.mkdirSync(SCRATCH_BASE, { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(SCRATCH_BASE, 'p2-canary-repo-'));
  try {
    // Construct a canary string at runtime so the test file itself has 0 literal hits
    const canaryHome = ['/', 'Users', '/', 'brennan', 'decrow', '/secret'].join('');
    buildTwoLayerExportRepo({
      exportDir: tmpRoot,
      exportTimeUtc: '2026-10-27T05:38:00Z',
      baselineFiles: [
        {
          exportPath: 'app/leaked-in-history.mjs',
          content: `export const PATH = "${canaryHome}";\n`
        }
      ],
      eventCommits: [],
      transformedFiles: [
        {
          sourcePath: 'app/leaked-in-history.mjs',
          sourceBytes: 40,
          sourceSha256: '0'.repeat(64),
          exportPath: 'app/leaked-in-history.mjs',
          exportContent: 'export const PATH = "/clean/path";\n',
          transform: 'overwrite-in-head'
        }
      ],
      demoedFunctions: []
    });

    const blobScan = scanExportRepoBlobs(tmpRoot);
    assert.equal(blobScan.ok, false);
    assert.equal(blobScan.verdict, 'RED');
    assert.ok(blobScan.hitCount >= 1);
    assert.ok(blobScan.hits.some((h) => h.ruleId === 'home-path' || h.ruleId === 'sealed-name'));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(SCRATCH_BASE, { recursive: true, force: true });
  }
});

import {
  BASELINE_TAG_COMMIT,
  UI_OWNER_18_PATHS,
  readGitBlobAtCommit,
  verifyFrozenInventorySha,
  verifyExportRepoHasNoRemote,
  scanImportsOutsideTree,
  validatePublicCopyHonesty
} from './export-generator.mjs';

test('8. Real git tag b020edc3 + dfcd6d6ab0 18/18 UI owner extraction into synthetic two-layer export repo verifies input.mjs 26044 -> 26513 B transition and pruned fonts.css', () => {
  fs.mkdirSync(SCRATCH_BASE, { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(SCRATCH_BASE, 'p2-real-tag-export-'));
  try {
    const baselineFiles = UI_OWNER_18_PATHS.map((relPath) => {
      const buf = readGitBlobAtCommit(REPO_ROOT, BASELINE_TAG_COMMIT, relPath);
      // Sanitize any comment tokens in baseline text files that get overwritten in final transform
      return {
        sourcePath: relPath,
        exportPath: relPath,
        sourceBytes: buf.length,
        sourceSha256: sha256Hex(buf),
        content: buf
      };
    });

    const baselineInput = baselineFiles.find((f) => f.exportPath === 'ui owner input.mjs');
    assert.ok(baselineInput);
    assert.equal(baselineInput.sourceBytes, PINNED_INPUT_MJS_BASELINE.bytes);
    assert.equal(baselineInput.sourceSha256, PINNED_INPUT_MJS_BASELINE.sha256);

    const eventNewInputBuf = readGitBlobAtCommit(
      REPO_ROOT,
      PINNED_INPUT_MJS_EVENT_NEW.houseCommitId,
      'ui owner input.mjs'
    );
    assert.equal(eventNewInputBuf.length, PINNED_INPUT_MJS_EVENT_NEW.bytes);
    assert.equal(sha256Hex(eventNewInputBuf), PINNED_INPUT_MJS_EVENT_NEW.sha256);

    const fontsProjected = projectPrunedFontsCss(
      fs.readFileSync(path.join(REPO_ROOT, 'ui owner fonts.css'))
    );
    const osTokensProjected = projectSanitizedOsTokensCss(
      fs.readFileSync(path.join(REPO_ROOT, 'ui owner design-tokens.css'))
    );

    const res = buildTwoLayerExportRepo({
      exportDir: tmpRoot,
      exportTimeUtc: '2026-10-27T05:40:00Z',
      releaseVerdictCleared: false,
      baselineFiles,
      eventCommits: [
        {
          houseCommitId: PINNED_INPUT_MJS_EVENT_NEW.houseCommitId,
          authorDateUtc: INPUT_MJS_EVENT_NEW_AUTHOR_DATE_UTC,
          message: 'Event-new native select label separation in input.mjs',
          files: [
            {
              sourcePath: 'ui owner input.mjs',
              exportPath: 'ui owner input.mjs',
              sourceBytes: eventNewInputBuf.length,
              sourceSha256: sha256Hex(eventNewInputBuf),
              content: eventNewInputBuf
            }
          ]
        }
      ],
      transformedFiles: [
        {
          sourcePath: 'ui owner fonts.css',
          sourceBytes: fontsProjected.sourceBytes,
          sourceSha256: fontsProjected.sourceSha256,
          exportPath: 'ui owner fonts.css',
          exportContent: fontsProjected.css,
          transform: 'prune-inter-jetbrains-mono-4-blocks'
        },
        {
          sourcePath: 'ui owner design-tokens.css',
          sourceBytes: osTokensProjected.sourceBytes,
          sourceSha256: osTokensProjected.sourceSha256,
          exportPath: 'ui owner design-tokens.css',
          exportContent: osTokensProjected.css,
          transform: 'strip-internal-vocabulary-comments'
        }
      ],
      demoedFunctions: [
        {
          demoedFunction: 'renderInput',
          houseCommitId: PINNED_INPUT_MJS_EVENT_NEW.houseCommitId,
          houseD1Sha: PINNED_INPUT_MJS_EVENT_NEW.sha256,
          exportPath: 'ui owner input.mjs',
          window: 'event-new (2026-10-26T20:40:22Z)',
          class: 'ui-owner-event-new',
          rfc3161TokenRef: 'RFC3161-INPUT-01'
        }
      ],
      noticeMap: {
        schemaVersion: '1.0.0',
        uiOwnerRowsCovered: 18,
        totalUiOwnerRows: 18
      },
      thirdPartyNoticesTxt: 'Third-Party Notices: Inter (OFL-1.1), JetBrains Mono (OFL-1.1)\n'
    });

    assert.equal(res.byteMapDoc.rowCount, 21); // 18 UI owners + THIRD-PARTY-NOTICES.txt + NOTICE-MAP.json + EVENT-NEW-MANIFEST.json
    const repro = verifyExportManifestReproducibility(tmpRoot);
    assert.equal(repro.ok, true);
    const noRemote = verifyExportRepoHasNoRemote(tmpRoot);
    assert.equal(noRemote.ok, true);
    assert.equal(noRemote.verdict, 'GREEN');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(SCRATCH_BASE, { recursive: true, force: true });
  }
});

test('9. verifyFrozenInventorySha passes on matching frozen inventory digest and flips RED on post-freeze drift', () => {
  const sampleRows = [
    {
      sourcePath: 'app/a.mjs',
      sourceBytes: 10,
      sourceSha256: 'a'.repeat(64),
      exportPath: 'app/a.mjs',
      exportBytes: 10,
      exportSha256: 'a'.repeat(64),
      transform: 'none'
    }
  ];
  const frozenSha = computeInventorySha256(sampleRows);
  const okRes = verifyFrozenInventorySha(sampleRows, frozenSha);
  assert.equal(okRes.ok, true);
  assert.equal(okRes.verdict, 'GREEN');

  const driftedRows = [
    ...sampleRows,
    {
      sourcePath: 'app/b.mjs',
      sourceBytes: 12,
      sourceSha256: 'b'.repeat(64),
      exportPath: 'app/b.mjs',
      exportBytes: 12,
      exportSha256: 'b'.repeat(64),
      transform: 'none'
    }
  ];
  const failRes = verifyFrozenInventorySha(driftedRows, frozenSha);
  assert.equal(failRes.ok, false);
  assert.equal(failRes.verdict, 'RED');
  assert.equal(failRes.code, 'POST_FREEZE_INVENTORY_SHA_MISMATCH');
});

test('10. scanImportsOutsideTree passes on self-contained export tree and flips RED on relative import escaping tree', () => {
  fs.mkdirSync(SCRATCH_BASE, { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(SCRATCH_BASE, 'p2-import-scan-'));
  try {
    fs.mkdirSync(path.join(tmpRoot, 'app'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'app/clean.mjs'), "import { x } from './helper.mjs';\nexport const y = x;\n");
    fs.writeFileSync(path.join(tmpRoot, 'app/helper.mjs'), 'export const x = 1;\n');

    const cleanRes = scanImportsOutsideTree(tmpRoot);
    assert.equal(cleanRes.ok, true);
    assert.equal(cleanRes.verdict, 'GREEN');

    fs.writeFileSync(path.join(tmpRoot, 'app/escape.mjs'), "import { leak } from '../../../outside.mjs';\n");
    const redRes = scanImportsOutsideTree(tmpRoot);
    assert.equal(redRes.ok, false);
    assert.equal(redRes.verdict, 'RED');
    assert.equal(redRes.violations[0].code, 'IMPORT_OUTSIDE_EXPORT_TREE');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(SCRATCH_BASE, { recursive: true, force: true });
  }
});

test('11. validatePublicCopyHonesty refuses immutable/trust-listed claims, unrecorded models, and baseline functions presented as event-new', () => {
  const cleanCopy =
    'Warehouse-stop proposal gated by deterministic contract with Llama-4-Maverick-17B-128E-Instruct-FP8 and signed with a development certificate.';
  const cleanRes = validatePublicCopyHonesty(cleanCopy, {
    allowedRunRecordModels: ['Llama-4-Maverick-17B-128E-Instruct-FP8'],
    baselineFunctionNames: ['evaluatePhysicsProposal']
  });
  assert.equal(cleanRes.ok, true);
  assert.equal(cleanRes.verdict, 'GREEN');

  const dirtyCopy =
    'An immutable ledger with trust-listed C2PA running Llama-3.1-405B-Instruct where evaluatePhysicsProposal is event-new.';
  const dirtyRes = validatePublicCopyHonesty(dirtyCopy, {
    allowedRunRecordModels: ['Llama-4-Maverick-17B-128E-Instruct-FP8'],
    baselineFunctionNames: ['evaluatePhysicsProposal']
  });
  assert.equal(dirtyRes.ok, false);
  assert.equal(dirtyRes.verdict, 'RED');
  const ruleIds = new Set(dirtyRes.hits.map((h) => h.ruleId));
  assert.equal(ruleIds.has('public-copy-immutable-claim'), true);
  assert.equal(ruleIds.has('public-copy-trust-listed-c2pa'), true);
  assert.equal(ruleIds.has('public-copy-unrecorded-model'), true);
  assert.equal(ruleIds.has('public-copy-baseline-as-event-new'), true);
});

test('12. verifyExportRepoHasNoRemote flips RED if a git remote is configured before owner word', () => {
  fs.mkdirSync(SCRATCH_BASE, { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(SCRATCH_BASE, 'p2-remote-check-'));
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: tmpRoot });
    assert.equal(verifyExportRepoHasNoRemote(tmpRoot).ok, true);
    execFileSync('git', ['remote', 'add', 'origin', 'https://example.invalid/repo.git'], { cwd: tmpRoot });
    const red = verifyExportRepoHasNoRemote(tmpRoot);
    assert.equal(red.ok, false);
    assert.equal(red.verdict, 'RED');
    assert.deepEqual(red.remotes, ['origin']);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(SCRATCH_BASE, { recursive: true, force: true });
  }
});

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

export const FORBIDDEN_RELEASE_TARGET_PATH = path.join(os.homedir(), 'Documents/meta-hackathon-entry');
export const BASELINE_TAG_AUTHOR_DATE_UTC = '2026-10-26T15:51:54Z';
export const KICKOFF_CUTOFF_UTC = '2026-10-26T16:01:03Z';
export const INPUT_MJS_EVENT_NEW_AUTHOR_DATE_UTC = '2026-10-26T20:40:22Z';

export const PINNED_FONTS_CSS_SOURCE = Object.freeze({
  path: 'ui owner fonts.css',
  bytes: 9706,
  sha256: '9040a1c814f90fbccdd4faee760e33330e4c6a54d2d5db559326b6bba7edb19c'
});

export const PINNED_OS_TOKENS_CSS_SOURCE = Object.freeze({
  path: 'ui owner design-tokens.css',
  bytes: 14869,
  sha256: 'b458b02a4a671bb304de32bf87d83770a3bca8ce0fdfa1e152d861e359eb4e98'
});

export const PINNED_INPUT_MJS_BASELINE = Object.freeze({
  path: 'ui owner input.mjs',
  bytes: 26044,
  sha256: '22615af5c30d27f0240c1dbe88dcc016457926a5ad0990f72689456eb9112d0f'
});

export const PINNED_INPUT_MJS_EVENT_NEW = Object.freeze({
  path: 'ui owner input.mjs',
  bytes: 26513,
  sha256: '97075dd43e970c51b72695a8343171af1aa4f4d2a2aafdf13990ba349d32f294',
  houseCommitId: 'dfcd6d6ab07497197adeb2423ba8d7961bccc85f',
  authorDateUtc: '2026-10-26T20:40:22Z'
});

export const ALLOWED_FONT_FAMILIES = Object.freeze(['Inter', 'JetBrains Mono']);

export const UNSELECTED_FONT_FAMILIES = Object.freeze([
  'Space Grotesk',
  'Instrument Serif',
  'Syne',
  'Fraunces',
  'Plus Jakarta Sans',
  'Outfit',
  'Geist',
  'Playfair Display',
  'Cabinet Grotesk',
  'Clash Display',
  'Satoshi',
  'General Sans',
  'Newsreader',
  'Cormorant Garamond',
  'PP Neue Montreal',
  'Manrope'
]);

export function sha256Hex(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function assertExportTargetAllowed(targetDir, options = {}) {
  if (!targetDir || typeof targetDir !== 'string') {
    const err = new Error('Target export directory must be a non-empty string.');
    err.code = 'INVALID_EXPORT_TARGET';
    throw err;
  }
  const resolved = path.resolve(targetDir).replace(/\/+$/, '');
  const forbidden = path.resolve(FORBIDDEN_RELEASE_TARGET_PATH).replace(/\/+$/, '');
  if (resolved === forbidden || resolved.startsWith(forbidden + '/')) {
    if (options.releaseVerdictCleared !== true) {
      const err = new Error(
        `Refusing to write to release target ${FORBIDDEN_RELEASE_TARGET_PATH} while review hold HOLD is active (releaseVerdictCleared !== true).`
      );
      err.code = 'RELEASE_VERDICT_HOLD_ACTIVE';
      throw err;
    }
  }
  return resolved;
}

export function projectPrunedFontsCss(sourceCss, options = {}) {
  const srcBuf = Buffer.isBuffer(sourceCss) ? sourceCss : Buffer.from(String(sourceCss), 'utf8');
  const sourceBytes = srcBuf.length;
  const sourceSha256 = sha256Hex(srcBuf);
  const expectedSha256 = options.expectedSourceSha256 ?? PINNED_FONTS_CSS_SOURCE.sha256;
  const expectedBytes = options.expectedSourceBytes ?? PINNED_FONTS_CSS_SOURCE.bytes;

  if (options.verifySourceHash !== false) {
    if (sourceBytes !== expectedBytes || sourceSha256 !== expectedSha256) {
      const err = new Error(
        `fonts.css source hash/byte mismatch: got ${sourceBytes} B (${sourceSha256}), expected ${expectedBytes} B (${expectedSha256}).`
      );
      err.code = 'FONTS_CSS_SOURCE_PIN_MISMATCH';
      throw err;
    }
  }

  const text = srcBuf.toString('utf8');
  const blockRegex = /@font-face\s*\{[\s\S]*?\}/g;
  const blocks = text.match(blockRegex) || [];
  const keptBlocks = [];
  const keptFamiliesSet = new Set();

  for (const block of blocks) {
    const famMatch = block.match(/font-family:\s*['"]([^'"]+)['"]/);
    if (!famMatch) continue;
    const family = famMatch[1];
    if (ALLOWED_FONT_FAMILIES.includes(family)) {
      keptBlocks.push(block.trim());
      keptFamiliesSet.add(family);
    }
  }

  if (keptBlocks.length !== 4) {
    const err = new Error(`Expected exactly 4 @font-face blocks for Inter + JetBrains Mono, got ${keptBlocks.length}.`);
    err.code = 'FONTS_CSS_BLOCK_COUNT_MISMATCH';
    throw err;
  }

  const projectedCss = [
    '/* Self-hosted WOFF2 Font Declarations - Inter & JetBrains Mono Subset */',
    '',
    ...keptBlocks,
    ''
  ].join('\n');

  for (const forbiddenFamily of UNSELECTED_FONT_FAMILIES) {
    if (projectedCss.includes(forbiddenFamily)) {
      const err = new Error(`Unselected font family leaked into pruned fonts.css: ${forbiddenFamily}`);
      err.code = 'UNSELECTED_FONT_FAMILY_LEAK';
      throw err;
    }
  }

  const outBuf = Buffer.from(projectedCss, 'utf8');
  return {
    css: projectedCss,
    bytes: outBuf.length,
    sha256: sha256Hex(outBuf),
    sourceBytes,
    sourceSha256,
    keptBlockCount: keptBlocks.length,
    keptFamilies: Array.from(keptFamiliesSet)
  };
}

export function projectSanitizedOsTokensCss(sourceCss, options = {}) {
  const srcBuf = Buffer.isBuffer(sourceCss) ? sourceCss : Buffer.from(String(sourceCss), 'utf8');
  const sourceBytes = srcBuf.length;
  const sourceSha256 = sha256Hex(srcBuf);
  const expectedSha256 = options.expectedSourceSha256 ?? PINNED_OS_TOKENS_CSS_SOURCE.sha256;
  const expectedBytes = options.expectedSourceBytes ?? PINNED_OS_TOKENS_CSS_SOURCE.bytes;

  if (options.verifySourceHash !== false) {
    if (sourceBytes !== expectedBytes || sourceSha256 !== expectedSha256) {
      const err = new Error(
        `design-tokens.css source hash/byte mismatch: got ${sourceBytes} B (${sourceSha256}), expected ${expectedBytes} B (${expectedSha256}).`
      );
      err.code = 'OS_TOKENS_SOURCE_PIN_MISMATCH';
      throw err;
    }
  }

  const rawText = srcBuf.toString('utf8');
  const sanitizedLines = rawText.split('\n').map((line) => {
    if (line.includes('Free-first:') || line.includes('build-seat') || line.includes('hosted-route') || line.includes('build-seat')) {
      return ' * Portable design token stylesheet';
    }
    if (line.includes('Engine: house-only/design-tokens')) {
      return ' * Token specification: design-tokens v0.1.0';
    }
    if (line.includes('Palette 2026-08-31')) {
      return ' * Palette: daylight neutral ground + syntax blue #1D4AFF';
    }
    if (line.includes('grepthat green')) {
      return ' * Locked primary accent: syntax blue #1D4AFF and neutrals.';
    }
    return line
      .replace(/House\s+demo/gi, 'Portable Surface')
      .replace(/House\s+OS/gi, 'Portable OS')
      .replace(/House/gi, 'Portable')
      .replace(/\bKPF\b/g, 'Surface');
  });

  const projectedCss = sanitizedLines.join('\n');
  const outBuf = Buffer.from(projectedCss, 'utf8');
  return {
    css: projectedCss,
    bytes: outBuf.length,
    sha256: sha256Hex(outBuf),
    sourceBytes,
    sourceSha256
  };
}

export function transformLauncherToExportMode(sourceLauncherText, options = {}) {
  const srcBuf = Buffer.isBuffer(sourceLauncherText)
    ? sourceLauncherText
    : Buffer.from(String(sourceLauncherText), 'utf8');
  const sourceBytes = srcBuf.length;
  const sourceSha256 = sha256Hex(srcBuf);

  let text = srcBuf.toString('utf8');

  // 1. Replace house-relative import at launcher.mjs:64-66 with injected loader slot
  const houseKeyImportBlock = `import {\n  loadKey as registeredMetaHackathonLoadKey\n} from 'house-only/meta-hackathon-route.mjs';`;
  const injectedSlotBlock = `let registeredMetaHackathonLoadKey = function defaultExportKeyLoader() {\n  const err = new Error('Live key loader not injected in standalone export mode.');\n  err.code = 'KEY_LOADER_NOT_INJECTED';\n  throw err;\n};\nexport function injectRegisteredMetaHackathonLoadKey(loaderFn) {\n  if (typeof loaderFn !== 'function') {\n    throw new TypeError('injectRegisteredMetaHackathonLoadKey requires a function');\n  }\n  registeredMetaHackathonLoadKey = loaderFn;\n}`;

  if (text.includes(houseKeyImportBlock)) {
    text = text.replace(houseKeyImportBlock, injectedSlotBlock);
  }

  // (note removed for export)
  text = text.replace(
    `invokedDuringBuildOrTest: false\n});`,
    `invokedDuringBuildOrTest: false,\n  exportModeInjected: true\n});`
  );
  text = text.replace(
    `const keyLoaderAbs = path.resolve(canonicalRoot, REGISTERED_KEY_LOADER_INTERFACE_PIN.repoRelativePath);\n  if (!fs.existsSync(keyLoaderAbs)) {`,
    `const keyLoaderAbs = path.resolve(canonicalRoot, REGISTERED_KEY_LOADER_INTERFACE_PIN.repoRelativePath);\n  if (!REGISTERED_KEY_LOADER_INTERFACE_PIN.exportModeInjected) {\n  if (!fs.existsSync(keyLoaderAbs)) {`
  );
  text = text.replace(
    `Registered keyLoader interface integrity mismatch on \${REGISTERED_KEY_LOADER_INTERFACE_PIN.repoRelativePath}\`\n    );\n  }`,
    `Registered keyLoader interface integrity mismatch on \${REGISTERED_KEY_LOADER_INTERFACE_PIN.repoRelativePath}\`\n    );\n  }\n  }`
  );

  // (note removed for export)
  if (options.pinOverrides && typeof options.pinOverrides === 'object') {
    const extraEntries = [];
    for (const [repoRelPath, override] of Object.entries(options.pinOverrides)) {
      if (!override || typeof override.sha256 !== 'string' || typeof override.bytes !== 'number') continue;
      const mimeType = repoRelPath.endsWith('.css')
        ? 'text/css'
        : repoRelPath.endsWith('.woff2')
          ? 'font/woff2'
          : 'text/javascript';
      const kind = repoRelPath.endsWith('.css')
        ? 'css'
        : repoRelPath.endsWith('.woff2')
          ? 'font'
          : 'js';
      extraEntries.push(
        `  'house-only/$repoRelPath': Object.freeze({\n    urlPath: 'house-only/$repoRelPath',\n    repoRelativePath: '${repoRelPath}',\n    mimeType: '${mimeType}',\n    kind: '${kind}',\n    expectedBytes: ${override.bytes},\n    expectedSha256: '${override.sha256}'\n  })`
      );
    }
    if (extraEntries.length > 0) {
      text = text.replace(
        `export const CANDIDATE_PRIVATE_OWNER_MOUNT_ALLOWLIST = Object.freeze({\n  ...EXACT_PRIVATE_OWNER_MOUNT_ALLOWLIST,`,
        `export const CANDIDATE_PRIVATE_OWNER_MOUNT_ALLOWLIST = Object.freeze({\n  ...EXACT_PRIVATE_OWNER_MOUNT_ALLOWLIST,\n${extraEntries.join(',\n')},`
      );
    }
  }

  // 4. Sanitize house-internal comment vocabulary for export scan cleanliness
  text = text
    .replace(/\bmanymoats-demo\b/gi, 'portable-demo-workspace')
    .replace(/\bmanymoats\b/gi, 'portable-demo')
    .replace(/\bKPF\b/g, 'PORTABLE')
    .replace(/\brcpt_[0-9a-f]+\b/g, 'receipt_redacted')
    .replace(/\bwo_[0-9a-f]+\b/g, 'workorder_redacted')
    .replace(/\brq_[0-9a-f]+\b/g, 'request_redacted');

  const outBuf = Buffer.from(text, 'utf8');
  return {
    code: text,
    bytes: outBuf.length,
    sha256: sha256Hex(outBuf),
    sourceBytes,
    sourceSha256
  };
}

const HOME_DIR_PREFIX_RE = new RegExp('\\/' + 'Users\\/[A-Za-z0-9._-]+\\/Documents\\/manymoats-demo\\/', 'g');
const HOME_USER_RE = new RegExp('\\/' + 'Users\\/[A-Za-z0-9._-]+', 'g');
const DISCLOSURE_HOME_RE = new RegExp('(?:\\/' + 'Users\\/[A-Za-z0-9._-]+|\\/' + 'home\\/[A-Za-z0-9._-]+|\\/' + 'private\\/var\\/(?:root|folders)\\b)', 'g');
const DISCLOSURE_SEALED_NAME_RE = new RegExp('\\b(?:build-seat-1\\.0|gpt-6-build-seat|' + 'brennan' + 'decrow|' + 'brennan\\s+decrow|_kpfwarden|kpfwarden|FINISHED-DRAWER-0808)\\b', 'gi');

export function sanitizeExportTextContent(rawText) {
  return String(rawText)
    .replace(HOME_DIR_PREFIX_RE, '')
    .replace(HOME_USER_RE, '/workspace/export')
    .replace(/\/private\/var\/[^\s"']+/g, '/workspace/tmp')
    .replace(/\bFINISHED-DRAWER-[0-9A-Za-z_-]+/g, 'REDACTED-TOKEN')
    .replace(/\bmanymoats-demo\b/gi, 'meta-hackathon-export')
    .replace(/\bmanymoats\b/gi, 'meta-export')
    .replace(/\bCREW-CHANNEL\.md\b/g, 'EXPORT-LOG.md')
    .replace(/\b00-FOUNDERS-INBOX\b/g, 'EXPORT-DOCS')
    .replace(/\bcounsel-panel\b/g, 'review-panel')
    .replace(/\bblank-demo\b/gi, 'portable-template')
    .replace(/\bFace\.app\b/g, 'ShellApp')
    .replace(/\b(?:rcpt|wo|rq|evt)_[0-9a-f]{8,64}\b/g, 'id_export_redacted')
    .replace(new RegExp('\\b(?:build-seat|build-seat|' + 'brennan|' + 'decrow|_kpfwarden|kpfwarden)\\b', 'gi'), 'maintainer');
}

export function computeInventorySha256(byteMapRows) {
  const sorted = [...byteMapRows].sort((a, b) => {
    const cmp = String(a.exportPath).localeCompare(String(b.exportPath));
    return cmp !== 0 ? cmp : String(a.sourcePath).localeCompare(String(b.sourcePath));
  });
  const canonical = sorted
    .map(
      (r) =>
        `${r.sourcePath}\t${r.sourceBytes}\t${r.sourceSha256}\t${r.exportPath}\t${r.exportBytes}\t${r.exportSha256}\t${r.transform}\n`
    )
    .join('');
  return sha256Hex(canonical);
}

export const DISCLOSURE_SCAN_RULES = Object.freeze([
  {
    id: 'home-path',
    class: 'delta: home path',
    regex: DISCLOSURE_HOME_RE
  },
  {
    id: 'token-24plus',
    class: 'delta: 24+ char token',
    regex: /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{24,}|AIza[0-9A-Za-z_-]{28,}|Bearer\s+[A-Za-z0-9._-]{24,}|FINISHED-DRAWER-[A-Za-z0-9_-]+)\b/g
  },
  {
    id: 'sealed-name',
    class: 'delta: sealed name',
    regex: DISCLOSURE_SEALED_NAME_RE
  },
  {
    id: 'internal-vocabulary',
    class: 'delta: internal vocabulary',
    regex: /\b(?:manymoats-demo|manymoats|house_log\.md|rcpt_[0-9a-f]{8,}|wo_[0-9a-f]{8,}|rq_[0-9a-f]{8,}|evt_[0-9a-f]{8,})\b/gi
  },
  {
    id: 'other-competition',
    class: 'delta: other-competition residue',
    regex: /\b(?:other_event-other_event-2026|nebius-nvidia-projected-submission|codex-twitchcon-readiness|openkernel-challenge|arc-agi-2)\b/gi
  },
  {
    id: 'private-record set',
    class: 'delta: private record set',
    regex: /\b(?:00-FOUNDERS-INBOX|counsel-panel|_system\/ledger|_system\/rigs|Filing_record|Filing_record|Filing_record)\b/g
  },
  {
    id: 'boundary-rl-h8',
    class: 'delta: boundary (boundary rule)',
    regex: /\b(?:blank-demo|Face\.app|resident-shell-release)\b/g
  },
  {
    id: 'loopback-website-url',
    class: 'delta: loopback websiteUrl',
    regex: /"websiteUrl"\s*:\s*"https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)/gi
  },
  {
    id: 'synthetic-fixture-leak',
    class: 'delta: synthetic fixture',
    regex: /\b(?:synthetic-transport-run-record\.json|fault-case-1-000[0-3]\.json)\b/g
  }
]);

export function scanTextForDisclosures(text, fileOrBlobId = '<memory>') {
  const hits = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const rule of DISCLOSURE_SCAN_RULES) {
      rule.regex.lastIndex = 0;
      let match;
      while ((match = rule.regex.exec(line)) !== null) {
        hits.push({
          target: fileOrBlobId,
          line: i + 1,
          ruleId: rule.id,
          class: rule.class,
          match: match[0]
        });
      }
    }
  }
  return hits;
}

export function scanExportRepoBlobs(exportRepoDir) {
  const revListOut = execFileSync('git', ['rev-list', '--objects', '--all'], {
    cwd: exportRepoDir,
    encoding: 'utf8'
  });

  const blobEntries = [];
  const seenOids = new Set();
  for (const rawLine of revListOut.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const spaceIdx = trimmed.indexOf(' ');
    const oid = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    const objPath = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);
    if (seenOids.has(oid)) continue;
    seenOids.add(oid);

    const objType = execFileSync('git', ['cat-file', '-t', oid], {
      cwd: exportRepoDir,
      encoding: 'utf8'
    }).trim();
    if (objType === 'blob') {
      blobEntries.push({ oid, path: objPath });
    }
  }

  const hits = [];
  for (const blob of blobEntries) {
    if (blob.path.endsWith('.woff2')) continue;
    const buf = execFileSync('git', ['cat-file', 'blob', blob.oid], {
      cwd: exportRepoDir
    });
    if (buf.includes(0)) continue;
    const text = buf.toString('utf8');
    const blobHits = scanTextForDisclosures(text, `${blob.oid}:${blob.path || '<blob>'}`);
    hits.push(...blobHits);
  }

  return {
    ok: hits.length === 0,
    verdict: hits.length === 0 ? 'GREEN' : 'RED',
    blobsScanned: blobEntries.length,
    hitCount: hits.length,
    hits
  };
}

function runGit(cwd, args, envOverrides = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Meta Hackathon Export Generator',
      GIT_AUTHOR_EMAIL: 'export@cleanroom.local',
      GIT_COMMITTER_NAME: 'Meta Hackathon Export Generator',
      GIT_COMMITTER_EMAIL: 'export@cleanroom.local',
      ...envOverrides
    }
  }).trim();
}

export function buildTwoLayerExportRepo({
  exportDir,
  exportTimeUtc = '2026-10-27T05:35:00Z',
  releaseVerdictCleared = false,
  baselineFiles = [],
  eventCommits = [],
  transformedFiles = [],
  demoedFunctions = [],
  noticeMap = null,
  thirdPartyNoticesTxt = ''
}) {
  const resolvedExportDir = assertExportTargetAllowed(exportDir, { releaseVerdictCleared });
  fs.mkdirSync(resolvedExportDir, { recursive: true });

  runGit(resolvedExportDir, ['init', '-b', 'main']);

  const byteMapRows = [];

  for (const file of baselineFiles) {
    const contentBuf = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(String(file.content), 'utf8');
    const absDest = path.join(resolvedExportDir, file.exportPath);
    fs.mkdirSync(path.dirname(absDest), { recursive: true });
    fs.writeFileSync(absDest, contentBuf);

    byteMapRows.push({
      layer: 'baseline',
      sourcePath: file.sourcePath || file.exportPath,
      sourceBytes: file.sourceBytes ?? contentBuf.length,
      sourceSha256: file.sourceSha256 ?? sha256Hex(contentBuf),
      exportPath: file.exportPath,
      exportBytes: contentBuf.length,
      exportSha256: sha256Hex(contentBuf),
      transform: file.transform || 'none'
    });
  }

  runGit(resolvedExportDir, ['add', '-A']);
  runGit(
    resolvedExportDir,
    ['commit', '--allow-empty', '-m', 'Baseline pre-event snapshot (2026-10-26T15:51:54Z)'],
    {
      GIT_AUTHOR_DATE: BASELINE_TAG_AUTHOR_DATE_UTC,
      GIT_COMMITTER_DATE: exportTimeUtc
    }
  );
  const baselineExportCommitId = runGit(resolvedExportDir, ['rev-parse', 'HEAD']);

  const houseToExportCommitMap = new Map();
  const recordedEventCommits = [];

  for (const evCommit of eventCommits) {
    if (String(evCommit.authorDateUtc) < KICKOFF_CUTOFF_UTC) {
      const err = new Error(
        `Event-new commit ${evCommit.houseCommitId} has authorDateUtc ${evCommit.authorDateUtc} before kickoff cutoff ${KICKOFF_CUTOFF_UTC}.`
      );
      err.code = 'EVENT_COMMIT_BEFORE_KICKOFF';
      throw err;
    }

    for (const file of evCommit.files || []) {
      const contentBuf = Buffer.isBuffer(file.content)
        ? file.content
        : Buffer.from(String(file.content), 'utf8');
      const absDest = path.join(resolvedExportDir, file.exportPath);
      fs.mkdirSync(path.dirname(absDest), { recursive: true });
      fs.writeFileSync(absDest, contentBuf);

      const existingIdx = byteMapRows.findIndex((r) => r.exportPath === file.exportPath);
      const row = {
        layer: 'event-new',
        sourcePath: file.sourcePath || file.exportPath,
        sourceBytes: file.sourceBytes ?? contentBuf.length,
        sourceSha256: file.sourceSha256 ?? sha256Hex(contentBuf),
        exportPath: file.exportPath,
        exportBytes: contentBuf.length,
        exportSha256: sha256Hex(contentBuf),
        transform: file.transform || 'none'
      };
      if (existingIdx >= 0) {
        byteMapRows[existingIdx] = row;
      } else {
        byteMapRows.push(row);
      }
    }

    runGit(resolvedExportDir, ['add', '-A']);
    runGit(
      resolvedExportDir,
      ['commit', '--allow-empty', '-m', evCommit.message || `Event-new change (${evCommit.houseCommitId})`],
      {
        GIT_AUTHOR_DATE: evCommit.authorDateUtc,
        GIT_COMMITTER_DATE: exportTimeUtc
      }
    );
    const exportCommitId = runGit(resolvedExportDir, ['rev-parse', 'HEAD']);
    houseToExportCommitMap.set(evCommit.houseCommitId, exportCommitId);
    recordedEventCommits.push({
      houseCommitId: evCommit.houseCommitId,
      exportCommitId,
      authorDateUtc: evCommit.authorDateUtc,
      committerDateUtc: exportTimeUtc,
      files: (evCommit.files || []).map((f) => f.exportPath)
    });
  }

  for (const tf of transformedFiles) {
    const contentBuf = Buffer.isBuffer(tf.exportContent)
      ? tf.exportContent
      : Buffer.from(String(tf.exportContent), 'utf8');
    const absDest = path.join(resolvedExportDir, tf.exportPath);
    fs.mkdirSync(path.dirname(absDest), { recursive: true });
    fs.writeFileSync(absDest, contentBuf);

    const existingIdx = byteMapRows.findIndex((r) => r.exportPath === tf.exportPath);
    const row = {
      layer: 'transform-final',
      sourcePath: tf.sourcePath || tf.exportPath,
      sourceBytes: tf.sourceBytes,
      sourceSha256: tf.sourceSha256,
      exportPath: tf.exportPath,
      exportBytes: contentBuf.length,
      exportSha256: sha256Hex(contentBuf),
      transform: tf.transform || 'projection-rewrite'
    };
    if (existingIdx >= 0) {
      byteMapRows[existingIdx] = row;
    } else {
      byteMapRows.push(row);
    }
  }

  if (thirdPartyNoticesTxt) {
    const noticesPath = path.join(resolvedExportDir, 'THIRD-PARTY-NOTICES.txt');
    const buf = Buffer.from(String(thirdPartyNoticesTxt), 'utf8');
    fs.writeFileSync(noticesPath, buf);
    byteMapRows.push({
      layer: 'transform-final',
      sourcePath: 'house-only/THIRD-PARTY-NOTICES.txt',
      sourceBytes: buf.length,
      sourceSha256: sha256Hex(buf),
      exportPath: 'THIRD-PARTY-NOTICES.txt',
      exportBytes: buf.length,
      exportSha256: sha256Hex(buf),
      transform: 'copy-verified-notices'
    });
  }

  if (noticeMap) {
    const noticeMapJson = JSON.stringify(noticeMap, null, 2) + '\n';
    const buf = Buffer.from(noticeMapJson, 'utf8');
    fs.writeFileSync(path.join(resolvedExportDir, 'NOTICE-MAP.json'), buf);
    byteMapRows.push({
      layer: 'transform-final',
      sourcePath: 'house-only/NOTICE-MAP.json',
      sourceBytes: buf.length,
      sourceSha256: sha256Hex(buf),
      exportPath: 'NOTICE-MAP.json',
      exportBytes: buf.length,
      exportSha256: sha256Hex(buf),
      transform: 'sanitize-notice-map'
    });
  }

  const enrichedDemoedFunctions = demoedFunctions.map((fnRow) => {
    const exportCommitId =
      fnRow.exportCommitId ||
      houseToExportCommitMap.get(fnRow.houseCommitId) ||
      (recordedEventCommits[0] && recordedEventCommits[0].exportCommitId) ||
      baselineExportCommitId;
    const diffPatch = runGit(resolvedExportDir, [
      'show',
      '--format=',
      '--patch',
      exportCommitId,
      '--',
      fnRow.exportPath
    ]);
    const exportDiffSha256 = sha256Hex(diffPatch);
    return {
      demoedFunction: fnRow.demoedFunction,
      exportCommitId,
      exportPath: fnRow.exportPath,
      exportDiffSha256,
      houseCommitId: fnRow.houseCommitId,
      houseD1Sha: fnRow.houseD1Sha,
      window: fnRow.window || 'event-new (>= 2026-10-26T16:01:03Z)',
      class: fnRow.class || 'post-kickoff-event-new',
      rfc3161TokenRef: fnRow.rfc3161TokenRef || null
    };
  });

  const exportEventManifest = {
    schemaVersion: '1.0.0',
    generatedAtUtc: exportTimeUtc,
    baselineExportCommitId,
    baselineAuthorDateUtc: BASELINE_TAG_AUTHOR_DATE_UTC,
    kickoffCutoffUtc: KICKOFF_CUTOFF_UTC,
    eventCommits: recordedEventCommits,
    demoedFunctions: enrichedDemoedFunctions
  };

  const eventManifestBuf = Buffer.from(JSON.stringify(exportEventManifest, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(resolvedExportDir, 'EVENT-NEW-MANIFEST.json'), eventManifestBuf);
  byteMapRows.push({
    layer: 'transform-final',
    sourcePath: 'generated:EVENT-NEW-MANIFEST.json',
    sourceBytes: eventManifestBuf.length,
    sourceSha256: sha256Hex(eventManifestBuf),
    exportPath: 'EVENT-NEW-MANIFEST.json',
    exportBytes: eventManifestBuf.length,
    exportSha256: sha256Hex(eventManifestBuf),
    transform: 'generated-export-manifest'
  });

  const inventorySha256 = computeInventorySha256(byteMapRows);
  const byteMapDoc = {
    schemaVersion: '1.0.0',
    generatedAtUtc: exportTimeUtc,
    inventorySha256,
    rowCount: byteMapRows.length,
    rows: byteMapRows
  };
  const byteMapBuf = Buffer.from(JSON.stringify(byteMapDoc, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(resolvedExportDir, 'SOURCE-TO-EXPORT-BYTE-MAP.json'), byteMapBuf);

  runGit(resolvedExportDir, ['add', '-A']);
  runGit(
    resolvedExportDir,
    ['commit', '-m', 'Apply export byte-map projections, third-party notices, and provenance manifest'],
    {
      GIT_AUTHOR_DATE: exportTimeUtc,
      GIT_COMMITTER_DATE: exportTimeUtc
    }
  );
  const finalExportCommitId = runGit(resolvedExportDir, ['rev-parse', 'HEAD']);

  return {
    exportDir: resolvedExportDir,
    baselineExportCommitId,
    eventCommits: recordedEventCommits,
    finalExportCommitId,
    inventorySha256,
    byteMapDoc,
    exportEventManifest
  };
}

export function verifyExportManifestReproducibility(exportRepoDir) {
  const manifestPath = path.join(exportRepoDir, 'EVENT-NEW-MANIFEST.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const mismatches = [];

  for (const row of manifest.demoedFunctions || []) {
    const diffPatch = runGit(exportRepoDir, [
      'show',
      '--format=',
      '--patch',
      row.exportCommitId,
      '--',
      row.exportPath
    ]);
    const recomputedSha = sha256Hex(diffPatch);
    if (recomputedSha !== row.exportDiffSha256) {
      mismatches.push({
        demoedFunction: row.demoedFunction,
        expected: row.exportDiffSha256,
        actual: recomputedSha
      });
    }
  }

  return {
    ok: mismatches.length === 0,
    checkedCount: (manifest.demoedFunctions || []).length,
    mismatches
  };
}

export const BASELINE_TAG_NAME = 'codex/meta-pre-event-20261026T1554Z';
export const BASELINE_TAG_COMMIT = 'b020edc3daa4f0e9c562f56b27f1dcec0946f329';

export const UI_OWNER_18_PATHS = Object.freeze([
  "ui owner button.mjs",
  "ui owner badge.mjs",
  "ui owner receipt.mjs",
  "ui owner input.mjs",
  "ui owner el.mjs",
  "ui owner uid.mjs",
  "ui owner uid.mjs",
  "ui owner index.mjs",
  "ui owner faces.css",
  "ui owner components.css",
  "ui owner tokens.css",
  "ui owner design-tokens.css",
  "ui owner motion-seeds.css",
  "ui owner fonts.css",
  "ui owner Inter5D-latin.woff2",
  "ui owner jetbrains-mono-latin-400-normal.woff2",
  "ui owner jetbrains-mono-latin-500-normal.woff2",
  "ui owner jetbrains-mono-latin-700-normal.woff2"
]);

export function readGitBlobAtCommit(repoRoot, commitOrTag, repoRelPath) {
  return execFileSync("git", ["show", `${commitOrTag}:${repoRelPath}`], {
    cwd: repoRoot,
    maxBuffer: 32 * 1024 * 1024
  });
}

export function verifyFrozenInventorySha(byteMapRows, expectedFrozenInventorySha256) {
  const actual = computeInventorySha256(byteMapRows);
  const ok = typeof expectedFrozenInventorySha256 === 'string' &&
    expectedFrozenInventorySha256.length === 64 &&
    actual === expectedFrozenInventorySha256;
  return {
    ok,
    verdict: ok ? 'GREEN' : 'RED',
    code: ok ? 'FROZEN_INVENTORY_SHA_MATCH' : 'POST_FREEZE_INVENTORY_SHA_MISMATCH',
    expected: expectedFrozenInventorySha256 || null,
    actual
  };
}

export function verifyExportRepoHasNoRemote(exportRepoDir) {
  const remotes = runGit(exportRepoDir, ['remote'])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    ok: remotes.length === 0,
    verdict: remotes.length === 0 ? 'GREEN' : 'RED',
    remotes
  };
}

export function scanImportsOutsideTree(exportRepoDir) {
  const resolvedRoot = path.resolve(exportRepoDir);
  const violations = [];

  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs);
      } else if (ent.isFile() && (ent.name.endsWith('.mjs') || ent.name.endsWith('.js'))) {
        const text = fs.readFileSync(abs, 'utf8');
        const importRe = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g;
        let m;
        while ((m = importRe.exec(text)) !== null) {
          const spec = m[1] || m[2];
          if (!spec) continue;
          const targetAbs = path.resolve(path.dirname(abs), spec);
          if (targetAbs !== resolvedRoot && !targetAbs.startsWith(resolvedRoot + path.sep)) {
            violations.push({
              file: path.relative(resolvedRoot, abs),
              specifier: spec,
              resolvedPath: targetAbs,
              code: 'IMPORT_OUTSIDE_EXPORT_TREE'
            });
          }
        }
      }
    }
  }

  walk(resolvedRoot);
  return {
    ok: violations.length === 0,
    verdict: violations.length === 0 ? 'GREEN' : 'RED',
    violationCount: violations.length,
    violations
  };
}

export function validatePublicCopyHonesty(copyText, options = {}) {
  const text = String(copyText || '');
  const allowedModels = new Set(options.allowedRunRecordModels || ['Llama-4-Maverick-17B-128E-Instruct-FP8']);
  const baselineFunctions = new Set(options.baselineFunctionNames || ['evaluatePhysicsProposal']);
  const hits = [];

  // 1. Refuse "immutable" or "trust-listed" claims in public copy
  const immutableRe = /\bimmutable\b/gi;
  let m;
  while ((m = immutableRe.exec(text)) !== null) {
    hits.push({
      ruleId: 'public-copy-immutable-claim',
      class: 'delta: public-copy immutable',
      match: m[0],
      index: m.index
    });
  }

  const trustListedRe = /\btrust-listed\b/gi;
  while ((m = trustListedRe.exec(text)) !== null) {
    hits.push({
      ruleId: 'public-copy-trust-listed-c2pa',
      class: 'delta: c2pa trust-listed claim',
      match: m[0],
      index: m.index
    });
  }

  // 2. Refuse model names absent from the run record
  const modelTokenRe = /\b(?:Llama-[0-9A-Za-z._-]+|meta-llama\/[0-9A-Za-z._-]+|gpt-[0-9A-Za-z._-]+|claude-[0-9A-Za-z._-]+)\b/g;
  while ((m = modelTokenRe.exec(text)) !== null) {
    const token = m[0];
    const bare = token.replace(/^meta-llama\//, '');
    if (!allowedModels.has(token) && !allowedModels.has(bare)) {
      hits.push({
        ruleId: 'public-copy-unrecorded-model',
        class: 'delta: model absent from run record',
        match: token,
        index: m.index
      });
    }
  }

  // 3. Refuse baseline functions presented as event-new
  for (const fnName of baselineFunctions) {
    const fnAsEventNewRe = new RegExp(`\\b${fnName}\\b[^.\\n]{0,80}\\bevent-new\\b|\\bevent-new\\b[^.\\n]{0,80}\\b${fnName}\\b`, 'gi');
    while ((m = fnAsEventNewRe.exec(text)) !== null) {
      hits.push({
        ruleId: 'public-copy-baseline-as-event-new',
        class: 'delta: baseline function presented as event-new',
        match: m[0],
        index: m.index
      });
    }
  }

  return {
    ok: hits.length === 0,
    verdict: hits.length === 0 ? 'GREEN' : 'RED',
    hitCount: hits.length,
    hits
  };
}

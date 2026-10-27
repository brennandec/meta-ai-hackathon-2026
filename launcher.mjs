/**
 * Private Local Launcher for Minimal Demo Candidate.
 * (note removed for export)
 *
 * Architectural invariants:
 * 1. Binds existing accepted local owner modules in-place from
 * (note removed for export)
 *    including the transitive runtime dependency trajectory-bench.mjs imported by swarm-verifier.mjs.
 * (note removed for export)
 *    with canonical realpath and SHA-256 verification, plus `/`, `/index.html`, `/ui/index.html`
 *    -> `candidate/ui/index.html` and `/ui/preview.mjs` -> `candidate/ui/preview.mjs`.
 * 3. Never serves `ui/PRIVATE-ASSET-MANIFEST.json` or any undeclared path.
 * 4. Does NOT claim standalone portability (standalonePortabilityClaimed = false).
 * 5. Default external calls are BLOCKED; build and self-check use INJECTED SYNTHETIC TRANSPORT ONLY
 *    with zero real key loads and zero real model calls.
 * 6. Provides the trusted operator/server-owned one-attempt live-entry binding to the registered
 * (note removed for export)
 *    `fetch` without activating external calls by default.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import childProcess from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  HEX64_REGEX,
  sha256Sync,
  canonicalStringify
} from './app/meta-physics-agent.mjs';

import {
  DEFAULT_LLAMA_MODEL,
  CONFIGURABLE_LLAMA_MODELS,
  META_LLAMA_ENDPOINT,
  MAX_COMPLETION_TOKENS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  PROPOSAL_SCHEMA,
  MAX_BOUNDED_CORRECTIONS,
  GENESIS_RECEIPT_HASH,
  OFFLINE_LLAMA_FIXTURES,
  ALLOWED_PROVIDER_USAGE_COUNTERS,
  sanitizeProviderUsage,
  sanitizeProviderTraceString,
  classifySafeTransportError,
  requestLlamaPhysicsProposal,
  validateAuthoritativeCurrentState,
  deriveAuthoritativeStateSnapshot,
  evaluateAndGateLlamaProposal,
  generateKinematicProposalReceipt,
  verifyProposalReceiptChain,
  IMMUTABLE_PLANT_LIMITS,
  STATE_SNAPSHOT_FIELDS
} from './app/llama-adapter.mjs';

import {
  PLANT_MANIFEST,
  PLANT_MANIFEST_HASH,
  evaluateKinematicCritic,
  evaluateSafetyInterlock,
  evaluateInterlock,
  resolveSwarmQuorum,
  generateSwarmStepReceipt
} from './app/swarm-verifier.mjs';

import { validateRecord } from './tools/honesty-validator.mjs';

import {
  CANDIDATE_SCHEMA,
  PORTABILITY_STATUS,
  EXCLUDED_CANDIDATE_PATHS,
  EXACT_PRIVATE_OWNER_MOUNT_ALLOWLIST,
  resolveExactAllowlistedOwnerRow,
  buildSanitizedCandidateRunRecord,
  createPortableCandidateServer
} from './candidate-backend.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = fs.realpathSync(__dirname);
const CANONICAL_CONTRACT_REPO_ROOT = process.env.KPF_CANONICAL_REPO_ROOT
  ? fs.realpathSync(path.resolve(process.env.KPF_CANONICAL_REPO_ROOT))
  : REPO_ROOT;

export const DURABLE_LIVE_RUN_INTENT_REL_PATH =
  'fixtures/LIVE-RUN-INTENT.json';
export const DURABLE_LIVE_RUN_RECEIPT_REL_PATH =
  'fixtures/LIVE-RUN-RECEIPT.json';
export const DURABLE_LIVE_RUN_INTENT_PATH = path.resolve(REPO_ROOT, DURABLE_LIVE_RUN_INTENT_REL_PATH);
export const DURABLE_LIVE_RUN_RECEIPT_PATH = path.resolve(REPO_ROOT, DURABLE_LIVE_RUN_RECEIPT_REL_PATH);
export const DURABLE_LIVE_RUN_RESET_LOG_REL_PATH =
  'fixtures/LIVE-RUN-RESETS.jsonl';
export const DURABLE_LIVE_RUN_RESET_LOG_PATH = path.resolve(REPO_ROOT, DURABLE_LIVE_RUN_RESET_LOG_REL_PATH);
export const LIVE_RUN_RESET_SCHEMA = 'manymoats.meta_portable_demo_candidate.live_run_reset.v1';
export const LIVE_RUN_RESET_SUBJECT_PREFIX = 'live-run-reset-01';
export const PROVIDER_ERROR_BODY_CAP_BYTES = 2048;
export const CANDIDATE_ROOT = fs.realpathSync(__dirname);
export const LIVE_RUN_ATTEMPT_LATCH_STATE_ENV = 'KPF_LIVE_RUN_STATE_DIR';
export const LIVE_RUN_ATTEMPT_LATCH_STATE_SUBDIR = path.join('manymoats-demo', 'live-run-attempt-latch');
export const LIVE_RUN_ATTEMPT_LATCH_SCHEMA = 'manymoats.meta_portable_demo_candidate.live_run_attempt_latch.v2';
export const SYNTHETIC_DOOR_SIMULATOR_AUTHOR = 'synthetic-transport-door-simulator';
export const SYNTHETIC_DOOR_SIMULATOR_EVENT_TYPE = 'synthetic.wo.verified';
export const DOOR_PUT_SCRIPT_REL_PATH = path.join('scripts', 'lib', 'demo-door-put.mjs');
export const TRUTH_LEDGER_RECEIPTS_PATH = path.resolve(REPO_ROOT, 'house-only/receipts.jsonl');
export const TRUTH_LEDGER_EVENTS_PATH = path.resolve(REPO_ROOT, 'house-only/events.jsonl');
export const REGISTERED_KEY_LOADER_DEFAULT_KEY_FILE = path.join(
  os.homedir(),
  '.config/manymoats-demo/meta-hackathon.key'
);

export const LIVE_RUN_INTENT_SUBJECT =
  'live-run-intent-01: write-ahead one-attempt live-run-intent';

export function resolveRuntimeDoorAuthor(explicitAuthor = null) {
  if (typeof explicitAuthor === 'string' && explicitAuthor.trim().length > 0) {
    return explicitAuthor.trim();
  }
  const envAuthor =
    process.env.KPF_DOOR_AUTHOR ||
    process.env.KPF_SEAT_AUTHOR ||
    process.env.USER ||
    process.env.LOGNAME;
  if (typeof envAuthor === 'string' && envAuthor.trim().length > 0) {
    return envAuthor.trim();
  }
  try {
    const u = os.userInfo().username;
    if (typeof u === 'string' && u.trim().length > 0) {
      return u.trim();
    }
  } catch {
    // ignore os.userInfo error
  }
  return 'operator';
}

export function assertPathInsideTmpDir(targetPath, callerName = 'latch-helper') {
  if (typeof targetPath !== 'string' || targetPath.trim().length === 0) {
    const err = new Error(`${callerName} refused empty path outside os.tmpdir()`);
    err.code = 'REFUSED_NON_TMP_LATCH_PATH';
    throw err;
  }
  const realTmp = fs.realpathSync(os.tmpdir());
  const parentDir = fs.existsSync(targetPath)
    ? fs.realpathSync(targetPath)
    : (fs.existsSync(path.dirname(targetPath))
        ? path.join(fs.realpathSync(path.dirname(targetPath)), path.basename(targetPath))
        : path.resolve(targetPath));
  if (parentDir !== realTmp && !parentDir.startsWith(realTmp + path.sep)) {
    const err = new Error(
      `${callerName} refused path outside os.tmpdir(): ${targetPath} (resolved: ${parentDir})`
    );
    err.code = 'REFUSED_NON_TMP_LATCH_PATH';
    throw err;
  }
  return parentDir;
}

function realpathOfNearestExisting(targetPath) {
  const tail = [];
  let cur = path.resolve(targetPath);
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) {
      break;
    }
    tail.unshift(path.basename(cur));
    cur = parent;
  }
  return path.join(fs.realpathSync(cur), ...tail);
}

function isSameOrInside(childPath, parentPath) {
  return childPath === parentPath || childPath.startsWith(parentPath + path.sep);
}

export function assertAttemptLatchOutsideRepo(attemptLatchPath, { repoRoot = REPO_ROOT, candidateRoot = CANDIDATE_ROOT } = {}) {
  const resolved = realpathOfNearestExisting(attemptLatchPath);
  for (const root of [repoRoot, candidateRoot]) {
    const realRoot = fs.realpathSync(root);
    if (isSameOrInside(resolved, realRoot)) {
      const err = new Error(`Attempt latch path resolves inside the repo tree (${realRoot}): ${resolved}`);
      err.code = 'ATTEMPT_LATCH_PATH_INSIDE_REPO';
      throw err;
    }
  }
  return resolved;
}

export function resolveOperatorAttemptLatchPath({
  env = process.env,
  candidateRoot = CANDIDATE_ROOT,
  repoRoot = REPO_ROOT
} = {}) {
  const realCandidateRoot = fs.realpathSync(candidateRoot);
  const candidateRootSha256 = crypto.createHash('sha256').update(realCandidateRoot, 'utf8').digest('hex');
  const override = typeof env[LIVE_RUN_ATTEMPT_LATCH_STATE_ENV] === 'string' ? env[LIVE_RUN_ATTEMPT_LATCH_STATE_ENV] : '';
  const xdgStateHome = typeof env.XDG_STATE_HOME === 'string' ? env.XDG_STATE_HOME : '';
  let stateBase;
  let stateBaseSource;
  if (override.length > 0) {
    stateBase = override;
    stateBaseSource = LIVE_RUN_ATTEMPT_LATCH_STATE_ENV;
  } else if (xdgStateHome.length > 0) {
    stateBase = xdgStateHome;
    stateBaseSource = 'XDG_STATE_HOME';
  } else {
    stateBase = path.join(os.homedir(), '.local', 'state');
    stateBaseSource = 'HOME/.local/state';
  }
  if (!path.isAbsolute(stateBase)) {
    return {
      ok: false,
      code: 'ATTEMPT_LATCH_STATE_DIR_NOT_ABSOLUTE',
      reason: `${stateBaseSource} must be an absolute path; got ${JSON.stringify(stateBase)}`,
      stateBaseSource,
      candidateRootSha256
    };
  }
  const latchPath = path.join(stateBase, LIVE_RUN_ATTEMPT_LATCH_STATE_SUBDIR, `${candidateRootSha256}.json`);
  try {
    assertAttemptLatchOutsideRepo(latchPath, { repoRoot, candidateRoot: realCandidateRoot });
  } catch (err) {
    return {
      ok: false,
      code: err.code || 'ATTEMPT_LATCH_PATH_INSIDE_REPO',
      reason: err.message,
      stateBaseSource,
      candidateRootSha256
    };
  }
  return {
    ok: true,
    path: latchPath,
    stateBase,
    stateBaseSource,
    candidateRoot: realCandidateRoot,
    candidateRootSha256
  };
}

export const LIVE_RUN_INTENT_CONTRACT = Object.freeze({
  contractId: 'LIVE-RUN-INTENT-CONTRACT-01',
  intentDocumentPath: DURABLE_LIVE_RUN_INTENT_REL_PATH,
  intentDocumentFields: Object.freeze({
    schema: 'manymoats.meta_portable_demo_candidate.live_run_intent.v1',
    runId: 'run_<32-hex>',
    createdAt: '<ISO-8601-UTC>',
    transport: 'meta_api_https | synthetic_injected_transport',
    keyPathExists: 'boolean (fs.existsSync(DEFAULT_KEY_FILE) only; never key contents)',
    requestedModel: DEFAULT_LLAMA_MODEL,
    instructionSha256: '<64-hex-sha256>'
  }),
  doorPut: Object.freeze({
    script: 'house-only/demo-door-put.mjs',
    targetRelPath: DURABLE_LIVE_RUN_INTENT_REL_PATH,
    title: LIVE_RUN_INTENT_SUBJECT,
    subjectShape: LIVE_RUN_INTENT_SUBJECT,
    authorResolution:
      'resolveRuntimeDoorAuthor (KPF_DOOR_AUTHOR || KPF_SEAT_AUTHOR || USER || os.userInfo().username)',
    stdoutTokens: '<wo_id> <warden_receipt_id>'
  }),
  doorReceiptShape: Object.freeze({
    ledgerPath: 'house-only/receipts.jsonl',
    eventsPath: 'house-only/events.jsonl',
    openReceipt: Object.freeze({
      idPattern: '^rcpt_[0-9a-f]{16}$',
      kind: 'work-order',
      subject: LIVE_RUN_INTENT_SUBJECT,
      authorResolution:
        'resolveRuntimeDoorAuthor (non-door-verifier runtime seat/operator author)',
      refs: 'Array<string> ([path.resolve(repoRoot, intentDocumentPath)])',
      refsAreAbsolute: true,
      refsTargetRelPath: DURABLE_LIVE_RUN_INTENT_REL_PATH,
      contentSha256IsNotFileSha: true
    }),
    wardenReceipt: Object.freeze({
      idPattern: '^rcpt_[0-9a-f]{16}$',
      kind: 'work-order',
      subject: LIVE_RUN_INTENT_SUBJECT,
      author: 'door-verifier',
      refs: 'Array<string> ([woId, openReceiptId])',
      doorStdoutToken: true
    }),
    woVerifiedEventShape: Object.freeze({
      eventsPath: 'house-only/events.jsonl',
      type: 'wo.verified',
      author: 'door-verifier',
      receiptIdMatchesWardenReceipt: true,
      payloadWoMatchesWoId: true,
      verifiedCommandCarriesIntentFileSha256: true
    })
  }),
  recordBinding: Object.freeze({
    recordRunIdField: 'runId',
    nestedRunRecordRunIdField: 'runRecord.runId',
    recordIntentReceiptField: 'liveRunIntentReceipt',
    nestedRunRecordIntentReceiptField: 'runRecord.liveRunIntentReceipt',
    writeOrder:
      'launcher writes LIVE-RUN-INTENT.json and mints door receipt before first fetchImpl invocation; record.runId and record.runRecord.runId equal intentDocument.runId; liveRunIntentReceipt binds to the open receipt id (runtime seat/operator author, refs = [absPath]) verified alongside the wo.verified event carrying the intent file sha256'
  })
});

const SYNTHETIC_TRANSPORT_FNS = new WeakSet();
const EPHEMERAL_LATCH_DIRS = new Set();
let exitCleanupRegistered = false;
let injectedKeyLoaderSlot = null;
let processWideSyntheticLatch = null;
let injectedTestDurableLatch = null;

function registerEphemeralDirForCleanup(dirPath) {
  assertPathInsideTmpDir(dirPath, 'registerEphemeralDirForCleanup');
  EPHEMERAL_LATCH_DIRS.add(dirPath);
  if (!exitCleanupRegistered) {
    exitCleanupRegistered = true;
    process.once('exit', () => {
      for (const d of EPHEMERAL_LATCH_DIRS) {
        try {
          assertPathInsideTmpDir(d, 'exitCleanup');
          fs.rmSync(d, { recursive: true, force: true });
        } catch {
          // ignore exit cleanup error
        }
      }
    });
  }
}

function createSyntheticTransportDoorSimulator({
  rootDir,
  intentPath,
  receiptPath,
  ledgerPath,
  eventsPath,
  targetReceiptRelPath = DURABLE_LIVE_RUN_RECEIPT_REL_PATH
}) {
  const realRoot = assertPathInsideTmpDir(rootDir, 'createSyntheticTransportDoorSimulator');
  const insideRoot = (p) => {
    const resolved = realpathOfNearestExisting(p);
    if (!isSameOrInside(resolved, realRoot)) {
      const err = new Error(`synthetic door simulator refused a path outside its temp root: ${p}`);
      err.code = 'REFUSED_NON_TMP_LATCH_PATH';
      throw err;
    }
    return resolved;
  };
  return ({ relPath, content, title, author: callAuthor }) => {
    const resolvedAuthor = resolveRuntimeDoorAuthor(callAuthor);
    const dest = insideRoot(relPath === targetReceiptRelPath ? receiptPath : intentPath);
    const ledgerDest = insideRoot(ledgerPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content, 'utf8');
    const fileSha = crypto.createHash('sha256').update(content).digest('hex');
    const woId = `wo_${fileSha.slice(0, 16)}`;
    const openRcptId = `rcpt_${fileSha.slice(16, 32)}`;
    const simulatorRcptId = `rcpt_${fileSha.slice(32, 48)}`;
    const evtId = `evt_${fileSha.slice(48, 64)}`;
    const absRef = path.resolve(REPO_ROOT, relPath);
    const ts = new Date().toISOString();
    const openRow = JSON.stringify({
      v: 1,
      id: openRcptId,
      ts,
      kind: 'work-order',
      subject: title || LIVE_RUN_INTENT_SUBJECT,
      author: resolvedAuthor,
      refs: [absRef],
      content_sha256: crypto.createHash('sha256').update(`open-receipt:${woId}:${absRef}:${ts}`).digest('hex'),
      synthetic: true
    });
    const simulatorRow = JSON.stringify({
      v: 1,
      id: simulatorRcptId,
      ts,
      kind: 'work-order',
      subject: title || LIVE_RUN_INTENT_SUBJECT,
      author: SYNTHETIC_DOOR_SIMULATOR_AUTHOR,
      refs: [woId, openRcptId],
      content_sha256: crypto.createHash('sha256').update(`simulator-receipt:${woId}:${openRcptId}:${ts}`).digest('hex'),
      synthetic: true
    });
    fs.appendFileSync(ledgerDest, openRow + '\n' + simulatorRow + '\n', 'utf8');
    if (eventsPath) {
      const eventsDest = insideRoot(eventsPath);
      const verifiedCmd = `node -e 'const fs=require("fs");const c=require("crypto");process.exit(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex")===process.argv[2]?0:1)' '${absRef}' '${fileSha}'`;
      fs.appendFileSync(eventsDest, JSON.stringify({
        v: 1,
        id: evtId,
        ts,
        ts_source: 'synthetic-simulator',
        type: SYNTHETIC_DOOR_SIMULATOR_EVENT_TYPE,
        author: SYNTHETIC_DOOR_SIMULATOR_AUTHOR,
        receipt_id: simulatorRcptId,
        payload: {
          wo: woId,
          results: [{ cmd: verifiedCmd, pass: true }]
        },
        synthetic: true
      }) + '\n', 'utf8');
    }
    return { status: 0, stdout: `${woId} ${simulatorRcptId}\n`, stderr: '' };
  };
}

function buildTempLatchConfig(tmpDir, isSynthetic = true, { doorPutRunner = null } = {}) {
  assertPathInsideTmpDir(tmpDir, 'buildTempLatchConfig');
  registerEphemeralDirForCleanup(tmpDir);
  const intentPath = path.join(tmpDir, 'LIVE-RUN-INTENT.json');
  const receiptPath = path.join(tmpDir, 'LIVE-RUN-RECEIPT.json');
  const attemptLatchPath = path.join(tmpDir, 'LIVE-RUN-ATTEMPT-LATCH.json');
  const ledgerPath = path.join(tmpDir, 'receipts.jsonl');
  const eventsPath = path.join(tmpDir, 'events.jsonl');
  const targetIntentRelPath = DURABLE_LIVE_RUN_INTENT_REL_PATH;
  const targetReceiptRelPath = DURABLE_LIVE_RUN_RECEIPT_REL_PATH;
  const injected = typeof doorPutRunner === 'function';
  const useSimulator = isSynthetic && !injected;
  return {
    dir: tmpDir,
    isSynthetic,
    intentPath,
    receiptPath,
    attemptLatchPath,
    ledgerPath,
    eventsPath,
    targetIntentRelPath,
    targetReceiptRelPath,
    doorPutRunner: injected
      ? doorPutRunner
      : (useSimulator
          ? createSyntheticTransportDoorSimulator({
              rootDir: tmpDir,
              intentPath,
              receiptPath,
              ledgerPath,
              eventsPath,
              targetReceiptRelPath
            })
          : null),
    doorRunnerSource: injected ? 'injected-test-stub' : (useSimulator ? 'synthetic-transport-door-simulator' : 'none'),
    requiresInjectedDoorRunner: !isSynthetic,
    verifierAuthor: useSimulator ? SYNTHETIC_DOOR_SIMULATOR_AUTHOR : 'door-verifier',
    verifiedEventType: useSimulator ? SYNTHETIC_DOOR_SIMULATOR_EVENT_TYPE : 'wo.verified'
  };
}

function ensureProcessWideSyntheticLatch({ doorPutRunner = null } = {}) {
  if (processWideSyntheticLatch) {
    return processWideSyntheticLatch;
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-candidate-synth-latch-'));
  processWideSyntheticLatch = buildTempLatchConfig(tmpDir, true, { doorPutRunner });
  return processWideSyntheticLatch;
}

export function resetProcessWideSyntheticLatchForTest({ doorPutRunner = null } = {}) {
  if (processWideSyntheticLatch?.dir) {
    assertPathInsideTmpDir(processWideSyntheticLatch.dir, 'resetProcessWideSyntheticLatchForTest');
    fs.rmSync(processWideSyntheticLatch.dir, { recursive: true, force: true });
    EPHEMERAL_LATCH_DIRS.delete(processWideSyntheticLatch.dir);
    processWideSyntheticLatch = null;
  }
  return ensureProcessWideSyntheticLatch({ doorPutRunner });
}

export function injectTestDurableLatchRoot(tmpLatchRoot = null, { doorPutRunner = null } = {}) {
  if (tmpLatchRoot === null) {
    if (injectedTestDurableLatch?.dir) {
      assertPathInsideTmpDir(injectedTestDurableLatch.dir, 'injectTestDurableLatchRoot(clear)');
      fs.rmSync(injectedTestDurableLatch.dir, { recursive: true, force: true });
      EPHEMERAL_LATCH_DIRS.delete(injectedTestDurableLatch.dir);
    }
    injectedTestDurableLatch = null;
    return null;
  }
  assertPathInsideTmpDir(tmpLatchRoot, 'injectTestDurableLatchRoot');
  fs.mkdirSync(tmpLatchRoot, { recursive: true });
  injectedTestDurableLatch = buildTempLatchConfig(tmpLatchRoot, false, { doorPutRunner });
  return injectedTestDurableLatch;
}

export function cleanupProcessSyntheticLatch() {
  for (const d of Array.from(EPHEMERAL_LATCH_DIRS)) {
    try {
      assertPathInsideTmpDir(d, 'cleanupProcessSyntheticLatch');
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
    EPHEMERAL_LATCH_DIRS.delete(d);
  }
  processWideSyntheticLatch = null;
  injectedTestDurableLatch = null;
}

function getDurableRepoLatchConfig() {
  if (injectedTestDurableLatch) {
    return injectedTestDurableLatch;
  }
  const latchTarget = resolveOperatorAttemptLatchPath();
  return {
    isSynthetic: false,
    intentPath: DURABLE_LIVE_RUN_INTENT_PATH,
    receiptPath: DURABLE_LIVE_RUN_RECEIPT_PATH,
    resetLogPath: DURABLE_LIVE_RUN_RESET_LOG_PATH,
    attemptLatchPath: latchTarget.ok ? latchTarget.path : null,
    attemptLatchError: latchTarget.ok ? null : { code: latchTarget.code, reason: latchTarget.reason },
    attemptLatchStateBaseSource: latchTarget.stateBaseSource,
    candidateRootSha256: latchTarget.candidateRootSha256,
    ledgerPath: TRUTH_LEDGER_RECEIPTS_PATH,
    eventsPath: TRUTH_LEDGER_EVENTS_PATH,
    targetIntentRelPath: DURABLE_LIVE_RUN_INTENT_REL_PATH,
    targetReceiptRelPath: DURABLE_LIVE_RUN_RECEIPT_REL_PATH,
    doorPutRunner: null,
    doorRunnerSource: 'door-script',
    requiresInjectedDoorRunner: false,
    verifierAuthor: 'door-verifier',
    verifiedEventType: 'wo.verified'
  };
}

export function getActiveLauncherLatchState({ isSynthetic = true } = {}) {
  const ws = isSynthetic === false ? getDurableRepoLatchConfig() : ensureProcessWideSyntheticLatch();
  return {
    intentPath: ws.intentPath,
    receiptPath: ws.receiptPath,
    attemptLatchPath: ws.attemptLatchPath || null,
    attemptLatchError: ws.attemptLatchError || null,
    doorRunnerSource: ws.doorRunnerSource || null,
    ledgerPath: ws.ledgerPath,
    eventsPath: ws.eventsPath,
    targetIntentRelPath: ws.targetIntentRelPath,
    targetReceiptRelPath: ws.targetReceiptRelPath,
    ...checkDurableLiveOnceLatch(ws)
  };
}

export function engageDurableAttemptLatch(latchConfig, phase = 'write-ahead', code = null) {
  const attemptLatchPath = latchConfig && typeof latchConfig.attemptLatchPath === 'string'
    ? latchConfig.attemptLatchPath
    : null;
  if (!attemptLatchPath) {
    const pathError = latchConfig && latchConfig.attemptLatchError;
    return {
      engaged: false,
      created: false,
      code: (pathError && pathError.code) || 'ATTEMPT_LATCH_PATH_MISSING',
      reason: (pathError && pathError.reason) || 'Latch config carries no attemptLatchPath'
    };
  }
  const latchDoc = {
    schema: LIVE_RUN_ATTEMPT_LATCH_SCHEMA,
    phase,
    code,
    engagedAt: new Date().toISOString(),
    pid: process.pid,
    candidateRootSha256: crypto.createHash('sha256').update(CANDIDATE_ROOT, 'utf8').digest('hex')
  };
  try {
    assertAttemptLatchOutsideRepo(attemptLatchPath);
    fs.mkdirSync(path.dirname(attemptLatchPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(attemptLatchPath, JSON.stringify(latchDoc, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return { engaged: true, created: true, attemptLatchPath };
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      return { engaged: true, created: false, attemptLatchPath };
    }
    return {
      engaged: false,
      created: false,
      attemptLatchPath,
      code: (err && err.code) || 'ATTEMPT_LATCH_WRITE_FAILED',
      reason: err && err.message ? err.message : String(err)
    };
  }
}

export function describeAttemptLatchStateError(latchConfig) {
  const err = (latchConfig && latchConfig.attemptLatchError) || {};
  const code = typeof err.code === 'string' && err.code.length > 0 ? err.code : 'ATTEMPT_LATCH_PATH_MISSING';
  const source = (latchConfig && latchConfig.attemptLatchStateBaseSource) || LIVE_RUN_ATTEMPT_LATCH_STATE_ENV;
  let why;
  if (code === 'ATTEMPT_LATCH_STATE_DIR_NOT_ABSOLUTE') {
    why = `${source} is not an absolute path`;
  } else if (code === 'ATTEMPT_LATCH_PATH_INSIDE_REPO') {
    why = `${source} resolves inside the launcher root or the candidate folder`;
  } else {
    why = `${source} gives the attempt latch no durable home`;
  }
  return {
    code,
    reason: `${why}; the live attempt was refused before the door call, the key loader and any fetch.`,
    cause: Object.freeze({ code, stateBaseSource: source, stage: 'attempt-latch-state-dir' })
  };
}

export function injectRegisteredMetaHackathonLoadKey(loaderFn) {
  if (typeof loaderFn !== 'function') {
    const err = new TypeError('injectRegisteredMetaHackathonLoadKey requires a function');
    err.code = 'INVALID_KEY_LOADER_BINDING';
    throw err;
  }
  return injectCandidateKeyLoader(loaderFn);
}

export function injectCandidateKeyLoader(loaderFn) {
  if (loaderFn === null || loaderFn === undefined) {
    injectedKeyLoaderSlot = null;
    return null;
  }
  injectedKeyLoaderSlot = bindRegisteredZeroArgKeyLoader(loaderFn);
  return injectedKeyLoaderSlot;
}

export function getInjectedCandidateKeyLoader() {
  return injectedKeyLoaderSlot;
}

export async function populateLiveOnceKeyLoaderSlot({
  repoRoot = REPO_ROOT
} = {}) {
  if (typeof injectedKeyLoaderSlot === 'function') {
    return injectedKeyLoaderSlot;
  }
  if (REGISTERED_KEY_LOADER_INTERFACE_PIN.exportMode === 'HOUSE_ONLY_NOT_SHIPPED') {
    const err = new Error('The registered key loader is house-only and is not part of this export; inject a loader with injectRegisteredMetaHackathonLoadKey to run a live attempt.');
    err.code = 'KEY_LOADER_HOUSE_ONLY';
    throw err;
  }
  const canonicalRoot = fs.realpathSync(repoRoot);
  const keyLoaderAbs = path.resolve(canonicalRoot, REGISTERED_KEY_LOADER_INTERFACE_PIN.repoRelativePath);
  if (!fs.existsSync(keyLoaderAbs)) {
    const err = new Error(`Missing registered keyLoader file: ${REGISTERED_KEY_LOADER_INTERFACE_PIN.repoRelativePath}`);
    err.code = 'KEY_LOADER_PIN_MISSING';
    throw err;
  }
  const keyLoaderReal = fs.realpathSync(keyLoaderAbs);
  const keyLoaderBuf = fs.readFileSync(keyLoaderReal);
  const keyLoaderSha256 = crypto.createHash('sha256').update(keyLoaderBuf).digest('hex');
  if (
    keyLoaderBuf.length !== REGISTERED_KEY_LOADER_INTERFACE_PIN.expectedBytes ||
    keyLoaderSha256 !== REGISTERED_KEY_LOADER_INTERFACE_PIN.expectedSha256
  ) {
    const err = new Error('Registered keyLoader SHA-256 or byte count mismatch');
    err.code = 'KEY_LOADER_PIN_HASH_MISMATCH';
    throw err;
  }
  const imported = await import(pathToFileURL(keyLoaderReal).href);
  if (typeof imported.loadKey !== 'function') {
    const err = new Error('Registered keyLoader module did not export loadKey');
    err.code = 'KEY_LOADER_EXPORT_MISSING';
    throw err;
  }
  return injectCandidateKeyLoader(imported.loadKey);
}

export async function loadMountedRegisteredWidgetEl(uiMountResolver = createCanonicalUiMountResolver()) {
  const elUrlPath = exportOwnerUrlPathEndingWith('/faces/el.mjs');
  const mounted = uiMountResolver(elUrlPath);
  if (!mounted || mounted.allowed !== true || !(mounted.body instanceof Buffer)) {
    throw new Error(`Failed to resolve allowlisted ${elUrlPath}`);
  }
  const mod = await import(`data:text/javascript;base64,${mounted.body.toString('base64')}`);
  if (typeof mod.el !== 'function') {
    throw new Error('Mounted el.mjs did not export function el');
  }
  return mod.el;
}

const EXPORT_OWNER_ROWS = Object.freeze(Object.values(EXACT_PRIVATE_OWNER_MOUNT_ALLOWLIST));
const OWNER_URL_PREFIX = EXPORT_OWNER_ROWS[0].urlPath.slice(0, EXPORT_OWNER_ROWS[0].urlPath.length - EXPORT_OWNER_ROWS[0].repoRelativePath.length);
function exportOwnerUrlPathEndingWith(suffix) {
  const hits = EXPORT_OWNER_ROWS.filter((row) => row.urlPath.endsWith(suffix));
  if (hits.length !== 1) {
    const err = new Error(`Export owner row is not unique for ${suffix}`);
    err.code = 'EXPORT_OWNER_ROW_AMBIGUOUS';
    throw err;
  }
  return hits[0].urlPath;
}
const EXPORT_OWNER_PIN_SUBSTITUTIONS = Object.freeze({"b458b02a4a671bb304de32bf87d83770a3bca8ce0fdfa1e152d861e359eb4e98":{"expectedBytes":14158,"expectedSha256":"ead5624804360b8600c9b0fae3b4260d4733b352fa435bd7f7044ee9052c10ad"},"9040a1c814f90fbccdd4faee760e33330e4c6a54d2d5db559326b6bba7edb19c":{"expectedBytes":1677,"expectedSha256":"d113a60557af2e6fa55f51e15715ad4c10a5f4c57bc9e52007e0637978d8b2d8"}});
export const CANDIDATE_PRIVATE_OWNER_MOUNT_ALLOWLIST = Object.freeze(Object.fromEntries(
  EXPORT_OWNER_ROWS.map((row) => [row.urlPath, Object.freeze({ ...row, ...(EXPORT_OWNER_PIN_SUBSTITUTIONS[row.expectedSha256] || {}) })])
));

export const ACCEPTED_APP_SNAPSHOT_COMMIT = '12148715887a14c31dcac01f1463f6cf8ad7a1df';

export const HISTORICAL_ACCEPTED_APP_SNAPSHOT = Object.freeze({
  commit: ACCEPTED_APP_SNAPSHOT_COMMIT,
  appDirectory: 'app/',
  appFiles: 12,
  appBytes: 510074,
  appTreeSha256: 'ef930e96eddbef8f2d017d320b1b60203f83913b1dd1410baf65ef3513f504cd',
  status: 'IMMUTABLE_HISTORICAL_CHECKPOINT'
});

export const WORKING_APP_TREE_STATE = Object.freeze({
  baseCommit: ACCEPTED_APP_SNAPSHOT_COMMIT,
  appDirectory: 'app/',
  appFiles: 12,
  frozenFilesUnchangedCount: 10,
  authorizedModifiedFilesCount: 2,
  authorizedModifiedFiles: Object.freeze([
    'app/llama-adapter.mjs',
    'app/llama-adapter.test.mjs'
  ]),
  all12WorkingFilesUnchangedFrom121487: false,
  appBytes: 548479,
  appTreeSha256: 'fb2d8a90b85f7ccb379dccedfd5693c8d86c755f6e93d8c555e95375b453e4b0'
});

export const REGISTERED_KEY_LOADER_INTERFACE_PIN = Object.freeze({
  repoRelativePath: 'house-only/meta-hackathon-route.mjs',
  exportedSymbol: 'loadKey',
  zeroArgBinding: 'bindRegisteredZeroArgKeyLoader',
  expectedBytes: 7589,
  expectedSha256: 'a9da971148d5468c3e96336b372492f8b4ac780bb22ab7ced391aab44d6cf233',
  invokedDuringBuildOrTest: false,
  exportMode: 'HOUSE_ONLY_NOT_SHIPPED'
});

export const BOUND_LOCAL_OWNER_MODULES = Object.freeze([
  Object.freeze({
    role: 'deterministic_physics_and_sha256_owner',
    dependencyKind: 'direct_owner_import',
    repoRelativePath: 'app/meta-physics-agent.mjs',
    expectedBytes: 23626,
    expectedSha256: '8f357327bae3845d3ee7acc41a9fc5f24ad4ca004c41e3c40befea15541753a5',
    injectedSymbols: Object.freeze([
      'HEX64_REGEX',
      'sha256Sync',
      'canonicalStringify'
    ])
  }),
  Object.freeze({
    role: 'proposal_extraction_gate_correction_and_receipt_chain_owner',
    dependencyKind: 'direct_owner_import',
    repoRelativePath: 'app/llama-adapter.mjs',
    expectedBytes: 76272,
    expectedSha256: 'b0539b11e2c23612562b178b4f3d0d913e45c58df10a48dbef94cd0d24371e58',
    historical121487Bytes: 58338,
    historical121487Sha256: '7d0a87a4e2403580aed074840e7b241bdf4130ce37619ea5f0bf73c7596216c4',
    injectedSymbols: Object.freeze([
      'DEFAULT_LLAMA_MODEL',
      'CONFIGURABLE_LLAMA_MODELS',
      'META_LLAMA_ENDPOINT',
      'MAX_COMPLETION_TOKENS',
      'DEFAULT_REQUEST_TIMEOUT_MS',
      'PROPOSAL_SCHEMA',
      'MAX_BOUNDED_CORRECTIONS',
      'GENESIS_RECEIPT_HASH',
      'OFFLINE_LLAMA_FIXTURES',
      'ALLOWED_PROVIDER_USAGE_COUNTERS',
      'sanitizeProviderUsage',
      'sanitizeProviderTraceString',
      'classifySafeTransportError',
      'requestLlamaPhysicsProposal',
      'validateAuthoritativeCurrentState',
      'deriveAuthoritativeStateSnapshot',
      'evaluateAndGateLlamaProposal',
      'generateKinematicProposalReceipt',
      'verifyProposalReceiptChain'
    ])
  }),
  Object.freeze({
    role: 'critic_interlock_quorum_and_step_receipt_owner',
    dependencyKind: 'direct_owner_import',
    repoRelativePath: 'app/swarm-verifier.mjs',
    expectedBytes: 31929,
    expectedSha256: '2f119448c6540d11ae715326a6dc132737fcceb9461f1e589a45b0f456cafae2',
    injectedSymbols: Object.freeze([
      'PLANT_MANIFEST',
      'PLANT_MANIFEST_HASH',
      'evaluateKinematicCritic',
      'evaluateSafetyInterlock',
      'evaluateInterlock',
      'resolveSwarmQuorum',
      'generateSwarmStepReceipt'
    ])
  }),
  Object.freeze({
    role: 'transitive_trajectory_benchmark_fixtures_for_swarm_verifier',
    dependencyKind: 'transitive_from_swarm_verifier',
    importedBy: 'app/swarm-verifier.mjs',
    repoRelativePath: 'app/trajectory-bench.mjs',
    expectedBytes: 14646,
    expectedSha256: '4cbd9d0d0afb0c1010157effc7fc526624321a02ec6b1f0c65a96ede71d9a71d',
    injectedSymbols: Object.freeze([
      'NOMINAL_TRAJECTORY_5_STEP',
      'KINEMATIC_DRIFT_TRAJECTORY_5_STEP',
      'STRUCTURAL_LIMIT_TRAJECTORY_5_STEP'
    ])
  })
]);

export const FUTURE_REVIEWED_PACKAGE_MAPPING = Object.freeze([
  Object.freeze({
    currentLocalSource: 'app/meta-physics-agent.mjs',
    futureReviewedPackage: '@meta-demo/physics-core',
    futureEntrypoint: 'packages/physics-core/index.mjs',
    status: 'PENDING_ROOT_AND_LEGAL_REVIEW_NO_EXPORT',
    copiedIntoCandidate: false
  }),
  Object.freeze({
    currentLocalSource: 'app/llama-adapter.mjs',
    futureReviewedPackage: '@meta-demo/proposal-adapter',
    futureEntrypoint: 'packages/proposal-adapter/index.mjs',
    status: 'PENDING_ROOT_AND_LEGAL_REVIEW_NO_EXPORT',
    copiedIntoCandidate: false
  }),
  Object.freeze({
    currentLocalSource: 'app/swarm-verifier.mjs',
    futureReviewedPackage: '@meta-demo/swarm-critic-quorum',
    futureEntrypoint: 'packages/swarm-critic-quorum/index.mjs',
    status: 'PENDING_ROOT_AND_LEGAL_REVIEW_NO_EXPORT',
    copiedIntoCandidate: false
  }),
  Object.freeze({
    currentLocalSource: 'app/trajectory-bench.mjs',
    futureReviewedPackage: '@meta-demo/trajectory-bench-fixtures',
    futureEntrypoint: 'packages/trajectory-bench-fixtures/index.mjs',
    status: 'PENDING_ROOT_AND_LEGAL_REVIEW_NO_EXPORT',
    copiedIntoCandidate: false
  }),
  Object.freeze({
    currentLocalSource: 'the 18 registered UI owner rows listed in DEPENDENCY-CONTRACT.json',
    futureReviewedPackage: '@meta-demo/registered-ui-owners',
    futureEntrypoint: 'packages/registered-ui-owners/index.mjs',
    status: 'PRIVATE_LOCAL_MOUNT_ONLY_NO_EXPORT',
    copiedIntoCandidate: false
  }),
  Object.freeze({
    currentLocalSource: 'house-only/meta-hackathon-route.mjs#loadKey (bound as zero-arg server-owned keyLoader interface)',
    futureReviewedPackage: '@meta-demo/registered-auth-loader-slot',
    futureEntrypoint: 'packages/registered-auth-loader-slot/index.mjs',
    status: 'SYNTHETIC_INJECTION_IN_PREP_OR_OPERATOR_ONE_ATTEMPT_ONLY',
    copiedIntoCandidate: false
  }),
  Object.freeze({
    currentLocalSource: 'ui/{index.html,preview.mjs}',
    futureReviewedPackage: '@meta-demo/registered-ui-surface',
    futureEntrypoint: 'packages/registered-ui-surface/index.html',
    status: 'OWNED_EXCLUSIVELY_BY_ENTRY_VERIFICATION',
    copiedIntoCandidate: false
  })
]);

export const DEFAULT_PUBLIC_SYNTHETIC_LIVE_ATTEMPT = Object.freeze({
  instruction: 'Compute a verified warehouse stop control proposal within deterministic friction and structural limits.',
  currentState: Object.freeze({
    massKg: 500,
    velocityMps: 3,
    stopDistanceM: 2
  }),
  model: DEFAULT_LLAMA_MODEL
});

export const RUNTIME_DEPENDENCY_CONTRACT = Object.freeze({
  schema: 'meta-portable-demo-candidate-dependency-contract/1',
  candidateSchema: CANDIDATE_SCHEMA,
  portabilityStatus: PORTABILITY_STATUS,
  standalonePortabilityClaimed: false,
  ownerModulesCopiedIntoCandidate: false,
  acceptedAppSnapshotCommit: ACCEPTED_APP_SNAPSHOT_COMMIT,
  historicalAcceptedAppSnapshot: HISTORICAL_ACCEPTED_APP_SNAPSHOT,
  workingAppTreeState: WORKING_APP_TREE_STATE,
  externalCallsDefault: 'BLOCKED',
  transportModeInPreparation: 'INJECTED_SYNTHETIC_TRANSPORT_ONLY',
  realKeyLoadPerformed: false,
  realModelCallPerformed: false,
  registeredKeyLoaderInterfacePin: REGISTERED_KEY_LOADER_INTERFACE_PIN,
  liveRunIntentContract: LIVE_RUN_INTENT_CONTRACT,
  liveEntryContract: Object.freeze({
    endpoint: META_LLAMA_ENDPOINT,
    allowedModels: CONFIGURABLE_LLAMA_MODELS,
    defaultModel: DEFAULT_LLAMA_MODEL,
    responseFormat: 'json_schema',
    strictSchema: true,
    timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    maxCompletionTokens: MAX_COMPLETION_TOKENS,
    maxLiveAttemptsPerEntry: 1,
    retriesAllowed: 0,
    providerFallbackAllowed: false,
    ambientEnvKeyAllowed: false,
    callerKeyPathAllowed: false,
    requireConfirmedModelIdentityDefault: true
  }),
  uiMountContract: Object.freeze({
    uiOwnerSeat: 'entry_verification',
    indexRoutes: Object.freeze(['/', '/index.html', '/ui/index.html']),
    indexTarget: 'ui/index.html',
    indexMimeType: 'text/html; charset=utf-8',
    previewRoute: '/ui/preview.mjs',
    previewTarget: 'ui/preview.mjs',
    previewMimeType: 'text/javascript',
    manifestPath: 'ui/PRIVATE-ASSET-MANIFEST.json',
    manifestServedOverHttp: false,
    ownerUrlPrefix: OWNER_URL_PREFIX,
    exactAllowlistedOwnerRows: Object.keys(EXACT_PRIVATE_OWNER_MOUNT_ALLOWLIST).length
  }),
  nodeBuiltins: Object.freeze([
    'node:http',
    'node:fs',
    'node:path',
    'node:crypto',
    'node:url'
  ]),
  boundLocalOwnerModules: BOUND_LOCAL_OWNER_MODULES,
  exactPrivateOwnerMountAllowlist: CANDIDATE_PRIVATE_OWNER_MOUNT_ALLOWLIST,
  excludedRuntimeModules: Object.freeze([
    'app/rules-intake-gate.mjs',
    'app/stage5-contingency-adapters.mjs',
    'app/index.html'
  ]),
  excludedRoutes: EXCLUDED_CANDIDATE_PATHS,
  futureReviewedPackageMapping: FUTURE_REVIEWED_PACKAGE_MAPPING
});

/**
 * Binds accepted local owner exports without copying or modifying their source files.
 */
export function bindAcceptedLocalOwners() {
  return Object.freeze({
    DEFAULT_LLAMA_MODEL,
    CONFIGURABLE_LLAMA_MODELS,
    META_LLAMA_ENDPOINT,
    MAX_COMPLETION_TOKENS,
    DEFAULT_REQUEST_TIMEOUT_MS,
    PROPOSAL_SCHEMA,
    MAX_BOUNDED_CORRECTIONS,
    GENESIS_RECEIPT_HASH,
    HEX64_REGEX,
    PLANT_MANIFEST,
    PLANT_MANIFEST_HASH,
    OFFLINE_LLAMA_FIXTURES,
    ALLOWED_PROVIDER_USAGE_COUNTERS,
    sha256Sync,
    canonicalStringify,
    sanitizeProviderUsage,
    sanitizeProviderTraceString,
    classifySafeTransportError,
    requestLlamaPhysicsProposal,
    validateAuthoritativeCurrentState,
    deriveAuthoritativeStateSnapshot,
    evaluateAndGateLlamaProposal,
    generateKinematicProposalReceipt,
    verifyProposalReceiptChain,
    evaluateKinematicCritic,
    evaluateSafetyInterlock,
    evaluateInterlock,
    resolveSwarmQuorum,
    generateSwarmStepReceipt
  });
}

/**
 * Wraps a key loader function in a strict zero-argument server-owned call boundary.
 * Never passes caller-supplied paths or options to the underlying key loader.
 */
export function bindRegisteredZeroArgKeyLoader(loaderFn = injectedKeyLoaderSlot) {
  if (typeof loaderFn !== 'function') {
    const err = new TypeError('keyLoader binding requires a function');
    err.code = 'INVALID_KEY_LOADER_BINDING';
    throw err;
  }
  return function zeroArgServerKeyLoader(...args) {
    if (args.length > 0) {
      const err = new Error('Server-owned keyLoader must be invoked with zero arguments');
      err.code = 'KEY_LOADER_NON_ZERO_ARGS_FORBIDDEN';
      throw err;
    }
    return loaderFn();
  };
}

/**
 * Verifies that all 4 backend local owner modules (including transitive trajectory-bench.mjs),
 * the registered keyLoader interface module on disk, AND all 18 allowlisted UI owner files
 * match their pinned canonical paths, byte sizes, and SHA-256 digests.
 * Does NOT invoke loadKey() or read any keyfile.
 */
export function verifyBoundOwnerIntegrity(repoRoot = REPO_ROOT) {
  const canonicalRoot = fs.realpathSync(repoRoot);

  for (const mod of BOUND_LOCAL_OWNER_MODULES) {
    const absPath = path.resolve(canonicalRoot, mod.repoRelativePath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Missing bound local owner module: ${mod.repoRelativePath}`);
    }
    const realAbs = fs.realpathSync(absPath);
    if (realAbs !== absPath) {
      throw new Error(`Canonical path mismatch on ${mod.repoRelativePath}`);
    }
    const buf = fs.readFileSync(realAbs);
    const actualSha256 = crypto.createHash('sha256').update(buf).digest('hex');
    if (buf.length !== mod.expectedBytes || actualSha256 !== mod.expectedSha256) {
      throw new Error(
        `Bound owner integrity mismatch on ${mod.repoRelativePath}: expected ${mod.expectedSha256} (${mod.expectedBytes}B), got ${actualSha256} (${buf.length}B)`
      );
    }
  }

  if (REGISTERED_KEY_LOADER_INTERFACE_PIN.exportMode !== 'HOUSE_ONLY_NOT_SHIPPED') {
  const keyLoaderAbs = path.resolve(canonicalRoot, REGISTERED_KEY_LOADER_INTERFACE_PIN.repoRelativePath);
  if (!fs.existsSync(keyLoaderAbs)) {
    throw new Error(`Missing registered keyLoader interface file: ${REGISTERED_KEY_LOADER_INTERFACE_PIN.repoRelativePath}`);
  }
  const keyLoaderReal = fs.realpathSync(keyLoaderAbs);
  if (keyLoaderReal !== keyLoaderAbs) {
    throw new Error(`Canonical path mismatch on ${REGISTERED_KEY_LOADER_INTERFACE_PIN.repoRelativePath}`);
  }
  const keyLoaderBuf = fs.readFileSync(keyLoaderReal);
  const keyLoaderSha256 = crypto.createHash('sha256').update(keyLoaderBuf).digest('hex');
  if (
    keyLoaderBuf.length !== REGISTERED_KEY_LOADER_INTERFACE_PIN.expectedBytes ||
    keyLoaderSha256 !== REGISTERED_KEY_LOADER_INTERFACE_PIN.expectedSha256 ||
    (injectedKeyLoaderSlot !== null && typeof injectedKeyLoaderSlot !== 'function')
  ) {
    throw new Error(
      `Registered keyLoader interface integrity mismatch on ${REGISTERED_KEY_LOADER_INTERFACE_PIN.repoRelativePath}`
    );
  }
  } else if (injectedKeyLoaderSlot !== null && typeof injectedKeyLoaderSlot !== 'function') {
    throw new Error('Registered keyLoader slot holds a non-function value');
  }

  for (const row of Object.values(CANDIDATE_PRIVATE_OWNER_MOUNT_ALLOWLIST)) {
    const absPath = path.resolve(canonicalRoot, row.repoRelativePath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Missing allowlisted UI owner file: ${row.repoRelativePath}`);
    }
    const realAbs = fs.realpathSync(absPath);
    if (realAbs !== absPath) {
      throw new Error(`Canonical path mismatch on allowlisted UI owner file: ${row.repoRelativePath}`);
    }
    const buf = fs.readFileSync(realAbs);
    const actualSha256 = crypto.createHash('sha256').update(buf).digest('hex');
    if (buf.length !== row.expectedBytes || actualSha256 !== row.expectedSha256) {
      throw new Error(
        `Allowlisted UI owner hash mismatch on ${row.repoRelativePath}: expected ${row.expectedSha256} (${row.expectedBytes}B), got ${actualSha256} (${buf.length}B)`
      );
    }
  }

  return true;
}

/**
 * Creates the server-side canonical mount resolver for:
 * - `/ui/index.html` -> `candidate/ui/index.html`
 * - `/ui/preview.mjs` -> `candidate/ui/preview.mjs`
 * (note removed for export)
 * Never serves `ui/PRIVATE-ASSET-MANIFEST.json`, directories, or undeclared paths.
 */
export function createCanonicalUiMountResolver({
  repoRoot = REPO_ROOT,
  candidateDir = __dirname
} = {}) {
  const canonicalRepoRoot = fs.realpathSync(repoRoot);
  const canonicalCandidateDir = fs.realpathSync(candidateDir);
  const uiDir = path.join(canonicalCandidateDir, 'ui');

  return function resolveUiMount(urlPath) {
    if (urlPath === '/ui/index.html') {
      const target = path.join(uiDir, 'index.html');
      if (!fs.existsSync(target)) {
        return null;
      }
      const realTarget = fs.realpathSync(target);
      if (realTarget !== target) {
        return null;
      }
      return fs.readFileSync(realTarget, 'utf8');
    }

    if (urlPath === '/ui/preview.mjs') {
      const target = path.join(uiDir, 'preview.mjs');
      if (!fs.existsSync(target)) {
        return null;
      }
      const realTarget = fs.realpathSync(target);
      if (realTarget !== target) {
        return null;
      }
      return fs.readFileSync(realTarget, 'utf8');
    }

    if (typeof urlPath === 'string' && urlPath.startsWith(OWNER_URL_PREFIX)) {
      const row = CANDIDATE_PRIVATE_OWNER_MOUNT_ALLOWLIST[urlPath] || null;
      if (!row) {
        return {
          allowed: false,
          code: 'EXCLUDED_SURFACE',
          reason: `URL ${urlPath} is not in EXACT_PRIVATE_OWNER_MOUNT_ALLOWLIST`
        };
      }
      const absTarget = path.resolve(canonicalRepoRoot, row.repoRelativePath);
      if (!fs.existsSync(absTarget)) {
        return {
          allowed: false,
          code: 'MOUNT_NOT_FOUND',
          reason: `Allowlisted file missing on disk: ${row.repoRelativePath}`
        };
      }
      const realTarget = fs.realpathSync(absTarget);
      if (realTarget !== absTarget) {
        return {
          allowed: false,
          code: 'MOUNT_FORBIDDEN',
          reason: 'Symlink or non-canonical path rejected'
        };
      }
      const body = fs.readFileSync(realTarget);
      const actualSha256 = crypto.createHash('sha256').update(body).digest('hex');
      if (body.length !== row.expectedBytes || actualSha256 !== row.expectedSha256) {
        return {
          allowed: false,
          code: 'MOUNT_HASH_MISMATCH',
          reason: `SHA-256 or byte count mismatch on ${row.repoRelativePath}`
        };
      }
      return {
        allowed: true,
        mimeType: row.mimeType,
        body,
        bytes: body.length,
        sha256: actualSha256
      };
    }

    return null;
  };
}

/**
 * Constructs an injected synthetic transport (synthetic keyLoader + synthetic fetchImpl)
 * for local verification without loading any real keyfile or making any network request.
 */
export function createSyntheticTransport({
  proposal = OFFLINE_LLAMA_FIXTURES.nominal_warehouse_stop.proposal,
  model = DEFAULT_LLAMA_MODEL,
  reportedModel = model,
  includeModelInResponse = true,
  responseId = 'synthetic-chatcmpl-candidate-01',
  providerRequestIdHeader = 'synthetic-meta-req-candidate-01',
  httpStatus = 200,
  errorBody = null
} = {}) {
  let keyLoaderCalls = 0;
  let fetchCalls = 0;
  let lastKeyLoaderArgsLength = null;
  let lastFetchUrl = null;
  let lastFetchOptions = null;

  const syntheticKeyLoader = (...args) => {
    keyLoaderCalls += 1;
    lastKeyLoaderArgsLength = args.length;
    if (args.length > 0) {
      throw new Error('keyLoader must be invoked with zero arguments');
    }
    return {
      state: 'ready',
      key: 'SYNTHETIC_TEST_ONLY_CREDENTIAL_DO_NOT_USE'
    };
  };

  const syntheticFetchImpl = async (url, options = {}) => {
    fetchCalls += 1;
    lastFetchUrl = url;
    lastFetchOptions = options;
    const headers = {
      get(name) {
        const lower = String(name || '').toLowerCase();
        if (lower === 'x-request-id') {
          return providerRequestIdHeader;
        }
        return null;
      }
    };
    if (httpStatus < 200 || httpStatus >= 300) {
      return {
        ok: false,
        status: httpStatus,
        headers,
        async text() {
          return typeof errorBody === 'string'
            ? errorBody
            : JSON.stringify(errorBody || { error: { message: `Synthetic HTTP ${httpStatus} failure` } });
        }
      };
    }
    const payload = {
      id: responseId,
      usage: {
        prompt_tokens: 120,
        completion_tokens: 64,
        total_tokens: 184
      },
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: JSON.stringify(proposal)
          }
        }
      ]
    };
    if (includeModelInResponse && reportedModel !== undefined) {
      payload.model = reportedModel;
    }
    return {
      ok: true,
      status: httpStatus,
      headers,
      async json() {
        return payload;
      }
    };
  };

  SYNTHETIC_TRANSPORT_FNS.add(syntheticFetchImpl);

  return {
    syntheticKeyLoader,
    syntheticFetchImpl,
    getTelemetry() {
      return {
        keyLoaderCalls,
        fetchCalls,
        lastKeyLoaderArgsLength,
        lastFetchUrl,
        lastFetchOptions
      };
    }
  };
}

/**
 * Creates the private local candidate server bound to the accepted local owner modules
 * (note removed for export)
 * By default, external calls remain BLOCKED (allowExternalCalls: false).
 */
export function createPrivateLocalCandidateServer({
  serverAuth = { allowExternalCalls: false, rulesVerified: false, keyLoader: null },
  fetchImpl = null,
  registeredUiAsset = null,
  uiMountResolver = createCanonicalUiMountResolver()
} = {}) {
  verifyBoundOwnerIntegrity();
  const owners = bindAcceptedLocalOwners();
  const baseServer = createPortableCandidateServer({
    owners,
    serverAuth,
    fetchImpl,
    registeredUiAsset,
    uiMountResolver
  });

  const origEmit = baseServer.emit.bind(baseServer);
  baseServer.emit = function patchedEmit(event, req, res, ...rest) {
    if (event === 'request' && req && res) {
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      if (req.method === 'GET' && parsedUrl.pathname === '/api/candidate/replay') {
        const fixtureAbs = path.join(__dirname, 'fixtures', 'synthetic-transport-run-record.json');
        if (!fs.existsSync(fixtureAbs)) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ status: 'not_found', code: 'REPLAY_FIXTURE_NOT_FOUND' }));
          return true;
        }
        const fixtureObj = JSON.parse(fs.readFileSync(fixtureAbs, 'utf8'));
        const honestyRes = validateRecord(fixtureObj);
        res.writeHead(honestyRes.pass ? 200 : 422, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          status: honestyRes.pass ? 'ok' : 'refused',
          replayMode: true,
          honestyPass: honestyRes.pass,
          zeroWordMarkerSpec: fixtureObj.replayModeVisualSpec || null,
          uiMountGap: {
            gapId: 'GAPS-171',
            gapsRegistryPath: 'house-only/house log:186',
            gapsDoorWo: 'house-ref',
            gapsCommitSha: '9bd9012a355f7ceb08472e7f4ce334a81db60065',
            status: 'gap-open'
          },
          fixture: fixtureObj
        }));
        return true;
      }
    }
    return origEmit(event, req, res, ...rest);
  };

  return baseServer;
}

function attachDurableLatchToServer(baseServer, durableLatch) {
  if (!durableLatch) {
    return baseServer;
  }
  let serverRefusedOrLatched = false;
  const origEmit = baseServer.emit.bind(baseServer);
  baseServer.emit = function patchedDurableLatchEmit(event, req, res, ...rest) {
    if (event === 'request' && req && res) {
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      if (req.method === 'POST' && parsedUrl.pathname === '/api/llama/propose') {
        const refuseLatched = (latchCheck) => {
          serverRefusedOrLatched = true;
          res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            status: 'refused',
            code: 'LIVE_ONCE_LATCH_EXISTS',
            reason: `Durable live-once latch already engaged (${(latchCheck && latchCheck.reason) || 'PRIOR_ATTEMPT_REFUSED_OR_LATCHED'}); live server call is permanently refused.`,
            latchCheck
          }));
          return true;
        };
        const refuseMintFailed = (code, reason) => {
          serverRefusedOrLatched = true;
          const latchWrite = engageDurableAttemptLatch(durableLatch, 'refused-after-error', code);
          res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            status: 'refused',
            code,
            reason,
            attemptLatchEngaged: latchWrite.engaged === true
          }));
          return true;
        };
        const refuseLatchStateUnresolved = () => {
          serverRefusedOrLatched = true;
          const named = describeAttemptLatchStateError(durableLatch);
          res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            status: 'refused',
            code: named.code,
            reason: named.reason,
            cause: named.cause,
            attemptLatchEngaged: false
          }));
          return true;
        };
        if (serverRefusedOrLatched) {
          return refuseLatched({ latched: true, reason: 'PRIOR_ATTEMPT_REFUSED_OR_LATCHED' });
        }
        let mintRes;
        try {
          const preCheck = checkDurableLiveOnceLatch(durableLatch);
          if (preCheck.latched) {
            return refuseLatched(preCheck);
          }
          if (!durableLatch.attemptLatchPath && durableLatch.attemptLatchError) {
            return refuseLatchStateUnresolved();
          }
          const writeAhead = engageDurableAttemptLatch(durableLatch, 'write-ahead', null);
          if (!writeAhead.engaged) {
            const latchErr = new Error(`Write-ahead attempt latch not engaged: ${writeAhead.reason || writeAhead.code}`);
            latchErr.code = writeAhead.code || 'ATTEMPT_LATCH_WRITE_FAILED';
            throw latchErr;
          }
          if (!writeAhead.created) {
            return refuseLatched({ ...preCheck, latched: true, attemptLatchExists: true, reason: 'ATTEMPT_LATCH_FILE_PRESENT' });
          }
          serverRefusedOrLatched = true;
          mintRes = mintDoorLiveRunIntent({
            intentPath: durableLatch.intentPath,
            targetIntentRelPath: durableLatch.targetIntentRelPath || DURABLE_LIVE_RUN_INTENT_REL_PATH,
            ledgerPath: durableLatch.ledgerPath,
            eventsPath: durableLatch.eventsPath || null,
            transport: durableLatch.isSynthetic ? 'synthetic_injected_transport' : 'meta_api_https',
            keyPathExists: durableLatch.isSynthetic ? false : undefined,
            requestedModel: DEFAULT_LLAMA_MODEL,
            instruction: 'createTrustedOperatorLiveEntryServer live attempt',
            doorPutRunner: durableLatch.doorPutRunner || null,
            requiresInjectedDoorRunner: durableLatch.requiresInjectedDoorRunner === true,
            verifierAuthor: durableLatch.verifierAuthor || 'door-verifier',
            verifiedEventType: durableLatch.verifiedEventType || 'wo.verified'
          });
        } catch (mintErr) {
          return refuseMintFailed(
            'LIVE_RUN_INTENT_DOOR_MINT_FAILED',
            `Pre-mint or mint failure: ${mintErr && mintErr.message ? mintErr.message : String(mintErr)}`
          );
        }

        if (!mintRes.ok) {
          return refuseMintFailed(mintRes.code || 'LIVE_RUN_INTENT_DOOR_MINT_FAILED', mintRes.reason);
        }
        req.headers['x-demo-run-id'] = mintRes.runId;
        req.headers['x-demo-intent-receipt'] = mintRes.receiptToken || '';
      }
    }
    return origEmit(event, req, res, ...rest);
  };
  return baseServer;
}

export function scanFullLedgerForTargets(
  ledgerPath,
  targetIntentRelPath = DURABLE_LIVE_RUN_INTENT_REL_PATH,
  targetReceiptRelPath = DURABLE_LIVE_RUN_RECEIPT_REL_PATH
) {
  if (!ledgerPath || !fs.existsSync(ledgerPath)) {
    return { ledgerEntryFound: false, matchedLedgerId: null };
  }
  const stat = fs.statSync(ledgerPath);
  if (stat.size <= 0) {
    return { ledgerEntryFound: false, matchedLedgerId: null };
  }
  const chunkSize = 4 * 1024 * 1024;
  const buf = Buffer.allocUnsafe(Math.min(chunkSize, stat.size));
  const fd = fs.openSync(ledgerPath, 'r');
  let offset = 0;
  let carry = '';
  let ledgerEntryFound = false;
  let matchedLedgerId = null;

  const inspectLine = (line) => {
    if (!line) return;
    const matchesTarget =
      (targetIntentRelPath && line.includes(targetIntentRelPath)) ||
      (targetReceiptRelPath && line.includes(targetReceiptRelPath));
    if (matchesTarget && /"(rcpt_|wo_)[0-9a-f]+"/i.test(line)) {
      ledgerEntryFound = true;
      const m = line.match(/"((?:rcpt_|wo_)[0-9a-f]+)"/i);
      matchedLedgerId = m ? m[1] : 'ledger_entry';
    }
  };

  try {
    while (offset < stat.size) {
      const toRead = Math.min(buf.length, stat.size - offset);
      const bytesRead = fs.readSync(fd, buf, 0, toRead, offset);
      if (bytesRead <= 0) break;
      offset += bytesRead;
      const text = carry + buf.subarray(0, bytesRead).toString('utf8');
      const lines = text.split('\n');
      carry = lines.pop() || '';
      for (let i = 0; i < lines.length; i += 1) {
        inspectLine(lines[i]);
      }
    }
    if (carry) {
      inspectLine(carry);
    }
  } finally {
    fs.closeSync(fd);
  }

  return { ledgerEntryFound, matchedLedgerId };
}

export function checkDurableLiveOnceLatch({
  intentPath = DURABLE_LIVE_RUN_INTENT_PATH,
  receiptPath = DURABLE_LIVE_RUN_RECEIPT_PATH,
  ledgerPath = TRUTH_LEDGER_RECEIPTS_PATH,
  targetIntentRelPath = DURABLE_LIVE_RUN_INTENT_REL_PATH,
  targetReceiptRelPath = DURABLE_LIVE_RUN_RECEIPT_REL_PATH,
  attemptLatchPath = null,
  resetLogPath = null,
  eventsPath = null,
  verifierAuthor = 'door-verifier',
  verifiedEventType = 'wo.verified'
} = {}) {
  const attemptLatchExists = Boolean(attemptLatchPath && fs.existsSync(attemptLatchPath));
  const intentExists = Boolean(intentPath && fs.existsSync(intentPath));
  const receiptExists = Boolean(receiptPath && fs.existsSync(receiptPath));
  let ledgerScan;
  let ledgerReadError = null;
  try {
    ledgerScan = scanFullLedgerForTargets(ledgerPath, targetIntentRelPath, targetReceiptRelPath);
  } catch (err) {
    if (!attemptLatchExists && !intentExists && !receiptExists) {
      throw err;
    }
    ledgerReadError = (err && err.code) || 'LEDGER_READ_FAILED';
    ledgerScan = { ledgerEntryFound: false, matchedLedgerId: null };
  }
  const { ledgerEntryFound, matchedLedgerId } = ledgerScan;

  let resetCoverage = null;
  if (!attemptLatchExists && (intentExists || receiptExists || ledgerEntryFound) && resetLogPath) {
    resetCoverage = resolveVerifiedResetCoverage({ resetLogPath, intentPath, receiptPath, eventsPath, verifierAuthor, verifiedEventType });
  }
  const resetCovered = Boolean(resetCoverage && resetCoverage.covered);
  const latched = attemptLatchExists || (!resetCovered && (intentExists || receiptExists || ledgerEntryFound));
  let reason = null;
  if (!latched) {
    reason = null;
  } else if (intentExists && ledgerEntryFound) {
    reason = 'DISK_AND_LEDGER_LATCH_PRESENT';
  } else if (intentExists || receiptExists) {
    reason = 'DISK_LATCH_FILE_PRESENT';
  } else if (ledgerEntryFound) {
    reason = 'LEDGER_RECEIPT_PRESENT';
  } else if (attemptLatchExists) {
    reason = 'ATTEMPT_LATCH_FILE_PRESENT';
  }

  return {
    latched,
    reason,
    intentExists,
    receiptExists,
    ledgerEntryFound,
    matchedLedgerId,
    attemptLatchExists,
    ledgerReadError,
    resetCovered,
    resetCoverage
  };
}

function matchVerifiedFileEventLine(line, { fileSha256, absRef, verifierAuthor, verifiedEventType }) {
  if (!line || !line.includes(fileSha256) || !line.includes(verifiedEventType)) {
    return null;
  }
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    return null;
  }
  if (row.type !== verifiedEventType || row.author !== verifierAuthor) {
    return null;
  }
  const results = Array.isArray(row.payload?.results) ? row.payload.results : [];
  const pass = results.some((r) => r && r.pass === true && typeof r.cmd === 'string' && r.cmd.includes(fileSha256) && r.cmd.includes(absRef));
  return pass ? { woId: row.payload?.wo || null, eventId: row.id || null, receiptId: row.receipt_id || null } : null;
}

export function findVerifiedEventForFile({ eventsPath, fileSha256, absRef, verifierAuthor = 'door-verifier', verifiedEventType = 'wo.verified' } = {}) {
  if (!eventsPath || typeof fileSha256 !== 'string' || typeof absRef !== 'string') {
    return null;
  }
  let st;
  try {
    st = fs.statSync(eventsPath);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size <= 0) {
    return null;
  }
  const want = { fileSha256, absRef, verifierAuthor, verifiedEventType };
  const fd = fs.openSync(eventsPath, 'r');
  try {
    const chunkSize = 4 * 1024 * 1024;
    let pos = st.size;
    let carry = '';
    while (pos > 0) {
      const n = Math.min(chunkSize, pos);
      pos -= n;
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, pos);
      const lines = (buf.toString('utf8') + carry).split('\n');
      carry = lines.shift() || '';
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const hit = matchVerifiedFileEventLine(lines[i], want);
        if (hit) {
          return hit;
        }
      }
    }
    return matchVerifiedFileEventLine(carry, want);
  } finally {
    fs.closeSync(fd);
  }
}

function sha256OfFileOrNull(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function resolveVerifiedResetCoverage({
  resetLogPath,
  intentPath,
  receiptPath,
  eventsPath,
  verifierAuthor = 'door-verifier',
  verifiedEventType = 'wo.verified'
} = {}) {
  const uncovered = (code) => ({ covered: false, code });
  if (!resetLogPath || !fs.existsSync(resetLogPath)) {
    return uncovered('RESET_RECORD_ABSENT');
  }
  let logBuf;
  try {
    logBuf = fs.readFileSync(resetLogPath);
  } catch {
    return uncovered('RESET_LOG_UNREADABLE');
  }
  const lines = logBuf.toString('utf8').split('\n').filter((l) => l.trim().length > 0);
  let last = null;
  try {
    last = JSON.parse(lines[lines.length - 1]);
  } catch {
    return uncovered('RESET_LOG_MALFORMED');
  }
  if (!last || last.schema !== LIVE_RUN_RESET_SCHEMA) {
    return uncovered('RESET_LOG_MALFORMED');
  }
  if (last.candidateRootSha256 !== crypto.createHash('sha256').update(CANDIDATE_ROOT, 'utf8').digest('hex')) {
    return uncovered('RESET_RECORD_OTHER_ROOT');
  }
  if (sha256OfFileOrNull(intentPath) !== (last.priorIntentSha256 ?? null) || sha256OfFileOrNull(receiptPath) !== (last.priorReceiptSha256 ?? null)) {
    return uncovered('RESET_RECORD_STALE');
  }
  const logSha256 = crypto.createHash('sha256').update(logBuf).digest('hex');
  const event = findVerifiedEventForFile({ eventsPath, fileSha256: logSha256, absRef: resetLogPath, verifierAuthor, verifiedEventType });
  if (!event || !event.woId) {
    return uncovered('RESET_RECORD_UNVERIFIED');
  }
  return { covered: true, code: 'RESET_RECORD_COVERS', resetId: last.resetId || null, resetWoId: event.woId, eventId: event.eventId };
}

function readTailJsonlLines(filePath, maxBytes = 4 * 1024 * 1024) {
  if (!filePath) {
    return [];
  }
  let st;
  try {
    st = fs.statSync(filePath);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
  if (!st.isFile()) {
    const err = new Error(`Ledger path is not a regular file: ${filePath}`);
    err.code = 'LEDGER_READ_NOT_A_FILE';
    throw err;
  }
  if (st.size <= 0) {
    return [];
  }
  const len = Math.min(st.size, maxBytes);
  const buf = Buffer.allocUnsafe(len);
  const fd = fs.openSync(filePath, 'r');
  try {
    let filled = 0;
    while (filled < len) {
      const n = fs.readSync(fd, buf, filled, len - filled, st.size - len + filled);
      if (n <= 0) {
        const err = new Error(`Short read on ledger file: ${filePath} (${filled}/${len} B)`);
        err.code = 'LEDGER_READ_SHORT';
        throw err;
      }
      filled += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  const text = buf.toString('utf8');
  const lines = text.split('\n');
  if (st.size > len && lines.length > 1) {
    lines.shift();
  }
  return lines.filter(Boolean);
}
export function resolveDoorIntentReceiptFromLedger({
  ledgerPath = TRUTH_LEDGER_RECEIPTS_PATH,
  eventsPath = TRUTH_LEDGER_EVENTS_PATH,
  woId = null,
  wardenReceiptToken = null,
  absExpectedRef,
  intentSha256,
  expectedSubject = LIVE_RUN_INTENT_SUBJECT,
  seatAuthor = null,
  repoRoot = REPO_ROOT,
  verifierAuthor = 'door-verifier',
  verifiedEventType = 'wo.verified'
} = {}) {
  const resolvedExpectedRef = path.resolve(repoRoot, String(absExpectedRef || ''));
  let verifiedEventRow = null;
  let fileShaVerifiedInEvent = false;
  let resolvedWoId = woId;
  let resolvedWardenId = wardenReceiptToken;

  const eventLines = readTailJsonlLines(eventsPath);
  for (let i = eventLines.length - 1; i >= 0; i -= 1) {
    const line = eventLines[i];
    if (!line.includes(verifiedEventType)) continue;
    if (resolvedWoId && !line.includes(resolvedWoId)) continue;
    if (resolvedWardenId && !line.includes(resolvedWardenId)) continue;
    try {
      const row = JSON.parse(line);
      if (row.type !== verifiedEventType || row.author !== verifierAuthor) continue;
      if (resolvedWoId && row.payload?.wo !== resolvedWoId) continue;
      if (resolvedWardenId && row.receipt_id !== resolvedWardenId) continue;
      const results = Array.isArray(row.payload?.results) ? row.payload.results : [];
      const matchingResult = results.find(
        (r) =>
          r &&
          r.pass === true &&
          typeof r.cmd === 'string' &&
          r.cmd.includes(intentSha256) &&
          r.cmd.includes(resolvedExpectedRef)
      );
      if (matchingResult) {
        verifiedEventRow = row;
        fileShaVerifiedInEvent = true;
        resolvedWoId = row.payload?.wo || resolvedWoId;
        resolvedWardenId = row.receipt_id || resolvedWardenId;
        break;
      }
    } catch {
      // ignore malformed line
    }
  }

  let wardenReceiptRow = null;
  let openRefFromWarden = null;
  let openReceiptRow = null;
  const ledgerLines = readTailJsonlLines(ledgerPath);

  for (let i = ledgerLines.length - 1; i >= 0; i -= 1) {
    const line = ledgerLines[i];
    if (!wardenReceiptRow && ((resolvedWardenId && line.includes(resolvedWardenId)) || (resolvedWoId && line.includes(resolvedWoId)))) {
      try {
        const row = JSON.parse(line);
        const refs = Array.isArray(row.refs) ? row.refs.map(String) : [];
        if (
          row.kind === 'work-order' &&
          row.author === verifierAuthor &&
          (!expectedSubject || row.subject === expectedSubject) &&
          ((resolvedWardenId && row.id === resolvedWardenId) || (resolvedWoId && refs.includes(resolvedWoId)))
        ) {
          wardenReceiptRow = row;
          openRefFromWarden = refs.find((r) => /^rcpt_[0-9a-f]{16}$/i.test(r)) || null;
        }
      } catch {
        // ignore malformed line
      }
    }
  }

  for (let i = ledgerLines.length - 1; i >= 0; i -= 1) {
    const line = ledgerLines[i];
    if (openRefFromWarden && !line.includes(openRefFromWarden)) continue;
    try {
      const row = JSON.parse(line);
      const refs = Array.isArray(row.refs) ? row.refs.map((r) => path.resolve(repoRoot, String(r))) : [];
      const authorMatches =
        typeof seatAuthor === 'string' && seatAuthor.trim().length > 0
          ? row.author === seatAuthor.trim()
          : (typeof row.author === 'string' && row.author.length > 0 && row.author !== 'door-verifier' && row.author !== verifierAuthor);
      if (
        row.kind === 'work-order' &&
        (!expectedSubject || row.subject === expectedSubject) &&
        authorMatches &&
        refs.includes(resolvedExpectedRef) &&
        typeof row.id === 'string' &&
        /^rcpt_[0-9a-f]{16}$/i.test(row.id) &&
        typeof row.content_sha256 === 'string' &&
        row.content_sha256 !== intentSha256 &&
        row.sha256 === undefined &&
        (!openRefFromWarden || row.id === openRefFromWarden)
      ) {
        openReceiptRow = row;
        break;
      }
    } catch {
      // ignore malformed line
    }
  }

  return {
    matched: Boolean(openReceiptRow && verifiedEventRow && fileShaVerifiedInEvent),
    openReceiptId: openReceiptRow?.id || null,
    wardenReceiptId: wardenReceiptRow?.id || resolvedWardenId || null,
    woId: resolvedWoId,
    fileShaVerifiedInEvent,
    openReceiptRow,
    wardenReceiptRow,
    verifiedEventRow
  };
}

export function mintDoorLiveRunIntent({
  intentPath = DURABLE_LIVE_RUN_INTENT_PATH,
  targetIntentRelPath = DURABLE_LIVE_RUN_INTENT_REL_PATH,
  ledgerPath = TRUTH_LEDGER_RECEIPTS_PATH,
  eventsPath = TRUTH_LEDGER_EVENTS_PATH,
  runId = null,
  transport = 'meta_api_https',
  keyPathExists = undefined,
  requestedModel = DEFAULT_LLAMA_MODEL,
  instruction = '',
  author = null,
  doorPutRunner = null,
  requiresInjectedDoorRunner = false,
  verifierAuthor = 'door-verifier',
  verifiedEventType = 'wo.verified'
} = {}) {
  try {
  const injectedRunner = typeof doorPutRunner === 'function';
  if (!injectedRunner && requiresInjectedDoorRunner === true) {
    return {
      ok: false,
      code: 'TEST_DOOR_RUNNER_NOT_INJECTED',
      reason: 'This latch config was built for a test and carries no injected door runner; the door script is never spawned for it and nothing was written.'
    };
  }
  const doorScriptAbs = path.join(REPO_ROOT, DOOR_PUT_SCRIPT_REL_PATH);
  if (!injectedRunner) {
    let doorScriptIsFile = false;
    try {
      doorScriptIsFile = fs.statSync(doorScriptAbs).isFile();
    } catch {
      doorScriptIsFile = false;
    }
    if (!doorScriptIsFile) {
      return {
        ok: false,
        code: 'DOOR_SCRIPT_MISSING',
        reason: `Door script ${DOOR_PUT_SCRIPT_REL_PATH} is absent under the launcher root; the live-run intent was not minted and nothing was written to any ledger.`,
        doorScriptRelPath: DOOR_PUT_SCRIPT_REL_PATH
      };
    }
  }
  const runtimeAuthor = resolveRuntimeDoorAuthor(author);
  const resolvedRunId =
    typeof runId === 'string' && /^run_[0-9a-f]{16,64}$/i.test(runId)
      ? runId
      : `run_${crypto.randomBytes(16).toString('hex')}`;
  const defaultKeyFilePath = REGISTERED_KEY_LOADER_DEFAULT_KEY_FILE;
  const resolvedKeyPathExists =
    typeof keyPathExists === 'boolean'
      ? keyPathExists
      : (transport === 'synthetic_injected_transport' ? false : Boolean(fs.existsSync(defaultKeyFilePath)));

  const intentDoc = {
    schema: 'manymoats.meta_portable_demo_candidate.live_run_intent.v1',
    runId: resolvedRunId,
    createdAt: new Date().toISOString(),
    transport:
      transport === 'synthetic_injected_transport'
        ? 'synthetic_injected_transport'
        : 'meta_api_https',
    keyPathExists: resolvedKeyPathExists,
    requestedModel,
    instructionSha256: sha256Sync(String(instruction || ''))
  };
  const serialized = JSON.stringify(intentDoc, null, 2) + '\n';
  const intentSha256 = crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');

  const runner =
    injectedRunner
      ? doorPutRunner
      : ({ relPath, content, title, author: callAuthor }) => {
          return childProcess.spawnSync(
            process.execPath,
            [
              doorScriptAbs,
              path.resolve(REPO_ROOT, relPath),
              title,
              resolveRuntimeDoorAuthor(callAuthor || runtimeAuthor)
            ],
            {
              cwd: REPO_ROOT,
              input: content,
              encoding: 'utf8',
              timeout: 60000
            }
          );
        };

  let proc = null;
  try {
    proc = runner({
      relPath: targetIntentRelPath,
      absPath: intentPath,
      ledgerPath,
      eventsPath,
      content: serialized,
      title: LIVE_RUN_INTENT_SUBJECT
    });
  } catch (err) {
    return {
      ok: false,
      code: 'LIVE_RUN_INTENT_DOOR_MINT_FAILED',
      reason: `Door write of LIVE-RUN-INTENT failed: ${err && err.message ? err.message : String(err)}`.trim()
    };
  }

  if (!proc || proc.status !== 0) {
    return {
      ok: false,
      code: 'LIVE_RUN_INTENT_DOOR_MINT_FAILED',
      reason: `Door write of LIVE-RUN-INTENT failed: ${(proc && (proc.stderr || proc.stdout)) || 'unknown error'}`.trim()
    };
  }

  const outText = String(proc.stdout || '').trim();
  const parts = outText.split(/\s+/);
  const woId = parts.find((p) => /^wo_[0-9a-f]+$/i.test(p)) || null;
  const wardenReceiptToken = parts.find((p) => /^rcpt_[0-9a-f]+$/i.test(p)) || null;

  const absExpectedRef = path.resolve(REPO_ROOT, targetIntentRelPath);
  const resolvedReceipt = resolveDoorIntentReceiptFromLedger({
    ledgerPath,
    eventsPath,
    woId,
    wardenReceiptToken,
    absExpectedRef,
    intentSha256,
    expectedSubject: LIVE_RUN_INTENT_SUBJECT,
    seatAuthor: runtimeAuthor,
    repoRoot: REPO_ROOT,
    verifierAuthor,
    verifiedEventType
  });

  const receiptToken = resolvedReceipt.openReceiptId;

  const verifyAfterMint = checkDurableLiveOnceLatch({
    intentPath,
    receiptPath: null,
    ledgerPath,
    targetIntentRelPath,
    targetReceiptRelPath: null
  });

  if (
    !verifyAfterMint.intentExists ||
    !verifyAfterMint.ledgerEntryFound ||
    !woId ||
    !resolvedReceipt.matched ||
    !resolvedReceipt.fileShaVerifiedInEvent ||
    !receiptToken
  ) {
    return {
      ok: false,
      code: 'LIVE_RUN_INTENT_UNVERIFIED_IN_LEDGER',
      reason: 'LIVE-RUN-INTENT was not confirmed in filesystem path, open/door-verifier receipts.jsonl, and wo.verified events.jsonl',
      verifyAfterMint,
      resolvedReceipt
    };
  }

  return {
    ok: true,
    runId: resolvedRunId,
    intentDoc,
    intentSha256,
    woId,
    receiptToken,
    openReceiptId: resolvedReceipt.openReceiptId,
    wardenReceiptId: resolvedReceipt.wardenReceiptId,
    intentPath,
    targetIntentRelPath,
    verifyAfterMint,
    resolvedReceipt
  };

  } catch (err) {
    return {
      ok: false,
      code: 'LIVE_RUN_INTENT_DOOR_MINT_FAILED',
      reason: `Door mint of LIVE-RUN-INTENT failed: ${err && err.message ? err.message : String(err)}`.trim(),
      error: err
    };
  }
}

/**
 * Creates a server configured for the trusted operator one-attempt live entry seam.
 * Remains fail-closed (DEFAULT NETWORK BLOCKED) unless both `operatorAuthorized === true`
 * and `rulesVerified === true` are explicitly passed by the server/operator process.
 */
export function createTrustedOperatorLiveEntryServer({
  operatorAuthorized = false,
  rulesVerified = false,
  keyLoader = null,
  fetchImpl = null,
  requireConfirmedModelIdentity = true,
  maxLiveAttempts = 1,
  registeredUiAsset = null,
  uiMountResolver = createCanonicalUiMountResolver()
} = {}) {
  const allowExternalCalls = operatorAuthorized === true && rulesVerified === true;
  const resolvedLoaderFn = typeof keyLoader === 'function' ? keyLoader : injectedKeyLoaderSlot;
  const boundKeyLoader =
    allowExternalCalls && typeof resolvedLoaderFn === 'function'
      ? bindRegisteredZeroArgKeyLoader(resolvedLoaderFn)
      : null;
  const boundFetchImpl = allowExternalCalls
    ? (typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch)
    : null;

  const isSyntheticTransport =
    allowExternalCalls &&
    SYNTHETIC_TRANSPORT_FNS.has(boundFetchImpl);

  const effectiveDurableLatch = allowExternalCalls
    ? (isSyntheticTransport
        ? ensureProcessWideSyntheticLatch()
        : getDurableRepoLatchConfig())
    : null;

  const baseServer = createPrivateLocalCandidateServer({
    serverAuth: {
      allowExternalCalls,
      rulesVerified: allowExternalCalls,
      keyLoader: boundKeyLoader,
      requireConfirmedModelIdentity: requireConfirmedModelIdentity !== false,
      maxLiveAttempts
    },
    fetchImpl: boundFetchImpl,
    registeredUiAsset,
    uiMountResolver
  });

  return attachDurableLatchToServer(baseServer, effectiveDurableLatch);
}

/**
 * Executes a single bounded public/synthetic proposal request against a fresh
 * candidate server instance (without `offlineFixture`) and closes the server immediately.
 * Caller-supplied `latchConfig` or `keyLoaderModuleUrl` is completely ignored; the durable
 * latch is enforced process-wide and in the Truth Ledger before `keyLoader` or `fetchImpl` runs.
 */
export async function executeTrustedOperatorOneAttemptEntry({
  operatorAuthorized = false,
  rulesVerified = false,
  keyLoader = null,
  fetchImpl = null,
  autoFillLoaderSlot = false,
  requireConfirmedModelIdentity = true,
  instruction = DEFAULT_PUBLIC_SYNTHETIC_LIVE_ATTEMPT.instruction,
  currentState = DEFAULT_PUBLIC_SYNTHETIC_LIVE_ATTEMPT.currentState,
  model = DEFAULT_PUBLIC_SYNTHETIC_LIVE_ATTEMPT.model
} = {}) {
  if (operatorAuthorized !== true || rulesVerified !== true) {
    const blockedServer = createTrustedOperatorLiveEntryServer({
      operatorAuthorized: false,
      rulesVerified: false,
      keyLoader: null,
      fetchImpl: null,
      requireConfirmedModelIdentity,
      maxLiveAttempts: 1
    });
    await new Promise((resolve) => blockedServer.listen(0, '127.0.0.1', resolve));
    const blockedPort = blockedServer.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${blockedPort}/api/llama/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, currentState, model })
      });
      const response = await res.json();
      return {
        httpStatus: res.status,
        ok: false,
        response,
        runRecord: response.runRecord || null
      };
    } finally {
      await new Promise((resolve) => blockedServer.close(resolve));
    }
  }

  let resolvedKeyLoader = typeof keyLoader === 'function' ? keyLoader : injectedKeyLoaderSlot;
  if (typeof resolvedKeyLoader !== 'function' && autoFillLoaderSlot === true) {
    try {
      resolvedKeyLoader = await populateLiveOnceKeyLoaderSlot();
    } catch (err) {
      return {
        httpStatus: 503,
        ok: false,
        response: {
          status: 'refused',
          code: err.code || 'KEY_LOADER_SLOT_EMPTY',
          reason: err.message
        },
        runRecord: null
      };
    }
  }

  if (typeof resolvedKeyLoader !== 'function') {
    return {
      httpStatus: 503,
      ok: false,
      response: {
        status: 'refused',
        code: 'KEY_LOADER_SLOT_EMPTY',
        reason: 'No keyLoader was injected into launcher slot; live-once execution requires an injected or populated zero-arg keyLoader.'
      },
      runRecord: null
    };
  }

  // Hardcoded latch selection: ignores any caller-supplied latchConfig
  const isSyntheticTransport = SYNTHETIC_TRANSPORT_FNS.has(fetchImpl);
  const activeLatch = isSyntheticTransport
    ? ensureProcessWideSyntheticLatch()
    : getDurableRepoLatchConfig();

  const latchedResult = (latchCheck) => ({
    httpStatus: 409,
    ok: false,
    response: {
      status: 'refused',
      code: 'LIVE_ONCE_LATCH_EXISTS',
      reason: `Durable live-once latch already engaged (${latchCheck.reason}); second live call is permanently refused.`,
      latchCheck
    },
    runRecord: null
  });
  const refusedAfterError = (code, reason) => {
    const latchWrite = engageDurableAttemptLatch(activeLatch, 'refused-after-error', code);
    return {
      httpStatus: 503,
      ok: false,
      response: {
        status: 'refused',
        code,
        reason,
        attemptLatchEngaged: latchWrite.engaged === true
      },
      runRecord: null
    };
  };

  let mintRes;
  try {
    const preCheck = checkDurableLiveOnceLatch(activeLatch);
    if (preCheck.latched) {
      return latchedResult(preCheck);
    }
    if (!activeLatch.attemptLatchPath && activeLatch.attemptLatchError) {
      const named = describeAttemptLatchStateError(activeLatch);
      return {
        httpStatus: 503,
        ok: false,
        response: {
          status: 'refused',
          code: named.code,
          reason: named.reason,
          cause: named.cause,
          attemptLatchEngaged: false
        },
        runRecord: null
      };
    }
    const writeAhead = engageDurableAttemptLatch(activeLatch, 'write-ahead', null);
    if (!writeAhead.engaged) {
      const latchErr = new Error(`Write-ahead attempt latch not engaged: ${writeAhead.reason || writeAhead.code}`);
      latchErr.code = writeAhead.code || 'ATTEMPT_LATCH_WRITE_FAILED';
      throw latchErr;
    }
    if (!writeAhead.created) {
      return latchedResult({ ...preCheck, latched: true, attemptLatchExists: true, reason: 'ATTEMPT_LATCH_FILE_PRESENT' });
    }
    mintRes = mintDoorLiveRunIntent({
      intentPath: activeLatch.intentPath,
      targetIntentRelPath: activeLatch.targetIntentRelPath,
      ledgerPath: activeLatch.ledgerPath,
      eventsPath: activeLatch.eventsPath || null,
      transport: isSyntheticTransport ? 'synthetic_injected_transport' : 'meta_api_https',
      keyPathExists: isSyntheticTransport ? false : undefined,
      requestedModel: model,
      instruction,
      doorPutRunner: activeLatch.doorPutRunner,
      requiresInjectedDoorRunner: activeLatch.requiresInjectedDoorRunner === true,
      verifierAuthor: activeLatch.verifierAuthor || 'door-verifier',
      verifiedEventType: activeLatch.verifiedEventType || 'wo.verified'
    });
  } catch (err) {
    return refusedAfterError(
      'LIVE_RUN_INTENT_DOOR_MINT_FAILED',
      `Pre-mint or mint failure: ${err && err.message ? err.message : String(err)}`
    );
  }

  if (!mintRes.ok) {
    return refusedAfterError(mintRes.code || 'LIVE_RUN_INTENT_DOOR_MINT_FAILED', mintRes.reason);
  }

  const errorBodyCapture = createProviderErrorBodyCapture(typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch);
  const server = createPrivateLocalCandidateServer({
    serverAuth: {
      allowExternalCalls: true,
      rulesVerified: true,
      keyLoader: bindRegisteredZeroArgKeyLoader(resolvedKeyLoader),
      requireConfirmedModelIdentity: requireConfirmedModelIdentity !== false,
      maxLiveAttempts: 1
    },
    fetchImpl: errorBodyCapture.fetchImpl
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${baseUrl}/api/llama/propose`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-run-id': mintRes.runId
      },
      body: JSON.stringify({
        runId: mintRes.runId,
        instruction,
        currentState,
        model
      })
    });
    const response = await res.json();
    const isSyntheticResponse =
      SYNTHETIC_TRANSPORT_FNS.has(fetchImpl) ||
      response?.fixtureMode === 'SYNTHETIC';
    const recordForHonesty = isSyntheticResponse
      ? response
      : {
          ...response,
          runId: mintRes.runId,
          liveRunIntentReceipt: mintRes.receiptToken
        };
    const honestyValidation = validateRecord(recordForHonesty);

    const completedReceiptDoc = {
      schema: 'manymoats.meta_portable_demo_candidate.live_run_receipt.v1',
      status: res.status === 200 && response.status === 'ok' ? 'COMPLETED' : 'REFUSED_OR_FAILED',
      runId: mintRes.runId,
      intentWoId: mintRes.woId,
      liveRunIntentReceipt: mintRes.receiptToken,
      honestyPass: honestyValidation.pass,
      honestyGenuine: Boolean(honestyValidation.genuine),
      completedAt: new Date().toISOString(),
      httpStatus: res.status,
      runRecordSha256: recordForHonesty?.runRecord?.runRecordSha256 || null,
      chainRootSha256: recordForHonesty?.chainVerification?.chainRootSha256 || null,
      runRecord: recordForHonesty?.runRecord || null,
      providerErrorBody: errorBodyCapture.getRecord()
    };
    if (activeLatch.receiptPath) {
      const receiptJson = JSON.stringify(completedReceiptDoc, null, 2) + '\n';
      if (typeof activeLatch.doorPutRunner === 'function') {
        activeLatch.doorPutRunner({
          relPath: activeLatch.targetReceiptRelPath,
          absPath: activeLatch.receiptPath,
          ledgerPath: activeLatch.ledgerPath,
          content: receiptJson,
          title: 'live-run-receipt-01: completed one-attempt live-run-receipt'
        });
      } else if (activeLatch.requiresInjectedDoorRunner !== true) {
        const doorScript = path.join(REPO_ROOT, 'house-only/demo-door-put.mjs');
        childProcess.spawnSync(
          process.execPath,
          [
            doorScript,
            path.resolve(REPO_ROOT, activeLatch.targetReceiptRelPath),
            'live-run-receipt-01: completed one-attempt live-run-receipt',
            resolveRuntimeDoorAuthor()
          ],
          { cwd: REPO_ROOT, input: receiptJson, encoding: 'utf8', timeout: 60000 }
        );
      }
    }
    return {
      httpStatus: res.status,
      ok: res.status === 200 && response.status === 'ok' && honestyValidation.pass,
      runId: mintRes.runId,
      intentDoc: mintRes.intentDoc,
      intentSha256: mintRes.intentSha256,
      intentWoId: mintRes.woId,
      intentReceiptToken: mintRes.receiptToken,
      liveRunIntentReceipt: mintRes.receiptToken,
      openReceiptId: mintRes.openReceiptId,
      wardenReceiptId: mintRes.wardenReceiptId,
      honestyValidation,
      response,
      runRecord: response.runRecord || null,
      providerErrorBodyRetained: Boolean(completedReceiptDoc.providerErrorBody && completedReceiptDoc.providerErrorBody.errorBodyRetained),
      providerErrorBodySha256: (completedReceiptDoc.providerErrorBody && completedReceiptDoc.providerErrorBody.errorBodySha256) || null
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

export const executeDurableLiveOnceEntry = executeTrustedOperatorOneAttemptEntry;

const TOKEN_LIKE_RUN_RE = /[A-Za-z0-9+/_=-]{20,}/g;
export const TOKEN_LIKE_SCAN_RULE =
  'a run of 20 or more characters from [A-Za-z0-9+/_=-] that mixes letters and digits, or any such run of 32 or more characters';

export function countTokenLikeRuns(text) {
  const runs = String(text ?? '').match(TOKEN_LIKE_RUN_RE) || [];
  return runs.filter((run) => run.length >= 32 || (/[A-Za-z]/.test(run) && /[0-9]/.test(run))).length;
}

const ERROR_BODY_UUID_SHAPE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERROR_BODY_SHA_SHAPE_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
export const PROVIDER_ERROR_BODY_SCAN_RULE =
  `${TOKEN_LIKE_SCAN_RULE}; a run that is UUID-shaped (8-4-4-4-12 hex) or sha-shaped (40 or 64 hex) does not count`;

export function isErrorBodyIdShapedRun(run) {
  return ERROR_BODY_UUID_SHAPE_RE.test(run) || ERROR_BODY_SHA_SHAPE_RE.test(run);
}

export function scanProviderErrorBodyTokenRuns(text) {
  const runs = String(text ?? '').match(TOKEN_LIKE_RUN_RE) || [];
  let tokenLikeRuns = 0;
  let idShapedRunsExempt = 0;
  for (const run of runs) {
    if (!(run.length >= 32 || (/[A-Za-z]/.test(run) && /[0-9]/.test(run)))) continue;
    if (isErrorBodyIdShapedRun(run)) idShapedRunsExempt += 1;
    else tokenLikeRuns += 1;
  }
  return { tokenLikeRuns, idShapedRunsExempt };
}

export function buildProviderErrorBodyRecord(httpStatus, bodyText, capBytes = PROVIDER_ERROR_BODY_CAP_BYTES) {
  const full = Buffer.from(String(bodyText ?? ''), 'utf8');
  const base = {
    providerHttpStatus: httpStatus,
    capBytes,
    errorBodyTotalBytes: full.length,
    scanRule: PROVIDER_ERROR_BODY_SCAN_RULE
  };
  const { tokenLikeRuns, idShapedRunsExempt } = scanProviderErrorBodyTokenRuns(full.toString('utf8'));
  if (tokenLikeRuns > 0) {
    return { ...base, errorBodyRetained: false, errorBodyRefusedCode: 'ERROR_BODY_TOKEN_LIKE_REFUSED', tokenLikeRuns, idShapedRunsExempt };
  }
  let end = Math.min(capBytes, full.length);
  while (end > 0 && end < full.length && (full[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  const kept = full.subarray(0, end);
  return {
    ...base,
    errorBodyRetained: true,
    errorBody: kept.toString('utf8'),
    errorBodyBytes: kept.length,
    errorBodySha256: crypto.createHash('sha256').update(kept).digest('hex'),
    errorBodyTruncated: kept.length < full.length,
    tokenLikeRuns: 0,
    idShapedRunsExempt
  };
}

export function createProviderErrorBodyCapture(fetchFn) {
  let record = null;
  const capturingFetch = async (url, options) => {
    const res = await fetchFn(url, options);
    if (record !== null || !res || typeof res.status !== 'number' || (res.status >= 200 && res.status < 300)) {
      return res;
    }
    if (typeof res.clone === 'function') {
      try {
        record = buildProviderErrorBodyRecord(res.status, await res.clone().text());
      } catch {
        record = { providerHttpStatus: res.status, errorBodyRetained: false, errorBodyRefusedCode: 'ERROR_BODY_UNREADABLE' };
      }
      return res;
    }
    if (typeof res.text !== 'function') {
      record = { providerHttpStatus: res.status, errorBodyRetained: false, errorBodyRefusedCode: 'ERROR_BODY_UNREADABLE' };
      return res;
    }
    let text = null;
    try {
      text = await res.text();
      record = buildProviderErrorBodyRecord(res.status, text);
    } catch {
      record = { providerHttpStatus: res.status, errorBodyRetained: false, errorBodyRefusedCode: 'ERROR_BODY_UNREADABLE' };
    }
    const replay = {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
      text: async () => {
        if (text === null) {
          throw new Error('provider error body was unreadable');
        }
        return text;
      }
    };
    if (typeof res.json === 'function') {
      replay.json = async () => JSON.parse(await replay.text());
    }
    return replay;
  };
  return { fetchImpl: capturingFetch, getRecord: () => record };
}

export function validateResetReason(reason) {
  if (typeof reason !== 'string') {
    return { ok: false, code: 'RESET_REASON_INVALID', why: 'a --reason value is required' };
  }
  const trimmed = reason.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    return { ok: false, code: 'RESET_REASON_INVALID', why: 'the reason must be 1 to 200 characters' };
  }
  if (!/^[\x20-\x7E]+$/.test(trimmed)) {
    return { ok: false, code: 'RESET_REASON_INVALID', why: 'the reason must be one line of printable ASCII' };
  }
  if (countTokenLikeRuns(trimmed) > 0) {
    return { ok: false, code: 'RESET_REASON_INVALID', why: 'the reason carries a token-like string' };
  }
  return { ok: true, reason: trimmed };
}

export function resetOperatorAttemptLatch({
  reason,
  doorPutRunner = null,
  verifierAuthor = 'door-verifier',
  verifiedEventType = 'wo.verified',
  author = null
} = {}) {
  const refuse = (code, detail = {}) => ({ ok: false, code, changed: false, attemptLatchCleared: false, ...detail });
  const reasonCheck = validateResetReason(reason);
  if (!reasonCheck.ok) {
    return refuse(reasonCheck.code, { why: reasonCheck.why });
  }
  const latchTarget = resolveOperatorAttemptLatchPath();
  if (!latchTarget.ok) {
    return refuse(latchTarget.code, { cause: { code: latchTarget.code, stateBaseSource: latchTarget.stateBaseSource } });
  }
  if (!fs.existsSync(latchTarget.path)) {
    return refuse('RESET_ATTEMPT_LATCH_ABSENT');
  }
  const injected = typeof doorPutRunner === 'function';
  const doorScriptAbs = path.join(REPO_ROOT, DOOR_PUT_SCRIPT_REL_PATH);
  if (!injected) {
    let doorScriptIsFile = false;
    try {
      doorScriptIsFile = fs.statSync(doorScriptAbs).isFile();
    } catch {
      doorScriptIsFile = false;
    }
    if (!doorScriptIsFile) {
      return refuse('RESET_DOOR_SCRIPT_MISSING', { doorScriptRelPath: DOOR_PUT_SCRIPT_REL_PATH });
    }
  }
  let priorAttemptLatch;
  try {
    const doc = JSON.parse(fs.readFileSync(latchTarget.path, 'utf8'));
    priorAttemptLatch = { schema: doc.schema ?? null, phase: doc.phase ?? null, code: doc.code ?? null, engagedAt: doc.engagedAt ?? null };
  } catch {
    priorAttemptLatch = { unreadable: true };
  }
  const priorIntentSha256 = sha256OfFileOrNull(DURABLE_LIVE_RUN_INTENT_PATH);
  const priorReceiptSha256 = sha256OfFileOrNull(DURABLE_LIVE_RUN_RECEIPT_PATH);
  let priorIntentWoId = null;
  if (priorIntentSha256) {
    const intentEvent = findVerifiedEventForFile({
      eventsPath: TRUTH_LEDGER_EVENTS_PATH,
      fileSha256: priorIntentSha256,
      absRef: DURABLE_LIVE_RUN_INTENT_PATH,
      verifierAuthor,
      verifiedEventType
    });
    if (!intentEvent || !intentEvent.woId) {
      return refuse('RESET_PRIOR_INTENT_UNRESOLVED');
    }
    priorIntentWoId = intentEvent.woId;
  }
  let priorLog = Buffer.alloc(0);
  if (fs.existsSync(DURABLE_LIVE_RUN_RESET_LOG_PATH)) {
    try {
      priorLog = fs.readFileSync(DURABLE_LIVE_RUN_RESET_LOG_PATH);
    } catch {
      return refuse('RESET_LOG_UNREADABLE');
    }
    const priorText = priorLog.toString('utf8');
    const wellFormed = priorText.endsWith('\n') && priorText.split('\n').filter(Boolean).every((line) => {
      try {
        return JSON.parse(line).schema === LIVE_RUN_RESET_SCHEMA;
      } catch {
        return false;
      }
    });
    if (!wellFormed) {
      return refuse('RESET_LOG_MALFORMED');
    }
  }
  const record = {
    schema: LIVE_RUN_RESET_SCHEMA,
    resetId: `reset_${crypto.randomBytes(8).toString('hex')}`,
    createdAt: new Date().toISOString(),
    reason: reasonCheck.reason,
    priorIntentWoId,
    priorIntentSha256,
    priorReceiptSha256,
    priorAttemptLatch,
    candidateRootSha256: crypto.createHash('sha256').update(CANDIDATE_ROOT, 'utf8').digest('hex'),
    attemptLatchStateBaseSource: latchTarget.stateBaseSource,
    author: resolveRuntimeDoorAuthor(author)
  };
  const content = Buffer.concat([priorLog, Buffer.from(JSON.stringify(record) + '\n', 'utf8')]).toString('utf8');
  const contentSha256 = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  const title = `${LIVE_RUN_RESET_SUBJECT_PREFIX}: reset after ${priorIntentWoId || 'no prior intent'}: ${reasonCheck.reason}`;
  const runner = injected
    ? doorPutRunner
    : ({ relPath, content: body, title: subject, author: seat }) => childProcess.spawnSync(
        process.execPath,
        [doorScriptAbs, path.resolve(REPO_ROOT, relPath), subject, resolveRuntimeDoorAuthor(seat)],
        { cwd: REPO_ROOT, input: body, encoding: 'utf8', timeout: 60000 }
      );
  let proc = null;
  try {
    proc = runner({
      relPath: DURABLE_LIVE_RUN_RESET_LOG_REL_PATH,
      absPath: DURABLE_LIVE_RUN_RESET_LOG_PATH,
      ledgerPath: TRUTH_LEDGER_RECEIPTS_PATH,
      eventsPath: TRUTH_LEDGER_EVENTS_PATH,
      content,
      title,
      author: record.author
    });
  } catch {
    return refuse('RESET_DOOR_MINT_FAILED', { title });
  }
  if (!proc || proc.status !== 0) {
    return refuse('RESET_DOOR_MINT_FAILED', { title });
  }
  const tokens = String(proc.stdout || '').trim().split(/\s+/);
  const resetWoId = tokens.find((t) => /^wo_[0-9a-f]+$/i.test(t)) || null;
  const wardenReceiptId = tokens.find((t) => /^rcpt_[0-9a-f]+$/i.test(t)) || null;
  const diskSha256 = sha256OfFileOrNull(DURABLE_LIVE_RUN_RESET_LOG_PATH);
  const event = findVerifiedEventForFile({
    eventsPath: TRUTH_LEDGER_EVENTS_PATH,
    fileSha256: contentSha256,
    absRef: DURABLE_LIVE_RUN_RESET_LOG_PATH,
    verifierAuthor,
    verifiedEventType
  });
  if (!resetWoId || diskSha256 !== contentSha256 || !event || event.woId !== resetWoId) {
    return {
      ok: false,
      code: 'RESET_DOOR_MINT_UNVERIFIED',
      changed: diskSha256 === contentSha256 ? 'reset log written; attempt latch kept' : false,
      attemptLatchCleared: false,
      resetWoId,
      title
    };
  }
  try {
    fs.rmSync(latchTarget.path);
  } catch {
    return { ok: false, code: 'RESET_LATCH_CLEAR_FAILED', changed: 'reset log written; attempt latch kept', attemptLatchCleared: false, resetWoId, title };
  }
  if (fs.existsSync(latchTarget.path)) {
    return { ok: false, code: 'RESET_LATCH_CLEAR_FAILED', changed: 'reset log written; attempt latch kept', attemptLatchCleared: false, resetWoId, title };
  }
  return {
    ok: true,
    code: 'ATTEMPT_LATCH_RESET',
    changed: true,
    attemptLatchCleared: true,
    resetId: record.resetId,
    resetWoId,
    wardenReceiptId,
    eventId: event.eventId,
    title,
    priorIntentWoId,
    priorIntentSha256,
    priorReceiptSha256,
    resetLogSha256: contentSha256
  };
}

export function parseResetArgs(argv = []) {
  if (argv.includes('--serve') || argv.includes('--check') || argv.includes('--live-once')) {
    return { ok: false, code: 'RESET_MODE_EXCLUSIVE' };
  }
  const i = argv.indexOf('--reason');
  if (i < 0 || argv[i + 1] === undefined) {
    return { ok: false, code: 'RESET_REASON_INVALID' };
  }
  return { ok: true, reason: String(argv[i + 1]) };
}

export async function runCandidateSelfCheck() {
  verifyBoundOwnerIntegrity();

  // (note removed for export)
  const defaultServer = createPrivateLocalCandidateServer();
  await new Promise((resolve) => defaultServer.listen(0, '127.0.0.1', resolve));
  const defaultPort = defaultServer.address().port;
  const defaultBaseUrl = `http://127.0.0.1:${defaultPort}`;

  try {
    const statusRes = await fetch(`${defaultBaseUrl}/api/candidate/status`);
    const statusJson = await statusRes.json();
    if (
      statusRes.status !== 200 ||
      statusJson.externalCallsDefault !== 'BLOCKED' ||
      statusJson.externalCallsEnabled !== false ||
      statusJson.standalonePortabilityClaimed !== false ||
      statusJson.ownerAllowlistCount !== 18 ||
      statusJson.liveEntryContract?.endpoint !== META_LLAMA_ENDPOINT ||
      statusJson.liveEntryContract?.maxLiveAttempts !== 1 ||
      statusJson.liveEntryContract?.liveAttemptsRemaining !== 1
    ) {
      throw new Error('Candidate status check failed on default blocked server');
    }

    // The registered UI files are not part of this export: every UI route answers the coded refusal.
    for (const uiRoute of ['/', '/index.html', '/ui/index.html', '/ui/preview.mjs']) {
      const uiRes = await fetch(`${defaultBaseUrl}${uiRoute}`);
      const uiJson = await uiRes.json();
      if (uiRes.status !== 501 || uiJson.code !== 'UI_RESERVED_FOR_REGISTERED_OWNER') {
        throw new Error(`Expected the coded refusal 501 UI_RESERVED_FOR_REGISTERED_OWNER on ${uiRoute}, got ${uiRes.status}`);
      }
    }

    // (note removed for export)
    for (const [urlPath, row] of Object.entries(CANDIDATE_PRIVATE_OWNER_MOUNT_ALLOWLIST)) {
      const mountRes = await fetch(`${defaultBaseUrl}${urlPath}`);
      if (mountRes.status !== 200) {
        throw new Error(`Expected 200 for allowlisted owner ${urlPath}, got ${mountRes.status}`);
      }
      const contentType = mountRes.headers.get('content-type') || '';
      if (!contentType.startsWith(row.mimeType)) {
        throw new Error(`MIME mismatch on ${urlPath}: expected ${row.mimeType}, got ${contentType}`);
      }
      const ab = await mountRes.arrayBuffer();
      const buf = Buffer.from(ab);
      const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      if (buf.length !== row.expectedBytes || sha256 !== row.expectedSha256) {
        throw new Error(`Served byte/SHA256 mismatch on ${urlPath}`);
      }
    }

    // (note removed for export)
    const fontsProbeRow = EXPORT_OWNER_ROWS.find((row) => row.urlPath.endsWith('-700-normal.woff2'));
    for (const deniedPath of [
      ...EXCLUDED_CANDIDATE_PATHS,
      `${OWNER_URL_PREFIX}fonts/unused-font.woff2`,
      fontsProbeRow.urlPath.replace('-700-normal', '-600-normal'),
      `${OWNER_URL_PREFIX}app/rules-intake-gate.mjs`,
      `${OWNER_URL_PREFIX}${REGISTERED_KEY_LOADER_INTERFACE_PIN.repoRelativePath}`,
      `/_owners/${EXPORT_OWNER_ROWS[0].repoRelativePath}`,
      `/_mounted/${EXPORT_OWNER_ROWS[0].repoRelativePath}`
    ]) {
      const exRes = await fetch(`${defaultBaseUrl}${deniedPath}`);
      const exJson = await exRes.json();
      if (exRes.status !== 404 || exJson.code !== 'EXCLUDED_SURFACE') {
        throw new Error(`Expected denied path ${deniedPath} to return 404 EXCLUDED_SURFACE`);
      }
    }

    // Verify caller cannot unlock external calls by passing rulesVerified/keyPath in request body
    const spoofAuthRes = await fetch(`${defaultBaseUrl}/api/llama/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: 'Attempt unauthorized live call',
        rulesVerified: true,
        allowExternalCalls: true,
        keyPath: '/tmp/fake.key',
        env: { META_OFFICIAL_RULES_VERIFIED: '1' }
      })
    });
    const spoofAuthJson = await spoofAuthRes.json();
    if (
      spoofAuthRes.status !== 403 ||
      spoofAuthJson.code !== 'META_RULES_GATE_UNVERIFIED' ||
      spoofAuthJson.callerAuthIgnored !== true ||
      !spoofAuthJson.runRecord?.runRecordSha256
    ) {
      throw new Error('Default server failed to block caller-spoofed rulesVerified/keyPath');
    }

    // Verify offline fixture drift refusal + immutable currentState preservation
    const driftRes = await fetch(`${defaultBaseUrl}/api/llama/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        offlineFixture: 'velocity_drift_skid',
        timestamp: '1900-01-01T00:00:00Z'
      })
    });
    const driftJson = await driftRes.json();
    if (
      driftRes.status !== 422 ||
      driftJson.status !== 'refused' ||
      driftJson.code !== 'FRICTION_LIMIT_EXCEEDED' ||
      driftJson.correctionAttempts !== 1 ||
      driftJson.receipts?.length !== 2 ||
      !driftJson.chainVerification?.valid ||
      driftJson.timestampSource !== 'server_utc_clock' ||
      driftJson.receipt?.timestamp === '1900-01-01T00:00:00Z' ||
      !driftJson.runRecord?.runRecordSha256
    ) {
      throw new Error('Default server failed velocity_drift_skid offline check');
    }
  } finally {
    await new Promise((resolve) => defaultServer.close(resolve));
  }

  // 2. Injected synthetic transport server check + single-attempt budget check (no real key or network call)
  const synthetic = createSyntheticTransport({
    proposal: OFFLINE_LLAMA_FIXTURES.excessive_thrust_structural_failure.proposal
  });
  const syntheticServer = createPrivateLocalCandidateServer({
    serverAuth: {
      allowExternalCalls: true,
      rulesVerified: true,
      keyLoader: synthetic.syntheticKeyLoader,
      requireConfirmedModelIdentity: true,
      maxLiveAttempts: 1
    },
    fetchImpl: synthetic.syntheticFetchImpl
  });

  await new Promise((resolve) => syntheticServer.listen(0, '127.0.0.1', resolve));
  const synthPort = syntheticServer.address().port;
  const synthBaseUrl = `http://127.0.0.1:${synthPort}`;

  try {
    const synthRes = await fetch(`${synthBaseUrl}/api/llama/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: 'Synthetic transport recoverable thrust test',
        currentState: { massKg: 800, velocityMps: 5, stopDistanceM: 2 },
        timestamp: '1900-01-01T00:00:00Z'
      })
    });
    const synthJson = await synthRes.json();
    const synthHonesty = validateRecord(synthJson);
    const synthRunRecordHonesty = validateRecord(synthJson.runRecord);
    const telemetry = synthetic.getTelemetry();
    if (
      synthRes.status !== 200 ||
      synthJson.fixtureMode !== 'SYNTHETIC' ||
      synthJson.verdict !== 'corrected_after_refusal' ||
      synthJson.recoveredByBoundedCorrection !== true ||
      synthJson.actualModel !== DEFAULT_LLAMA_MODEL ||
      synthJson.actualModelStatus !== 'SYNTHETIC' ||
      synthJson.modelIdentityConfirmed !== false ||
      synthJson.callProof?.providerResponseIdStatus !== 'SYNTHETIC' ||
      synthJson.callProof?.usageStatus !== 'SYNTHETIC' ||
      synthJson.callProof?.keyState !== 'absent' ||
      synthJson.liveAttemptsUsed !== 0 ||
      !synthHonesty.pass ||
      !synthRunRecordHonesty.pass ||
      synthJson.correctedProposal?.thrustN !== 0 ||
      synthJson.correctedProposal?.massKg !== 800 ||
      synthJson.receipts?.length !== 2 ||
      !synthJson.chainVerification?.valid ||
      synthJson.timestampSource !== 'server_utc_clock' ||
      synthJson.receipt?.timestamp === '1900-01-01T00:00:00Z' ||
      synthJson.runRecord?.receiptChain?.providerTraceInsideKinematicReceiptChain !== false ||
      !HEX64_REGEX.test(synthJson.runRecord?.runRecordSha256 || '') ||
      telemetry.keyLoaderCalls !== 1 ||
      telemetry.fetchCalls !== 1 ||
      telemetry.lastKeyLoaderArgsLength !== 0
    ) {
      throw new Error('Injected synthetic transport self-check failed');
    }

    const replayEndpointRes = await fetch(`${synthBaseUrl}/api/candidate/replay`);
    const replayEndpointJson = await replayEndpointRes.json();
    if (replayEndpointRes.status !== 404 || replayEndpointJson.code !== 'REPLAY_FIXTURE_NOT_FOUND') {
      throw new Error('GET /api/candidate/replay must answer the coded refusal REPLAY_FIXTURE_NOT_FOUND: the synthetic replay fixture is house-only');
    }

    // Second live attempt on the same single-attempt server must be refused with 429 SINGLE_ATTEMPT_BUDGET_EXHAUSTED
    const secondAttemptRes = await fetch(`${synthBaseUrl}/api/llama/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: 'Second live attempt should be blocked by single-attempt budget',
        currentState: { massKg: 800, velocityMps: 5, stopDistanceM: 2 }
      })
    });
    const secondAttemptJson = await secondAttemptRes.json();
    const afterSecondTelemetry = synthetic.getTelemetry();
    if (
      secondAttemptRes.status !== 429 ||
      secondAttemptJson.code !== 'SINGLE_ATTEMPT_BUDGET_EXHAUSTED' ||
      afterSecondTelemetry.keyLoaderCalls !== 1 ||
      afterSecondTelemetry.fetchCalls !== 1
    ) {
      throw new Error('Single-attempt live budget check failed to block second live call');
    }
  } finally {
    await new Promise((resolve) => syntheticServer.close(resolve));
    cleanupProcessSyntheticLatch();
  }

  return {
    ok: true,
    schema: CANDIDATE_SCHEMA,
    portabilityStatus: PORTABILITY_STATUS,
    boundOwnerModulesVerified: BOUND_LOCAL_OWNER_MODULES.length,
    exactOwnerRowsVerified: 18
  };
}

export const JUDGE_REPLAY_FIXTURE_MODE = 'MOCK_OFFLINE_FIXTURE';
export const JUDGE_FAULT_SCENARIO = 'warehouse-stop';
export const JUDGE_REQUEST_BODY_LIMIT_BYTES = 256 * 1024;
export const SERVE_LOOPBACK_BIND_HOSTS = Object.freeze(['127.0.0.1', '::1']);
const LOOPBACK_REMOTE_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export const JUDGE_ACTION_CONTRACT_PIN = Object.freeze({
  repoRelativePath: 'JUDGE-ACTION-CONTRACT.json',
  version: 2,
  expectedBytes: 38594,
  expectedSha256: 'e2f69d3d84c420883225184c98c82b35cb7d33c820a92a7f47e63e64080c1b57'
});

export const JUDGE_ROUTES = Object.freeze([
  Object.freeze({ id: 'fault', method: 'POST', path: '/api/judge/fault' }),
  Object.freeze({ id: 'proposal', method: 'POST', path: '/api/judge/proposal' }),
  Object.freeze({ id: 'correction', method: 'POST', path: '/api/judge/correction' }),
  Object.freeze({ id: 'receipts', method: 'GET', path: '/api/judge/receipts' }),
  Object.freeze({ id: 'verify', method: 'POST', path: '/api/judge/verify' }),
  Object.freeze({ id: 'status', method: 'GET', path: '/api/judge/status' })
]);

export const JUDGE_CONTRACT_ERROR_ROWS = Object.freeze([
  Object.freeze({ code: 'STATE_SNAPSHOT_MISMATCH', http: 422 }),
  Object.freeze({ code: 'LIMIT_TAMPER', http: 422, surfacesAs: 'STATE_SNAPSHOT_MISMATCH' }),
  Object.freeze({ code: 'INVALID_PROPOSAL_SHAPE', http: 200 }),
  Object.freeze({ code: 'INVALID_CURRENT_STATE', http: 422 }),
  Object.freeze({ code: 'BOUNDED_CORRECTION_LIMIT_EXCEEDED', http: 422 }),
  Object.freeze({ code: 'TAMPER_CHAIN_BROKEN', http: 200 }),
  Object.freeze({ code: 'TAMPER_PAYLOAD_MISMATCH', http: 200 }),
  Object.freeze({ code: 'EMPTY_RECEIPT_CHAIN', http: 200 }),
  Object.freeze({ code: 'STRUCTURAL_LIMIT_EXCEEDED', http: 200 })
]);

export const SERVE_TRANSPORT_REFUSALS = Object.freeze([
  Object.freeze({ code: 'MALFORMED_JSON', http: 400 }),
  Object.freeze({ code: 'INVALID_REQUEST_BODY', http: 400 }),
  Object.freeze({ code: 'PAYLOAD_TOO_LARGE', http: 413 }),
  Object.freeze({ code: 'METHOD_NOT_ALLOWED', http: 405 }),
  Object.freeze({ code: 'JUDGE_ROUTE_NOT_FOUND', http: 404 }),
  Object.freeze({ code: 'NO_RECEIPTS_YET', http: 404 }),
  Object.freeze({ code: 'UNKNOWN_FAULT_SCENARIO', http: 422 }),
  Object.freeze({ code: 'NON_LOOPBACK_REFUSED', http: 403 }),
  Object.freeze({ code: 'RESPONSE_DISCLOSURE_REFUSED', http: 500 }),
  Object.freeze({ code: 'JUDGE_ROUTE_ERROR', http: 500 })
]);

export const PLACE_KEY_ROUTE = Object.freeze({ id: 'place-key', method: 'GET', path: '/api/place-key' });

export const SYMKEY_CENSUS_OWNER_PIN = Object.freeze({
  repoRelativePath: 'house-only/index.mjs',
  exportedSymbol: 'resolveMetaHackathonKeyTarget',
  expectedBytes: 12196,
  expectedSha256: '717690d6c6fd95641cb57a04d22203a64bbb58fa76a11939f8d7ed5a9c7b9ed5',
  readsKeyContent: false
});

export const SYMKEY_CENSUS_OWNER_ENGINE = 'symkey';

export const PLACE_KEY_CENSUS_CODES = Object.freeze([
  Object.freeze({ code: 'KEY_PLACED', http: 200, state: 'placed' }),
  Object.freeze({ code: 'KEY_PLACED_PERMISSIONS_UNSAFE', http: 200, state: 'placed' }),
  Object.freeze({ code: 'KEY_ABSENT', http: 200, state: 'absent' }),
  Object.freeze({ code: 'KEY_FILE_EMPTY', http: 200, state: 'absent' }),
  Object.freeze({ code: 'CONFIG_DIR_SYMLINK_REFUSED', http: 200, state: 'refused' }),
  Object.freeze({ code: 'CONFIG_DIR_NOT_DIRECTORY', http: 200, state: 'refused' }),
  Object.freeze({ code: 'KEY_FILE_SYMLINK_REFUSED', http: 200, state: 'refused' }),
  Object.freeze({ code: 'KEY_FILE_NOT_REGULAR', http: 200, state: 'refused' }),
  Object.freeze({ code: 'KEY_FILE_LINKED', http: 200, state: 'refused' }),
  Object.freeze({ code: 'KEY_PLACEMENT_UNMOUNTED', http: 405, state: null }),
  Object.freeze({ code: 'KEY_READ_REFUSED', http: 403, state: null }),
  Object.freeze({ code: 'KEY_CENSUS_OWNER_MISSING', http: 503, state: null }),
  Object.freeze({ code: 'KEY_CENSUS_OWNER_PIN_MISMATCH', http: 503, state: null }),
  Object.freeze({ code: 'KEY_CENSUS_OWNER_UNAVAILABLE', http: 503, state: null }),
  Object.freeze({ code: 'KEY_CENSUS_TARGET_UNRESOLVED', http: 503, state: null }),
  Object.freeze({ code: 'KEY_CENSUS_TARGET_MISMATCH', http: 503, state: null }),
  Object.freeze({ code: 'KEY_CENSUS_STAT_FAILED', http: 503, state: null })
]);

export function isLoopbackRemoteAddress(address) {
  return typeof address === 'string' && LOOPBACK_REMOTE_ADDRESSES.has(address);
}

export function buildServeDisclosureMarkers() {
  const markers = new Set();
  const add = (value) => {
    if (typeof value === 'string' && value.length >= 4) {
      markers.add(value);
    }
  };
  add(REPO_ROOT);
  add(CANDIDATE_ROOT);
  add(os.homedir());
  try {
    add(fs.realpathSync(os.homedir()));
  } catch {
    add(path.resolve(os.homedir()));
  }
  for (const ledgerPath of [TRUTH_LEDGER_RECEIPTS_PATH, TRUTH_LEDGER_EVENTS_PATH]) {
    add(path.relative(REPO_ROOT, ledgerPath));
    add(path.basename(ledgerPath));
  }
  add(path.relative(REPO_ROOT, path.dirname(TRUTH_LEDGER_RECEIPTS_PATH)));
  add(path.relative(os.homedir(), path.dirname(REGISTERED_KEY_LOADER_DEFAULT_KEY_FILE)));
  add(path.basename(REGISTERED_KEY_LOADER_DEFAULT_KEY_FILE));
  add(LIVE_RUN_ATTEMPT_LATCH_STATE_SUBDIR);
  return Object.freeze([...markers]);
}

function writeServeJson(res, httpStatus, payload, markers, extraHeaders = {}) {
  let text = JSON.stringify(payload);
  let status = httpStatus;
  if (markers.some((marker) => text.includes(marker))) {
    status = 500;
    const withheld = { status: 'refused', code: 'RESPONSE_DISCLOSURE_REFUSED', reason: 'The response named a private path and was withheld.' };
    text = JSON.stringify(payload && payload.fixtureMode ? { fixtureMode: payload.fixtureMode, ...withheld } : withheld);
  }
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
    ...extraHeaders
  });
  res.end(text);
  return true;
}

export const writeServeJsonGuarded = writeServeJson;

function readServeJsonBody(req, limitBytes = JUDGE_REQUEST_BODY_LIMIT_BYTES) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    let settled = false;
    const settle = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        settle({ ok: false, http: 413, code: 'PAYLOAD_TOO_LARGE', reason: `Request body exceeds ${limitBytes} B` });
        return;
      }
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim().length === 0) {
        settle({ ok: true, body: {} });
        return;
      }
      try {
        settle({ ok: true, body: JSON.parse(text) });
      } catch {
        settle({ ok: false, http: 400, code: 'MALFORMED_JSON', reason: 'Request body is not valid JSON' });
      }
    });
    req.on('error', () => settle({ ok: false, http: 400, code: 'MALFORMED_JSON', reason: 'Request stream failed' }));
  });
}

function discardServeRequestBody(req) {
  return new Promise((resolve) => {
    if (req.readableEnded) {
      resolve();
      return;
    }
    let settled = false;
    const settle = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    req.on('end', settle);
    req.on('error', settle);
    req.on('close', settle);
    req.resume();
  });
}

const symkeyCensusOwnerCache = new Map();

export async function loadSymkeyCensusOwner({ repoRoot = REPO_ROOT } = {}) {
  const rel = SYMKEY_CENSUS_OWNER_PIN.repoRelativePath;
  let ownerAbs;
  let ownerBuf;
  try {
    ownerAbs = path.resolve(fs.realpathSync(repoRoot), rel);
    if (fs.realpathSync(ownerAbs) !== ownerAbs) {
      return { ok: false, code: 'KEY_CENSUS_OWNER_PIN_MISMATCH', reason: 'The symkey census owner is not at its canonical path' };
    }
    ownerBuf = fs.readFileSync(ownerAbs);
  } catch {
    return { ok: false, code: 'KEY_CENSUS_OWNER_MISSING', reason: 'The symkey census owner is absent under the launcher root' };
  }
  const ownerSha256 = crypto.createHash('sha256').update(ownerBuf).digest('hex');
  if (ownerBuf.length !== SYMKEY_CENSUS_OWNER_PIN.expectedBytes || ownerSha256 !== SYMKEY_CENSUS_OWNER_PIN.expectedSha256) {
    return { ok: false, code: 'KEY_CENSUS_OWNER_PIN_MISMATCH', reason: 'The symkey census owner bytes or sha256 differ from the pin' };
  }
  const cacheKey = `${ownerAbs}:${ownerSha256}`;
  if (symkeyCensusOwnerCache.has(cacheKey)) {
    return symkeyCensusOwnerCache.get(cacheKey);
  }
  let mod;
  try {
    mod = await import(pathToFileURL(ownerAbs).href);
  } catch {
    return { ok: false, code: 'KEY_CENSUS_OWNER_UNAVAILABLE', reason: 'The symkey census owner failed to load' };
  }
  const resolver = mod[SYMKEY_CENSUS_OWNER_PIN.exportedSymbol];
  if (typeof resolver !== 'function') {
    return { ok: false, code: 'KEY_CENSUS_OWNER_UNAVAILABLE', reason: `The symkey census owner does not export ${SYMKEY_CENSUS_OWNER_PIN.exportedSymbol}` };
  }
  const owner = Object.freeze({
    ok: true,
    resolveTarget: (opts) => resolver(opts),
    operatorUid: typeof mod.OPERATOR_UID === 'number' ? mod.OPERATOR_UID : -1
  });
  symkeyCensusOwnerCache.set(cacheKey, owner);
  return owner;
}

function loaderSlotKeyFileTarget(loaderKeyFile) {
  const home = path.resolve(loaderKeyFile, '..', '..', '..');
  try {
    return path.join(fs.realpathSync(home), path.relative(home, loaderKeyFile));
  } catch {
    return null;
  }
}

function censusModeString(mode) {
  return '0' + (mode & 0o777).toString(8).padStart(3, '0');
}

function lstatKeyCensus({ configDir, keyFile }, operatorUid) {
  const census = { configDir: { exists: false }, keyFile: { exists: false } };
  const answer = (httpStatus, state, code) => ({ httpStatus, state, code, census });
  let dirSt;
  try {
    dirSt = fs.lstatSync(configDir);
  } catch (err) {
    return err && err.code === 'ENOENT'
      ? answer(200, 'absent', 'KEY_ABSENT')
      : answer(503, null, 'KEY_CENSUS_STAT_FAILED');
  }
  census.configDir = {
    exists: true,
    directory: dirSt.isDirectory(),
    symbolicLink: dirSt.isSymbolicLink(),
    mode: censusModeString(dirSt.mode),
    modeOk: (dirSt.mode & 0o777) === 0o700,
    ownerOk: dirSt.uid === operatorUid
  };
  if (dirSt.isSymbolicLink()) {
    return answer(200, 'refused', 'CONFIG_DIR_SYMLINK_REFUSED');
  }
  if (!dirSt.isDirectory()) {
    return answer(200, 'refused', 'CONFIG_DIR_NOT_DIRECTORY');
  }
  let st;
  try {
    st = fs.lstatSync(keyFile);
  } catch (err) {
    return err && err.code === 'ENOENT'
      ? answer(200, 'absent', 'KEY_ABSENT')
      : answer(503, null, 'KEY_CENSUS_STAT_FAILED');
  }
  census.keyFile = {
    exists: true,
    regularFile: st.isFile(),
    symbolicLink: st.isSymbolicLink(),
    singleLink: st.nlink === 1,
    nonEmpty: st.size > 0,
    mode: censusModeString(st.mode),
    modeOk: (st.mode & 0o777) === 0o600,
    ownerOk: st.uid === operatorUid
  };
  if (st.isSymbolicLink()) {
    return answer(200, 'refused', 'KEY_FILE_SYMLINK_REFUSED');
  }
  if (!st.isFile()) {
    return answer(200, 'refused', 'KEY_FILE_NOT_REGULAR');
  }
  if (st.nlink !== 1) {
    return answer(200, 'refused', 'KEY_FILE_LINKED');
  }
  if (st.size === 0) {
    return answer(200, 'absent', 'KEY_FILE_EMPTY');
  }
  const safe = census.keyFile.modeOk && census.keyFile.ownerOk && census.configDir.modeOk && census.configDir.ownerOk;
  return answer(200, 'placed', safe ? 'KEY_PLACED' : 'KEY_PLACED_PERMISSIONS_UNSAFE');
}

export async function runKeyCensus({
  env = process.env,
  repoRoot = REPO_ROOT,
  loaderKeyFile = REGISTERED_KEY_LOADER_DEFAULT_KEY_FILE
} = {}) {
  const shared = {
    route: PLACE_KEY_ROUTE.id,
    owner: SYMKEY_CENSUS_OWNER_ENGINE,
    ownerSymbol: SYMKEY_CENSUS_OWNER_PIN.exportedSymbol,
    contentRead: false,
    keyReader: 'launcher key loader slot',
    keyLoaderSlotFilled: typeof injectedKeyLoaderSlot === 'function',
    placementSurface: 'unmounted'
  };
  const refused = (code, reason, extra = {}) => ({
    httpStatus: 503,
    body: { status: 'refused', state: null, code, reason, ...extra, ...shared },
    privateTarget: null
  });
  const owner = await loadSymkeyCensusOwner({ repoRoot });
  if (!owner.ok) {
    return refused(owner.code, owner.reason);
  }
  let target;
  try {
    target = owner.resolveTarget({ env });
  } catch (err) {
    const message = String((err && err.message) || '');
    return refused('KEY_CENSUS_TARGET_UNRESOLVED', 'The symkey owner could not resolve the operator key target', {
      cause: /^[A-Z][A-Z0-9_]+$/.test(message) ? message : 'ROUTE_CONFIG_UNAVAILABLE'
    });
  }
  const loaderTarget = loaderSlotKeyFileTarget(loaderKeyFile);
  if (!target || typeof target.keyFile !== 'string' || !loaderTarget || loaderTarget !== target.keyFile) {
    return refused('KEY_CENSUS_TARGET_MISMATCH', 'The symkey owner target is not the file the loader slot reads');
  }
  const result = lstatKeyCensus(target, owner.operatorUid);
  return {
    httpStatus: result.httpStatus,
    body: {
      status: result.httpStatus === 200 ? 'ok' : 'refused',
      state: result.state,
      code: result.code,
      census: result.census,
      ...shared
    },
    privateTarget: Object.freeze({ keyFile: target.keyFile, configDir: target.configDir })
  };
}

function judgeProposalShapeOk(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return false;
  }
  const required = PROPOSAL_SCHEMA.schema.required;
  const keys = Object.keys(candidate);
  return required.every((field) => Object.hasOwn(candidate, field)) && keys.every((key) => required.includes(key));
}

function judgeOverrideShapeOk(candidate) {
  if (candidate === undefined || candidate === null) {
    return true;
  }
  if (typeof candidate !== 'object' || Array.isArray(candidate)) {
    return false;
  }
  const required = PROPOSAL_SCHEMA.schema.required;
  return Object.keys(candidate).every((key) => required.includes(key));
}

function judgeTamperRefusal(evaluated) {
  const kind = evaluated.limitTamper ? 'limit' : 'state';
  const field = (evaluated.limitTamper && evaluated.limitTamper.field) || (evaluated.stateTamper && evaluated.stateTamper.field) || null;
  return {
    status: 'refused',
    code: 'STATE_SNAPSHOT_MISMATCH',
    internalCode: kind === 'limit' ? 'LIMIT_TAMPER' : 'STATE_SNAPSHOT_MISMATCH',
    tamperKind: kind,
    field,
    reason: `The proposal attempted to override the server-owned ${kind === 'limit' ? 'plant limit' : 'state'} ${field}`
  };
}

function judgeShapeRefusal(snapshot) {
  return {
    status: 'refused',
    verdict: 'refused',
    code: 'INVALID_PROPOSAL_SHAPE',
    reason: `proposal must carry exactly the ${PROPOSAL_SCHEMA.schema.required.length} ${PROPOSAL_SCHEMA.name} fields`,
    currentState: snapshot,
    plantLimits: IMMUTABLE_PLANT_LIMITS,
    evaluation: null,
    receipts: []
  };
}

function judgeLiveAttemptCensus() {
  const latchConfig = getDurableRepoLatchConfig();
  if (!latchConfig.attemptLatchPath) {
    return {
      remaining: 0,
      state: 'unresolved',
      code: (latchConfig.attemptLatchError && latchConfig.attemptLatchError.code) || 'ATTEMPT_LATCH_PATH_MISSING'
    };
  }
  if (fs.existsSync(latchConfig.attemptLatchPath)) {
    return { remaining: 0, state: 'engaged', code: 'LIVE_ATTEMPT_LATCH_ENGAGED' };
  }
  const priorFiles = [latchConfig.intentPath, latchConfig.receiptPath].some((p) => typeof p === 'string' && fs.existsSync(p));
  if (!priorFiles) {
    return { remaining: 1, state: 'clear', code: 'LIVE_ATTEMPT_AVAILABLE' };
  }
  const coverage = resolveVerifiedResetCoverage({
    resetLogPath: latchConfig.resetLogPath,
    intentPath: latchConfig.intentPath,
    receiptPath: latchConfig.receiptPath,
    eventsPath: latchConfig.eventsPath,
    verifierAuthor: latchConfig.verifierAuthor,
    verifiedEventType: latchConfig.verifiedEventType
  });
  return coverage.covered
    ? { remaining: 1, state: 'reset', code: 'LIVE_ATTEMPT_AVAILABLE_AFTER_RESET' }
    : { remaining: 0, state: 'engaged', code: 'LIVE_ATTEMPT_LATCH_ENGAGED' };
}

export function createJudgeServeServer({
  uiMountResolver = createCanonicalUiMountResolver(),
  censusEnv = process.env,
  repoRoot = REPO_ROOT
} = {}) {
  const baseServer = createPrivateLocalCandidateServer({ uiMountResolver });
  const markers = buildServeDisclosureMarkers();
  const judge = {
    faultSnapshot: null,
    lastReceipts: [],
    lastProposalId: null,
    correctedIds: new Set()
  };
  const maxLiveAttempts = RUNTIME_DEPENDENCY_CONTRACT.liveEntryContract.maxLiveAttemptsPerEntry;
  const sendJudge = (res, httpStatus, obj, headers) =>
    writeServeJson(res, httpStatus, { fixtureMode: JUDGE_REPLAY_FIXTURE_MODE, ...obj }, markers, headers);
  const refuseCallerFields = (res, body, allowed) => {
    const extra = Object.keys(body).filter((key) => !allowed.includes(key));
    if (extra.length === 0) {
      return false;
    }
    sendJudge(res, 422, {
      status: 'refused',
      code: 'STATE_SNAPSHOT_MISMATCH',
      field: extra[0],
      reason: `Caller field ${extra[0]} is not part of this request; plant limits and state are server-owned`
    });
    return true;
  };
  const resolveSnapshot = (body) => {
    if (!judge.faultSnapshot) {
      return { ok: false, http: 422, code: 'INVALID_CURRENT_STATE', reason: 'No fault snapshot is held; POST /api/judge/fault first' };
    }
    if (body.currentState !== undefined) {
      const caller = body.currentState;
      if (!caller || typeof caller !== 'object' || Array.isArray(caller)) {
        return { ok: false, http: 422, code: 'STATE_SNAPSHOT_MISMATCH', reason: 'currentState must equal the server-owned fault snapshot' };
      }
      const mismatch = Object.keys(caller).find((key) => !STATE_SNAPSHOT_FIELDS.includes(key))
        || STATE_SNAPSHOT_FIELDS.find((field) => !Object.is(caller[field], judge.faultSnapshot[field]));
      if (mismatch) {
        return { ok: false, http: 422, code: 'STATE_SNAPSHOT_MISMATCH', field: mismatch, reason: `Caller currentState.${mismatch} differs from the server-owned fault snapshot` };
      }
    }
    return { ok: true, snapshot: { ...judge.faultSnapshot } };
  };
  const refuseSnapshot = (res, snap) => sendJudge(res, snap.http, {
    status: 'refused',
    code: snap.code,
    ...(snap.field ? { field: snap.field } : {}),
    reason: snap.reason
  });

  const judgeFault = (res, body) => {
    if (refuseCallerFields(res, body, ['scenario', ...STATE_SNAPSHOT_FIELDS])) {
      return true;
    }
    if (body.scenario !== JUDGE_FAULT_SCENARIO) {
      return sendJudge(res, 422, { status: 'refused', code: 'UNKNOWN_FAULT_SCENARIO', reason: `scenario must be ${JUDGE_FAULT_SCENARIO}` });
    }
    for (const field of STATE_SNAPSHOT_FIELDS) {
      if (!Object.hasOwn(body, field) || typeof body[field] !== 'number' || !Number.isFinite(body[field])) {
        return sendJudge(res, 422, { status: 'refused', code: 'INVALID_CURRENT_STATE', field, reason: `${field} must be a finite number` });
      }
    }
    const state = Object.fromEntries(STATE_SNAPSHOT_FIELDS.map((field) => [field, body[field]]));
    const check = validateAuthoritativeCurrentState(state);
    if (!check.valid) {
      return sendJudge(res, 422, { status: 'refused', code: check.code, field: check.field, reason: check.reason });
    }
    judge.faultSnapshot = Object.freeze({ ...state });
    return sendJudge(res, 200, { status: 'ok', scenario: JUDGE_FAULT_SCENARIO, currentState: { ...judge.faultSnapshot } });
  };

  const judgeProposal = (res, body) => {
    if (refuseCallerFields(res, body, ['currentState', 'proposal'])) {
      return true;
    }
    const snap = resolveSnapshot(body);
    if (!snap.ok) {
      return refuseSnapshot(res, snap);
    }
    if (!judgeProposalShapeOk(body.proposal)) {
      return sendJudge(res, 200, judgeShapeRefusal(snap.snapshot));
    }
    const evaluated = evaluateAndGateLlamaProposal({ proposal: body.proposal, currentState: snap.snapshot, allowBoundedCorrection: false });
    if (evaluated.limitTamper || evaluated.stateTamper) {
      return sendJudge(res, 422, judgeTamperRefusal(evaluated));
    }
    judge.lastReceipts = evaluated.receipts;
    judge.lastProposalId = body.proposal.id;
    return sendJudge(res, 200, {
      status: evaluated.status,
      verdict: evaluated.verdict,
      code: evaluated.code,
      reason: evaluated.reason,
      currentState: evaluated.currentState,
      plantLimits: evaluated.plantLimits,
      proposal: evaluated.proposal,
      evaluation: evaluated.evaluation,
      receipts: evaluated.receipts
    });
  };

  const judgeCorrection = (res, body) => {
    if (refuseCallerFields(res, body, ['currentState', 'proposal', 'correctionOverride'])) {
      return true;
    }
    const snap = resolveSnapshot(body);
    if (!snap.ok) {
      return refuseSnapshot(res, snap);
    }
    if (!judgeProposalShapeOk(body.proposal) || !judgeOverrideShapeOk(body.correctionOverride)) {
      return sendJudge(res, 200, judgeShapeRefusal(snap.snapshot));
    }
    const proposalId = body.proposal.id;
    if (judge.correctedIds.has(proposalId)) {
      return sendJudge(res, 422, {
        status: 'refused',
        code: 'BOUNDED_CORRECTION_LIMIT_EXCEEDED',
        reason: `Proposal ${String(proposalId).slice(0, 64)} already used its ${MAX_BOUNDED_CORRECTIONS} bounded correction`
      });
    }
    const probe = evaluateAndGateLlamaProposal({ proposal: body.proposal, currentState: snap.snapshot, allowBoundedCorrection: false });
    if (probe.limitTamper || probe.stateTamper) {
      return sendJudge(res, 422, judgeTamperRefusal(probe));
    }
    if (probe.verdict === 'accepted') {
      judge.lastReceipts = probe.receipts;
      judge.lastProposalId = proposalId;
      return sendJudge(res, 200, {
        status: probe.status,
        verdict: probe.verdict,
        code: probe.code,
        reason: probe.reason,
        receipts: probe.receipts,
        correctionAttempts: 0
      });
    }
    const corrected = evaluateAndGateLlamaProposal({
      proposal: body.proposal,
      currentState: snap.snapshot,
      allowBoundedCorrection: true,
      correctionOverride: body.correctionOverride || null
    });
    if (corrected.correctionAttempts >= 1) {
      judge.correctedIds.add(proposalId);
    }
    judge.lastReceipts = corrected.receipts;
    judge.lastProposalId = proposalId;
    return sendJudge(res, 200, {
      status: corrected.status,
      verdict: corrected.verdict,
      code: corrected.code,
      reason: corrected.reason,
      receipts: corrected.receipts,
      correctionAttempts: corrected.correctionAttempts,
      correctedProposal: corrected.correctedProposal || null
    });
  };

  const judgeVerify = (res, body) => {
    if (refuseCallerFields(res, body, ['receipts'])) {
      return true;
    }
    return sendJudge(res, 200, { ...verifyProposalReceiptChain(body.receipts) });
  };

  const judgeReceipts = (res) => {
    if (judge.lastReceipts.length === 0) {
      return sendJudge(res, 404, { status: 'not_found', code: 'NO_RECEIPTS_YET' });
    }
    return sendJudge(res, 200, { status: 'ok', receipts: judge.lastReceipts, count: judge.lastReceipts.length });
  };

  const judgeStatus = (res) => {
    const live = judgeLiveAttemptCensus();
    return sendJudge(res, 200, {
      status: 'ok',
      ok: true,
      maxLiveAttempts,
      liveAttemptsRemaining: live.remaining,
      liveAttemptLatch: { state: live.state, code: live.code },
      correctionsRemaining: judge.lastProposalId !== null && judge.correctedIds.has(judge.lastProposalId) ? 0 : MAX_BOUNDED_CORRECTIONS,
      faultSnapshotHeld: judge.faultSnapshot !== null,
      receiptsHeld: judge.lastReceipts.length,
      contract: { version: JUDGE_ACTION_CONTRACT_PIN.version, sha256: JUDGE_ACTION_CONTRACT_PIN.expectedSha256 },
      routes: JUDGE_ROUTES.map((r) => `${r.method} ${r.path}`),
      placeKeyRoute: `${PLACE_KEY_ROUTE.method} ${PLACE_KEY_ROUTE.path}`
    });
  };

  const handleJudge = async (req, res, pathname) => {
    const route = JUDGE_ROUTES.find((r) => r.path === pathname);
    if (!route) {
      await discardServeRequestBody(req);
      return sendJudge(res, 404, { status: 'not_found', code: 'JUDGE_ROUTE_NOT_FOUND' });
    }
    if (req.method !== route.method) {
      await discardServeRequestBody(req);
      return sendJudge(res, 405, { status: 'refused', code: 'METHOD_NOT_ALLOWED', allow: route.method }, { Allow: route.method });
    }
    if (route.method === 'GET') {
      await discardServeRequestBody(req);
      return route.id === 'status' ? judgeStatus(res) : judgeReceipts(res);
    }
    const read = await readServeJsonBody(req);
    if (!read.ok) {
      return sendJudge(res, read.http, { status: 'refused', code: read.code, reason: read.reason });
    }
    if (!read.body || typeof read.body !== 'object' || Array.isArray(read.body)) {
      return sendJudge(res, 400, { status: 'refused', code: 'INVALID_REQUEST_BODY', reason: 'Request body must be a JSON object' });
    }
    if (route.id === 'fault') return judgeFault(res, read.body);
    if (route.id === 'proposal') return judgeProposal(res, read.body);
    if (route.id === 'correction') return judgeCorrection(res, read.body);
    return judgeVerify(res, read.body);
  };

  const handlePlaceKey = async (req, res, pathname, search) => {
    if (req.method !== PLACE_KEY_ROUTE.method) {
      await discardServeRequestBody(req);
      return writeServeJson(res, 405, {
        status: 'refused',
        route: PLACE_KEY_ROUTE.id,
        code: 'KEY_PLACEMENT_UNMOUNTED',
        reason: 'The key placement surface is not mounted on this launcher; the request body was discarded unread.',
        bodyRetained: false,
        contentRead: false
      }, markers, { Allow: PLACE_KEY_ROUTE.method });
    }
    await discardServeRequestBody(req);
    if (pathname !== PLACE_KEY_ROUTE.path || search.length > 0) {
      return writeServeJson(res, 403, {
        status: 'refused',
        route: PLACE_KEY_ROUTE.id,
        code: 'KEY_READ_REFUSED',
        reason: 'The census answers placed or absent only; it takes no parameters and never reads or returns key content.',
        contentRead: false
      }, markers);
    }
    const census = await runKeyCensus({ env: censusEnv, repoRoot });
    return writeServeJson(res, census.httpStatus, census.body, markers);
  };

  const origEmit = baseServer.emit.bind(baseServer);
  baseServer.emit = function judgeServeEmit(event, req, res, ...rest) {
    if (event === 'request' && req && res) {
      const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = parsedUrl.pathname;
      const judgePath = pathname === '/api/judge' || pathname.startsWith('/api/judge/');
      const remote = req.socket ? req.socket.remoteAddress : null;
      if (!isLoopbackRemoteAddress(remote)) {
        discardServeRequestBody(req);
        const refusal = { status: 'refused', code: 'NON_LOOPBACK_REFUSED', reason: 'The served launcher answers loopback callers only.' };
        return writeServeJson(res, 403, judgePath ? { fixtureMode: JUDGE_REPLAY_FIXTURE_MODE, ...refusal } : refusal, markers);
      }
      const fail = () => {
        if (!res.headersSent) {
          const failure = { status: 'error', code: 'JUDGE_ROUTE_ERROR' };
          writeServeJson(res, 500, judgePath ? { fixtureMode: JUDGE_REPLAY_FIXTURE_MODE, ...failure } : failure, markers);
        }
      };
      if (pathname === PLACE_KEY_ROUTE.path || pathname.startsWith(`${PLACE_KEY_ROUTE.path}/`)) {
        handlePlaceKey(req, res, pathname, parsedUrl.search).catch(fail);
        return true;
      }
      if (judgePath) {
        handleJudge(req, res, pathname).catch(fail);
        return true;
      }
    }
    return origEmit(event, req, res, ...rest);
  };
  return baseServer;
}

export function parseServeArgs(argv = []) {
  if (argv.includes('--check') || argv.includes('--live-once') || argv.includes('--reset-attempt')) {
    return { ok: false, code: 'SERVE_MODE_EXCLUSIVE' };
  }
  const valueOf = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? String(argv[i + 1] ?? '') : null;
  };
  const hostArg = valueOf('--host');
  const host = hostArg === null ? SERVE_LOOPBACK_BIND_HOSTS[0] : hostArg;
  if (!SERVE_LOOPBACK_BIND_HOSTS.includes(host)) {
    return { ok: false, code: 'NON_LOOPBACK_BIND_REFUSED' };
  }
  const portArg = valueOf('--port');
  if (portArg !== null && (!/^\d{1,5}$/.test(portArg) || Number(portArg) > 65535)) {
    return { ok: false, code: 'INVALID_SERVE_PORT' };
  }
  return { ok: true, host, port: portArg === null ? 0 : Number(portArg) };
}

export async function startJudgeServe({ host = SERVE_LOOPBACK_BIND_HOSTS[0], port = 0, ...serverOptions } = {}) {
  if (!SERVE_LOOPBACK_BIND_HOSTS.includes(host)) {
    const err = new Error(`--serve binds loopback only (${SERVE_LOOPBACK_BIND_HOSTS.join(', ')})`);
    err.code = 'NON_LOOPBACK_BIND_REFUSED';
    throw err;
  }
  const server = createJudgeServeServer(serverOptions);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || !isLoopbackRemoteAddress(address.address)) {
    server.close();
    const err = new Error('--serve bound a non-loopback address');
    err.code = 'NON_LOOPBACK_BIND_REFUSED';
    throw err;
  }
  return { server, host: address.address, port: address.port };
}

if (process.argv.includes('--serve') && !process.argv.includes('--reset-attempt')) {
  const serveArgs = parseServeArgs(process.argv.slice(2));
  if (!serveArgs.ok) {
    console.error(`CANDIDATE_LAUNCHER_SERVE_REFUSED ${serveArgs.code}`);
    process.exit(2);
  }
  startJudgeServe(serveArgs)
    .then(({ server, port }) => {
      console.log(`READY ${port}`);
      const stop = () => {
        server.closeAllConnections?.();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 2000).unref();
      };
      process.once('SIGTERM', stop);
      process.once('SIGINT', stop);
    })
    .catch((err) => {
      console.error(`CANDIDATE_LAUNCHER_SERVE_REFUSED ${(err && err.code) || 'SERVE_START_FAILED'}`);
      process.exit(2);
    });
}

if (process.argv.includes('--reset-attempt')) {
  const resetArgs = parseResetArgs(process.argv.slice(2));
  const resetResult = resetArgs.ok ? resetOperatorAttemptLatch({ reason: resetArgs.reason }) : { ok: false, code: resetArgs.code, changed: false, attemptLatchCleared: false };
  if (resetResult.ok) {
    console.log(`CANDIDATE_LAUNCHER_RESET_PASS ${JSON.stringify(resetResult)}`);
    process.exit(0);
  }
  console.error(`CANDIDATE_LAUNCHER_RESET_REFUSED ${resetResult.code} ${JSON.stringify(resetResult)}`);
  process.exit(2);
}

if (process.argv.includes('--check') && !process.argv.includes('--serve') && !process.argv.includes('--reset-attempt')) {
  runCandidateSelfCheck()
    .then((res) => {
      console.log('CANDIDATE_LAUNCHER_CHECK_PASS', JSON.stringify(res));
      process.exit(0);
    })
    .catch((err) => {
      console.error('CANDIDATE_LAUNCHER_CHECK_FAIL:', err.message);
      process.exit(1);
    });
}

if (process.argv.includes('--live-once') && !process.argv.includes('--serve') && !process.argv.includes('--reset-attempt')) {
  executeTrustedOperatorOneAttemptEntry({
    operatorAuthorized: true,
    rulesVerified: true,
    autoFillLoaderSlot: true
  })
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.ok ? 0 : 1);
    })
    .catch((err) => {
      console.error('CANDIDATE_LIVE_ONCE_FAIL:', err.message);
      process.exit(1);
    });
}

/**
 * Private Minimal Demo Candidate Backend Entrypoint.
 * (note removed for export)
 *
 * Architectural invariants:
 * 1. Zero copied or rewritten physics solver, SHA-256 hash, or auth gate logic.
 *    All proposal extraction, physics evaluation, critic/interlock/quorum resolution,
 *    and receipt generation/verification are injected via the `owners` parameter.
 * 2. Default external calls BLOCKED (`allowExternalCalls: false`, `rulesVerified: false`,
 *    `keyLoader: null`, `defaultBlockedFetch`).
 * 3. Trusted server-owned authorization and registered zero-argument loader injection only;
 *    caller-supplied `rulesVerified`, `allowExternalCalls`, `keyFile`, `keyPath`, `apiKey`,
 *    `keyLoader`, `env`, or `plantLimits` in HTTP requests are strictly ignored.
 * 4. Single-attempt live-entry enforcement (`maxLiveAttempts: 1` by default, no retries or fallback).
 * 5. Preserves `requestedModel` separately from provider-reported `actualModel` (missing -> null/UNCONFIRMED;
 *    unknown or mismatched -> explicit refusal) and binds a truthful sanitized `runRecord` using
 *    existing injected owner primitives (`sha256Sync`, `canonicalStringify`) without claiming
 *    provider trace is inside the kinematic receipt chain.
 * 6. UI mount contract:
 *    - `/` or `/index.html` or `/ui/index.html` -> `candidate/ui/index.html` (`text/html; charset=utf-8`)
 *    - `/ui/preview.mjs` -> `candidate/ui/preview.mjs` (`text/javascript`)
 *    - `/__owners/<repo-relative-path>` -> exact 18-row allowlist ONLY (8 JS `text/javascript`,
 *      6 CSS `text/css`, 4 WOFF2 `font/woff2` served as binary Buffers).
 *    - `/ui/PRIVATE-ASSET-MANIFEST.json` and all undeclared paths are strictly denied.
 */

import http from 'node:http';

export const CANDIDATE_SCHEMA = 'meta-portable-demo-candidate-backend/1';
export const PORTABILITY_STATUS = 'PRIVATE_LOCAL_CANDIDATE_NOT_STANDALONE_PORTABLE';

export const REQUIRED_OWNER_FUNCTIONS = Object.freeze([
  'sha256Sync',
  'canonicalStringify',
  'sanitizeProviderUsage',
  'sanitizeProviderTraceString',
  'classifySafeTransportError',
  'requestLlamaPhysicsProposal',
  'validateAuthoritativeCurrentState',
  'deriveAuthoritativeStateSnapshot',
  'evaluateAndGateLlamaProposal',
  'generateKinematicProposalReceipt',
  'verifyProposalReceiptChain',
  'evaluateKinematicCritic',
  'evaluateSafetyInterlock',
  'evaluateInterlock',
  'resolveSwarmQuorum',
  'generateSwarmStepReceipt'
]);

export const REQUIRED_OWNER_VALUES = Object.freeze([
  'DEFAULT_LLAMA_MODEL',
  'CONFIGURABLE_LLAMA_MODELS',
  'META_LLAMA_ENDPOINT',
  'MAX_COMPLETION_TOKENS',
  'DEFAULT_REQUEST_TIMEOUT_MS',
  'PROPOSAL_SCHEMA',
  'MAX_BOUNDED_CORRECTIONS',
  'GENESIS_RECEIPT_HASH',
  'HEX64_REGEX',
  'PLANT_MANIFEST',
  'PLANT_MANIFEST_HASH',
  'OFFLINE_LLAMA_FIXTURES',
  'ALLOWED_PROVIDER_USAGE_COUNTERS'
]);

export const EXCLUDED_CANDIDATE_PATHS = Object.freeze([
  '/rules-intake-gate.mjs',
  '/stage5-contingency-adapters.mjs',
  '/api/rules/clearance',
  '/api/rules/intake',
  '/admin',
  '/ui/PRIVATE-ASSET-MANIFEST.json',
  '/DEPENDENCY-CONTRACT.json',
  '/candidate-backend.mjs',
  '/launcher.mjs',
  '/candidate-backend.test.mjs'
]);

export const IGNORED_CALLER_AUTH_FIELDS = Object.freeze([
  'rulesVerified',
  'allowExternalCalls',
  'keyFile',
  'keyPath',
  'apiKey',
  'keyLoader',
  'env',
  'auth',
  'plantLimits'
]);

/**
 * Exact 18-row private owner allowlist (8 JS + 6 CSS + 4 WOFF2 fonts = 18 rows).
 * No other `/__owners/*` paths or root font directories are permitted.
 */
export const EXACT_PRIVATE_OWNER_MOUNT_ALLOWLIST = Object.freeze({
  '/__owners/deploy/_shared/widget-faces/faces/button.mjs': Object.freeze({
    urlPath: '/__owners/deploy/_shared/widget-faces/faces/button.mjs',
    repoRelativePath: 'deploy/_shared/widget-faces/faces/button.mjs',
    mimeType: 'text/javascript',
    kind: 'js',
    expectedBytes: 13164,
    expectedSha256: 'dd0ebf2e0172eb7baa9d46f4e7488ad9c75fa9f4e4eabe1147372c3900e2b96d'
  }),
  '/__owners/deploy/_shared/widget-faces/faces/badge.mjs': Object.freeze({
    urlPath: '/__owners/deploy/_shared/widget-faces/faces/badge.mjs',
    repoRelativePath: 'deploy/_shared/widget-faces/faces/badge.mjs',
    mimeType: 'text/javascript',
    kind: 'js',
    expectedBytes: 736,
    expectedSha256: 'ec2e77df6a0e321ab0b6b1cc41432d86551e75f4d6cfcdc7db7bc4139d08b47a'
  }),
  '/__owners/deploy/_shared/widget-faces/faces/receipt.mjs': Object.freeze({
    urlPath: '/__owners/deploy/_shared/widget-faces/faces/receipt.mjs',
    repoRelativePath: 'deploy/_shared/widget-faces/faces/receipt.mjs',
    mimeType: 'text/javascript',
    kind: 'js',
    expectedBytes: 1139,
    expectedSha256: '1efe20a9eba7d30e90a08203d55434a5ef56d3bf891207f5e175da2c436a7638'
  }),
  '/__owners/deploy/_shared/widget-faces/faces/input.mjs': Object.freeze({
    urlPath: '/__owners/deploy/_shared/widget-faces/faces/input.mjs',
    repoRelativePath: 'deploy/_shared/widget-faces/faces/input.mjs',
    mimeType: 'text/javascript',
    kind: 'js',
    expectedBytes: 26513,
    expectedSha256: '97075dd43e970c51b72695a8343171af1aa4f4d2a2aafdf13990ba349d32f294'
  }),
  '/__owners/deploy/_shared/widget-faces/faces/el.mjs': Object.freeze({
    urlPath: '/__owners/deploy/_shared/widget-faces/faces/el.mjs',
    repoRelativePath: 'deploy/_shared/widget-faces/faces/el.mjs',
    mimeType: 'text/javascript',
    kind: 'js',
    expectedBytes: 390,
    expectedSha256: 'cab541bba9ba003d5d574a2cbe91c2d54a0f9ebb19827a8ec4acbbef530d6990'
  }),
  '/__owners/deploy/_shared/widget-faces/faces/uid.mjs': Object.freeze({
    urlPath: '/__owners/deploy/_shared/widget-faces/faces/uid.mjs',
    repoRelativePath: 'deploy/_shared/widget-faces/faces/uid.mjs',
    mimeType: 'text/javascript',
    kind: 'js',
    expectedBytes: 60,
    expectedSha256: '930a7785154dae9a380ed889bc55d662a5971fe49f5769163e004aee4f0a98f8'
  }),
  '/__owners/deploy/_shared/hash/uid.mjs': Object.freeze({
    urlPath: '/__owners/deploy/_shared/hash/uid.mjs',
    repoRelativePath: 'deploy/_shared/hash/uid.mjs',
    mimeType: 'text/javascript',
    kind: 'js',
    expectedBytes: 726,
    expectedSha256: '48948b11b107ffc2d882945e4bf2e3a4e9c2fc7fc7cf78ff545061e7798ce130'
  }),
  '/__owners/deploy/_shared/hash/index.mjs': Object.freeze({
    urlPath: '/__owners/deploy/_shared/hash/index.mjs',
    repoRelativePath: 'deploy/_shared/hash/index.mjs',
    mimeType: 'text/javascript',
    kind: 'js',
    expectedBytes: 1622,
    expectedSha256: '0bbfe655fded57829d1644bfb11fa4985552b6435dcc37f1ddb76ecc1dd3fc32'
  }),
  '/__owners/deploy/_shared/widget-faces/faces.css': Object.freeze({
    urlPath: '/__owners/deploy/_shared/widget-faces/faces.css',
    repoRelativePath: 'deploy/_shared/widget-faces/faces.css',
    mimeType: 'text/css',
    kind: 'css',
    expectedBytes: 50953,
    expectedSha256: '736ee94500bb99f98aa09ebdd40d1a6e95f1f514f62ced0542acf998113898a7'
  }),
  '/__owners/deploy/_shared/design-system-v1/components.css': Object.freeze({
    urlPath: '/__owners/deploy/_shared/design-system-v1/components.css',
    repoRelativePath: 'deploy/_shared/design-system-v1/components.css',
    mimeType: 'text/css',
    kind: 'css',
    expectedBytes: 5378,
    expectedSha256: '7fe1c67756dc6007123695d2bed0d8867c919d4a68a5fcc81647e3f577692dc6'
  }),
  '/__owners/deploy/_shared/design-system-v1/tokens.css': Object.freeze({
    urlPath: '/__owners/deploy/_shared/design-system-v1/tokens.css',
    repoRelativePath: 'deploy/_shared/design-system-v1/tokens.css',
    mimeType: 'text/css',
    kind: 'css',
    expectedBytes: 7053,
    expectedSha256: 'b003c9a71c612bf24f5ef75caba3fde27b32c7ba0303a2f65e1c46486cd56714'
  }),
  '/__owners/deploy/_shared/os-tokens.css': Object.freeze({
    urlPath: '/__owners/deploy/_shared/os-tokens.css',
    repoRelativePath: 'deploy/_shared/os-tokens.css',
    mimeType: 'text/css',
    kind: 'css',
    expectedBytes: 14869,
    expectedSha256: 'b458b02a4a671bb304de32bf87d83770a3bca8ce0fdfa1e152d861e359eb4e98'
  }),
  '/__owners/deploy/_shared/ss-motion.css': Object.freeze({
    urlPath: '/__owners/deploy/_shared/ss-motion.css',
    repoRelativePath: 'deploy/_shared/ss-motion.css',
    mimeType: 'text/css',
    kind: 'css',
    expectedBytes: 3512,
    expectedSha256: '7728e5c362a91d524044c81545c3d360e55607efc627bde86f0ab352de6c373c'
  }),
  '/__owners/deploy/_shared/fonts/fonts.css': Object.freeze({
    urlPath: '/__owners/deploy/_shared/fonts/fonts.css',
    repoRelativePath: 'deploy/_shared/fonts/fonts.css',
    mimeType: 'text/css',
    kind: 'css',
    expectedBytes: 9706,
    expectedSha256: '9040a1c814f90fbccdd4faee760e33330e4c6a54d2d5db559326b6bba7edb19c'
  }),
  '/__owners/deploy/_shared/fonts/Inter5D-latin.woff2': Object.freeze({
    urlPath: '/__owners/deploy/_shared/fonts/Inter5D-latin.woff2',
    repoRelativePath: 'deploy/_shared/fonts/Inter5D-latin.woff2',
    mimeType: 'font/woff2',
    kind: 'font',
    expectedBytes: 99388,
    expectedSha256: '63b6e75d9c74ca5fbe697ec6aab81322de0058163805cfc30f5e0791fdd98855'
  }),
  '/__owners/deploy/_shared/fonts/jetbrains-mono/jetbrains-mono-latin-400-normal.woff2': Object.freeze({
    urlPath: '/__owners/deploy/_shared/fonts/jetbrains-mono/jetbrains-mono-latin-400-normal.woff2',
    repoRelativePath: 'deploy/_shared/fonts/jetbrains-mono/jetbrains-mono-latin-400-normal.woff2',
    mimeType: 'font/woff2',
    kind: 'font',
    expectedBytes: 21168,
    expectedSha256: '14425ba9c695763c1547f48a206b7aa60350a33ae23de09f0407877f3fcd89eb'
  }),
  '/__owners/deploy/_shared/fonts/jetbrains-mono/jetbrains-mono-latin-500-normal.woff2': Object.freeze({
    urlPath: '/__owners/deploy/_shared/fonts/jetbrains-mono/jetbrains-mono-latin-500-normal.woff2',
    repoRelativePath: 'deploy/_shared/fonts/jetbrains-mono/jetbrains-mono-latin-500-normal.woff2',
    mimeType: 'font/woff2',
    kind: 'font',
    expectedBytes: 21832,
    expectedSha256: 'cb182feeed4d798ff6961d3c79f7026279448fca0676438aaecb21f3fc39553a'
  }),
  '/__owners/deploy/_shared/fonts/jetbrains-mono/jetbrains-mono-latin-700-normal.woff2': Object.freeze({
    urlPath: '/__owners/deploy/_shared/fonts/jetbrains-mono/jetbrains-mono-latin-700-normal.woff2',
    repoRelativePath: 'deploy/_shared/fonts/jetbrains-mono/jetbrains-mono-latin-700-normal.woff2',
    mimeType: 'font/woff2',
    kind: 'font',
    expectedBytes: 21908,
    expectedSha256: 'd0d4e818808f2a0ba39b2b09d1989366f63494e295f003c7ef436697378507e8'
  })
});

export const PRIVATE_OWNER_MOUNT_ALLOWLIST = EXACT_PRIVATE_OWNER_MOUNT_ALLOWLIST;

const FORBIDDEN_UI_PATTERNS = Object.freeze([
  /rules-intake-gate/i,
  /stage5-contingency/i,
  /rulesReadinessPanel/i,
  /\/api\/rules\//i
]);

/**
 * Default fail-closed transport blocker used whenever external calls are not explicitly
 * authorized by server-owned configuration or no transport function is injected.
 */
export async function defaultBlockedFetch() {
  const err = new Error('External outbound network calls are blocked by default in the portable demo candidate');
  err.code = 'EXTERNAL_CALLS_BLOCKED_BY_DEFAULT';
  throw err;
}

/**
 * Validates that all required accepted owner functions and constants have been injected.
 * Fails closed with MISSING_INJECTED_OWNER rather than falling back to copied logic.
 */
export function validateInjectedOwners(owners) {
  if (!owners || typeof owners !== 'object' || Array.isArray(owners)) {
    const err = new Error('MISSING_INJECTED_OWNER: owners bag must be a non-null plain object');
    err.code = 'MISSING_INJECTED_OWNER';
    throw err;
  }

  for (const fnName of REQUIRED_OWNER_FUNCTIONS) {
    if (typeof owners[fnName] !== 'function') {
      const err = new Error(`MISSING_INJECTED_OWNER: required owner function "${fnName}" was not injected`);
      err.code = 'MISSING_INJECTED_OWNER';
      err.missingOwner = fnName;
      throw err;
    }
  }

  for (const valName of REQUIRED_OWNER_VALUES) {
    if (owners[valName] === undefined || owners[valName] === null) {
      const err = new Error(`MISSING_INJECTED_OWNER: required owner constant "${valName}" was not injected`);
      err.code = 'MISSING_INJECTED_OWNER';
      err.missingOwner = valName;
      throw err;
    }
  }

  return true;
}

/**
 * Validates an optional root-registered UI asset before serving.
 * Rejects any asset that references excluded admin/rules surfaces.
 */
export function inspectRegisteredUiAsset(registeredUiAsset) {
  if (registeredUiAsset === null || registeredUiAsset === undefined) {
    return {
      allowed: false,
      status: 'reserved',
      code: 'UI_RESERVED_FOR_REGISTERED_OWNER',
      reason: 'UI and control integration is reserved for root-registered UI owner review; no bespoke CSS or HTML components are bundled.'
    };
  }

  const content = typeof registeredUiAsset === 'string'
    ? registeredUiAsset
    : (typeof registeredUiAsset?.html === 'string'
      ? registeredUiAsset.html
      : (typeof registeredUiAsset?.content === 'string' ? registeredUiAsset.content : null));

  if (typeof content !== 'string' || !content.trim()) {
    return {
      allowed: false,
      status: 'refused',
      code: 'INVALID_REGISTERED_UI_ASSET',
      reason: 'Injected registeredUiAsset must provide non-empty content'
    };
  }

  for (const pattern of FORBIDDEN_UI_PATTERNS) {
    if (pattern.test(content)) {
      return {
        allowed: false,
        status: 'refused',
        code: 'FORBIDDEN_UI_ASSET_CONTENT',
        reason: `Injected UI asset references excluded surface matching ${String(pattern)}`
      };
    }
  }

  return {
    allowed: true,
    status: 'ok',
    html: content,
    content
  };
}

/**
 * Checks whether a `/__owners/<repo-relative-path>` URL path is in the exact 18-row allowlist.
 */
export function resolveExactAllowlistedOwnerRow(urlPath) {
  if (typeof urlPath !== 'string' || !Object.hasOwn(EXACT_PRIVATE_OWNER_MOUNT_ALLOWLIST, urlPath)) {
    return null;
  }
  return EXACT_PRIVATE_OWNER_MOUNT_ALLOWLIST[urlPath];
}

function isExcludedPath(pathname) {
  if (EXCLUDED_CANDIDATE_PATHS.includes(pathname)) {
    return true;
  }
  if (
    pathname.startsWith('/api/rules/') ||
    pathname.startsWith('/admin/') ||
    pathname.startsWith('/_owners/') ||
    pathname.startsWith('/_mounted/') ||
    pathname.startsWith('/fonts/')
  ) {
    return true;
  }
  if (pathname.includes('..') || pathname.includes('\\') || pathname.includes('\0')) {
    return true;
  }
  if (pathname.endsWith('.json') || pathname.endsWith('.key') || pathname.endsWith('.map')) {
    return true;
  }
  if (pathname.startsWith('/__owners/')) {
    return !Object.hasOwn(EXACT_PRIVATE_OWNER_MOUNT_ALLOWLIST, pathname);
  }
  if (pathname.endsWith('.mjs') && pathname !== '/ui/preview.mjs') {
    return true;
  }
  return false;
}

function sanitizeFixturesForCandidate(offlineFixtures) {
  const sanitized = {};
  for (const [key, item] of Object.entries(offlineFixtures || {})) {
    if (item && typeof item === 'object') {
      sanitized[key] = {
        id: item.id,
        title: item.title,
        instruction: item.instruction,
        proposal: item.proposal ? { ...item.proposal } : null,
        expectedStatus: item.expectedStatus,
        ...(item.expectedCode ? { expectedCode: item.expectedCode } : {})
      };
    }
  }
  return sanitized;
}

/**
 * Builds a sanitized local run record binding public synthetic input, provider trace evidence,
 * and kinematic receipt hashes using existing injected owner primitives (sha256Sync, canonicalStringify).
 * Explicitly records that providerTrace is NOT inside the kinematic receipt chain.
 */
/**
 * Applies the strict usage counter allowlist and trace string sanitization contract
 * to callProof before it is returned in HTTP responses or bound into runRecord.
 */
export function sanitizeCandidateCallProof(callProof, owners, fallbackRequestedModel = null) {
  if (!callProof || typeof callProof !== 'object' || Array.isArray(callProof)) {
    return null;
  }
  const sanitizedUsage = owners.sanitizeProviderUsage(callProof.usage);
  const sanitizedRequestId = owners.sanitizeProviderTraceString(callProof.providerRequestId, null, 128);
  const sanitizedResponseId = owners.sanitizeProviderTraceString(callProof.providerResponseId, null, 128);
  const rawActualModel = callProof.actualModel;
  const safeActualModel = rawActualModel === '[REDACTED_UNCONFIRMED_MODEL]'
    ? '[REDACTED_UNCONFIRMED_MODEL]'
    : owners.sanitizeProviderTraceString(rawActualModel, null, 64);

  const isSyntheticResponse =
    callProof.fixtureMode === 'SYNTHETIC' ||
    (typeof sanitizedResponseId === 'string' && /^synthetic-/i.test(sanitizedResponseId));
  const resolvedReqModel = callProof.requestedModel ?? fallbackRequestedModel;
  const isSyntheticConfirmedModel =
    isSyntheticResponse &&
    typeof safeActualModel === 'string' &&
    owners.CONFIGURABLE_LLAMA_MODELS.includes(safeActualModel) &&
    safeActualModel === resolvedReqModel;

  return Object.freeze({
    fixtureMode: isSyntheticResponse
      ? 'SYNTHETIC'
      : (callProof.fixtureMode === 'MOCK_OFFLINE_FIXTURE' ? 'MOCK_OFFLINE_FIXTURE' : 'LIVE_META_API'),
    authSource: isSyntheticResponse
      ? 'synthetic_injected_transport'
      : (callProof.authSource ?? 'dedicated_keyfile_loader'),
    keyState: isSyntheticResponse ? 'absent' : (callProof.keyState ?? 'ready'),
    endpoint: callProof.endpoint ?? owners.META_LLAMA_ENDPOINT,
    singleAttempt: callProof.singleAttempt ?? true,
    attemptCount: callProof.attemptCount ?? 1,
    retriesPerformed: callProof.retriesPerformed ?? 0,
    liveAttemptsUsed: isSyntheticResponse ? 0 : (callProof.liveAttemptsUsed ?? 1),
    httpStatus: typeof callProof.httpStatus === 'number' && Number.isInteger(callProof.httpStatus) ? callProof.httpStatus : null,
    requestedModel: resolvedReqModel,
    actualModel: safeActualModel,
    actualModelStatus: isSyntheticConfirmedModel ? 'SYNTHETIC' : (callProof.actualModelStatus ?? 'UNCONFIRMED'),
    modelIdentityConfirmed: isSyntheticResponse ? false : Boolean(callProof.modelIdentityConfirmed),
    providerRequestId: sanitizedRequestId,
    providerResponseId: sanitizedResponseId,
    providerResponseIdStatus: isSyntheticResponse ? 'SYNTHETIC' : (sanitizedResponseId ? 'CONFIRMED' : 'UNCONFIRMED'),
    requestSha256: typeof callProof.requestSha256 === 'string' && owners.HEX64_REGEX.test(callProof.requestSha256) ? callProof.requestSha256 : null,
    responseSha256: typeof callProof.responseSha256 === 'string' && owners.HEX64_REGEX.test(callProof.responseSha256) ? callProof.responseSha256 : null,
    usage: sanitizedUsage,
    usageStatus: isSyntheticResponse ? 'SYNTHETIC' : (sanitizedUsage ? 'PROVIDER_REPORTED' : 'UNAVAILABLE'),
    ...(typeof callProof.errorType === 'string' ? { errorType: callProof.errorType } : {}),
    ...(typeof callProof.timeoutCode === 'string' ? { timeoutCode: callProof.timeoutCode } : {}),
    ...(typeof callProof.timedOut === 'boolean' ? { timedOut: callProof.timedOut } : {}),
    attemptStartedAt: callProof.attemptStartedAt ?? null,
    timestamp: callProof.timestamp ?? null
  });
}

export function buildSanitizedCandidateRunRecord({
  owners,
  runId = null,
  timestamp,
  timestampSource,
  fixtureMode,
  input,
  callProof = null,
  evaluationSummary,
  previousHash,
  receipts = [],
  swarmReceipt = null,
  chainVerification = null
}) {
  const safeCallProof = sanitizeCandidateCallProof(callProof, owners, input.requestedModel);
  const receiptHashes = Array.isArray(receipts) ? receipts.map((r) => r.receiptHash) : [];
  const payload = {
    schema: 'meta-candidate-sanitized-run-record/1',
    ...(typeof runId === 'string' && runId.length > 0 ? { runId } : {}),
    observedAt: timestamp,
    timestampSource,
    fixtureMode,
    input: {
      instruction: input.instruction || null,
      requestedModel: input.requestedModel,
      currentState: input.currentState,
      step: input.step,
      previousHash,
      allowBoundedCorrection: Boolean(input.allowBoundedCorrection),
      strictLimitTamper: Boolean(input.strictLimitTamper),
      timeoutMs: input.timeoutMs
    },
    providerTrace: safeCallProof
      ? {
          fixtureMode: safeCallProof.fixtureMode,
          authSource: safeCallProof.authSource,
          keyState: safeCallProof.keyState,
          liveAttemptsUsed: safeCallProof.liveAttemptsUsed ?? 0,
          endpoint: safeCallProof.endpoint,
          singleAttempt: safeCallProof.singleAttempt,
          attemptCount: safeCallProof.attemptCount,
          retriesPerformed: safeCallProof.retriesPerformed,
          httpStatus: safeCallProof.httpStatus,
          requestedModel: safeCallProof.requestedModel,
          actualModel: safeCallProof.actualModel,
          actualModelStatus: safeCallProof.actualModelStatus,
          modelIdentityConfirmed: safeCallProof.modelIdentityConfirmed,
          providerRequestId: safeCallProof.providerRequestId,
          providerResponseId: safeCallProof.providerResponseId,
          providerResponseIdStatus: safeCallProof.providerResponseIdStatus,
          requestSha256: safeCallProof.requestSha256,
          responseSha256: safeCallProof.responseSha256,
          usage: safeCallProof.usage,
          usageStatus: safeCallProof.usageStatus,
          ...(typeof safeCallProof.errorType === 'string' ? { errorType: safeCallProof.errorType } : {}),
          ...(typeof safeCallProof.timeoutCode === 'string' ? { timeoutCode: safeCallProof.timeoutCode } : {}),
          ...(typeof safeCallProof.timedOut === 'boolean' ? { timedOut: safeCallProof.timedOut } : {}),
          attemptStartedAt: safeCallProof.attemptStartedAt ?? timestamp,
          completedAt: safeCallProof.timestamp ?? timestamp
        }
      : null,
    evaluationSummary,
    receiptChain: {
      previousHash,
      receiptHashes,
      finalReceiptHash: receiptHashes[receiptHashes.length - 1] || null,
      swarmStepReceiptHash: swarmReceipt ? swarmReceipt.receiptHash : null,
      chainRootSha256: chainVerification?.chainRootSha256 || null,
      chainValid: Boolean(chainVerification?.valid),
      providerTraceInsideKinematicReceiptChain: false,
      hashSemanticNote: 'SHA-256 digests are deterministic integrity hashes, not issuer signatures; providerTrace is bound alongside receiptHashes in this runRecord.'
    }
  };

  return {
    ...payload,
    runRecordSha256: owners.sha256Sync(owners.canonicalStringify(payload))
  };
}

/**
 * Creates the minimal portable demo candidate HTTP server.
 * Reuses injected accepted proposal/evaluator/critic/receipt owners exclusively.
 */
export function createPortableCandidateServer({
  owners,
  serverAuth = {},
  fetchImpl = null,
  registeredUiAsset = null,
  uiMountResolver = null
} = {}) {
  validateInjectedOwners(owners);

  const trustedExternalAllowed = Boolean(
    serverAuth &&
    typeof serverAuth === 'object' &&
    serverAuth.allowExternalCalls === true &&
    serverAuth.rulesVerified === true
  );

  const hasBoundKeyLoader = Boolean(
    trustedExternalAllowed &&
    typeof serverAuth.keyLoader === 'function'
  );

  const maxLiveAttempts = Number.isInteger(serverAuth?.maxLiveAttempts) && serverAuth.maxLiveAttempts > 0
    ? serverAuth.maxLiveAttempts
    : 1;

  const requireConfirmedModelIdentity = Boolean(serverAuth?.requireConfirmedModelIdentity);

  let liveAttemptsUsed = 0;

  // Wrap injected keyLoader in a zero-argument closure so no caller parameter can ever reach it
  const zeroArgKeyLoader = hasBoundKeyLoader
    ? () => serverAuth.keyLoader()
    : null;

  const effectiveFetchImpl = (hasBoundKeyLoader && typeof fetchImpl === 'function')
    ? fetchImpl
    : defaultBlockedFetch;

  const frozenEmptyEnv = Object.freeze({});
  const sanitizedFixtures = Object.freeze(sanitizeFixturesForCandidate(owners.OFFLINE_LLAMA_FIXTURES));

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = parsedUrl.pathname;

    if (isExcludedPath(pathname)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        status: 'not_found',
        code: 'EXCLUDED_SURFACE',
        path: pathname
      }));
      return;
    }

    if (req.method === 'GET') {
      if (pathname === '/' || pathname === '/index.html' || pathname === '/ui/index.html') {
        const resolvedUi = registeredUiAsset !== null && registeredUiAsset !== undefined
          ? registeredUiAsset
          : (typeof uiMountResolver === 'function' ? uiMountResolver('/ui/index.html') : null);
        const uiCheck = inspectRegisteredUiAsset(resolvedUi);
        if (!uiCheck.allowed) {
          const httpCode = uiCheck.code === 'UI_RESERVED_FOR_REGISTERED_OWNER' ? 501 : 403;
          res.writeHead(httpCode, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            status: uiCheck.status,
            code: uiCheck.code,
            reason: uiCheck.reason
          }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(uiCheck.content);
        return;
      }

      if (pathname === '/ui/preview.mjs') {
        const resolvedPreview = typeof registeredUiAsset?.previewMjs === 'string'
          ? registeredUiAsset.previewMjs
          : (typeof uiMountResolver === 'function' ? uiMountResolver('/ui/preview.mjs') : null);
        const previewCheck = inspectRegisteredUiAsset(resolvedPreview);
        if (!previewCheck.allowed) {
          const httpCode = previewCheck.code === 'UI_RESERVED_FOR_REGISTERED_OWNER' ? 501 : 403;
          res.writeHead(httpCode, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            status: previewCheck.status,
            code: previewCheck.code,
            reason: previewCheck.reason
          }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        res.end(previewCheck.content);
        return;
      }

      if (pathname.startsWith('/__owners/')) {
        const allowlistedRow = resolveExactAllowlistedOwnerRow(pathname);
        if (!allowlistedRow) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            status: 'not_found',
            code: 'EXCLUDED_SURFACE',
            path: pathname
          }));
          return;
        }
        if (typeof uiMountResolver !== 'function') {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            status: 'not_found',
            code: 'MOUNT_RESOLVER_UNBOUND',
            path: pathname
          }));
          return;
        }
        const mounted = uiMountResolver(pathname, allowlistedRow);
        if (!mounted || mounted.allowed !== true) {
          const status = mounted?.code === 'MOUNT_HASH_MISMATCH' || mounted?.code === 'MOUNT_FORBIDDEN' ? 403 : 404;
          res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            status: 'refused',
            code: mounted?.code || 'MOUNT_NOT_FOUND',
            path: pathname,
            reason: mounted?.reason || 'Allowlisted owner asset unavailable'
          }));
          return;
        }
        res.writeHead(200, { 'Content-Type': allowlistedRow.mimeType });
        res.end(mounted.body);
        return;
      }

      if (pathname === '/api/candidate/status') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          status: 'ok',
          schema: CANDIDATE_SCHEMA,
          portabilityStatus: PORTABILITY_STATUS,
          standalonePortabilityClaimed: false,
          ownerModulesCopiedIntoCandidate: false,
          externalCallsDefault: 'BLOCKED',
          externalCallsEnabled: Boolean(hasBoundKeyLoader && typeof fetchImpl === 'function'),
          liveEntryContract: Object.freeze({
            endpoint: owners.META_LLAMA_ENDPOINT,
            allowedModels: owners.CONFIGURABLE_LLAMA_MODELS,
            structuredOutputType: 'json_schema',
            schemaName: owners.PROPOSAL_SCHEMA.name,
            strictSchema: Boolean(owners.PROPOSAL_SCHEMA.strict),
            timeoutMs: owners.DEFAULT_REQUEST_TIMEOUT_MS,
            maxCompletionTokens: owners.MAX_COMPLETION_TOKENS,
            singleAttemptOnly: true,
            retriesEnabled: false,
            fallbackModelEnabled: false,
            defaultNetworkBlocked: true,
            externalCallsEnabled: Boolean(hasBoundKeyLoader && typeof fetchImpl === 'function'),
            requireConfirmedModelIdentity,
            maxLiveAttempts,
            liveAttemptsUsed,
            liveAttemptsRemaining: Math.max(0, maxLiveAttempts - liveAttemptsUsed)
          }),
          uiIntegration: registeredUiAsset ? 'REGISTERED_UI_INJECTED' : 'MOUNT_SEAM_READY',
          uiRoutes: Object.freeze({
            indexHtml: ['/', '/index.html', '/ui/index.html'],
            previewMjs: '/ui/preview.mjs',
            manifestServed: false
          }),
          ownerMountPrefix: '/__owners/',
          ownerAllowlistCount: Object.keys(EXACT_PRIVATE_OWNER_MOUNT_ALLOWLIST).length,
          ownerAllowlistPaths: Object.keys(EXACT_PRIVATE_OWNER_MOUNT_ALLOWLIST),
          excludedRoutes: EXCLUDED_CANDIDATE_PATHS,
          fixtureIds: Object.keys(sanitizedFixtures)
        }));
        return;
      }

      if (pathname === '/api/llama/fixtures') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          status: 'ok',
          fixtures: sanitizedFixtures
        }));
        return;
      }
    }

    async function readJsonBody() {
      return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 256 * 1024) {
            const tooLargeErr = new Error('Request payload exceeds 256 KB limit');
            tooLargeErr.code = 'PAYLOAD_TOO_LARGE';
            reject(tooLargeErr);
          }
        });
        req.on('end', () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch (err) {
            reject(err);
          }
        });
        req.on('error', reject);
      });
    }

    if (req.method === 'POST' && pathname === '/api/llama/propose') {
      try {
        const body = await readJsonBody();
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            status: 'refused',
            code: 'INVALID_REQUEST_BODY',
            reason: 'JSON body must be a plain object'
          }));
          return;
        }

        // Detect and ignore any caller attempt to supply auth flags, key paths, or ambient env overrides
        const ignoredCallerFields = IGNORED_CALLER_AUTH_FIELDS.filter(
          (field) => Object.hasOwn(body, field) || parsedUrl.searchParams.has(field)
        );
        const callerAuthIgnored = ignoredCallerFields.length > 0;

        const {
          instruction,
          model = owners.DEFAULT_LLAMA_MODEL,
          offlineFixture,
          step = 1,
          previousHash = owners.GENESIS_RECEIPT_HASH,
          allowBoundedCorrection = true,
          strictLimitTamper = false,
          correctionOverride = null,
          timeoutMs
        } = body;

        const headerRunId = typeof req.headers['x-demo-run-id'] === 'string' ? req.headers['x-demo-run-id'].trim() : '';
        const bodyRunId = typeof body.runId === 'string' ? body.runId.trim() : '';
        const activeRunId = /^run_[0-9a-f]{16,64}$/i.test(headerRunId)
          ? headerRunId
          : (/^run_[0-9a-f]{16,64}$/i.test(bodyRunId) ? bodyRunId : null);

        const boundedTimeoutMs = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
          ? Math.min(timeoutMs, owners.DEFAULT_REQUEST_TIMEOUT_MS)
          : owners.DEFAULT_REQUEST_TIMEOUT_MS;

        const serverUtcTimestamp = new Date().toISOString();
        const timestamp = serverUtcTimestamp;
        const observedAt = serverUtcTimestamp;
        const timestampSource = 'server_utc_clock';

        const rawExplicitMockTime = typeof body.mockTimestamp === 'string' && body.mockTimestamp.trim().length > 0
          ? body.mockTimestamp.trim()
          : (typeof body.timestamp === 'string' && body.timestamp.trim().length > 0 ? body.timestamp.trim() : null);

        const explicitMockTimeMetadata = rawExplicitMockTime
          ? {
              requestedTimestamp: rawExplicitMockTime,
              label: 'EXPLICIT_MOCK_TIME_METADATA_ONLY_NEVER_REAL_OBSERVED_AT',
              appliedToReceiptTimestamp: false
            }
          : null;

        if (typeof previousHash !== 'string' || !owners.HEX64_REGEX.test(previousHash)) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            status: 'refused',
            code: 'INVALID_PREVIOUS_HASH',
            message: 'previousHash must be a 64-character lowercase hex SHA-256 digest',
            timestamp,
            observedAt,
            timestampSource,
            explicitMockTimeMetadata,
            callerAuthIgnored
          }));
          return;
        }

        let currentState;
        if (Object.hasOwn(body, 'currentState') && body.currentState !== undefined) {
          const stateValidation = owners.validateAuthoritativeCurrentState(body.currentState);
          if (!stateValidation.valid) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              status: 'refused',
              verdict: 'refused',
              code: stateValidation.code,
              field: stateValidation.field || null,
              reason: stateValidation.reason,
              timestamp,
              observedAt,
              timestampSource,
              explicitMockTimeMetadata,
              callerAuthIgnored
            }));
            return;
          }
          currentState = stateValidation.state;
        } else {
          currentState = owners.deriveAuthoritativeStateSnapshot(offlineFixture);
        }

        // Enforce single-attempt budget when live external calls are enabled and no offlineFixture is used
        if (!offlineFixture && trustedExternalAllowed && hasBoundKeyLoader && typeof fetchImpl === 'function') {
          if (liveAttemptsUsed >= maxLiveAttempts) {
            const budgetEvaluation = {
              status: 'refused',
              code: 'SINGLE_ATTEMPT_BUDGET_EXHAUSTED',
              reason: `Trusted live-entry server permits at most ${maxLiveAttempts} outbound provider attempt per session; retries and second attempts are disabled`
            };
            const budgetReceipt = owners.generateKinematicProposalReceipt({
              step,
              previousHash,
              currentState,
              proposal: {},
              evaluation: budgetEvaluation,
              correctionAttempt: 0,
              plantLimits: owners.PLANT_MANIFEST,
              timestamp
            });
            const budgetChain = owners.verifyProposalReceiptChain([budgetReceipt], previousHash);
            const budgetRunRecord = buildSanitizedCandidateRunRecord({
              owners,
              timestamp,
              timestampSource,
              fixtureMode: 'LIVE_META_API',
              input: {
                instruction,
                requestedModel: model,
                currentState,
                step,
                allowBoundedCorrection,
                strictLimitTamper,
                timeoutMs: boundedTimeoutMs
              },
              callProof: null,
              evaluationSummary: {
                status: 'refused',
                verdict: 'refused',
                code: 'SINGLE_ATTEMPT_BUDGET_EXHAUSTED',
                correctionAttempts: 0,
                recoveredByBoundedCorrection: false
              },
              previousHash,
              receipts: [budgetReceipt],
              swarmReceipt: null,
              chainVerification: budgetChain
            });
            res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              ...budgetEvaluation,
              verdict: 'refused',
              fixtureMode: 'LIVE_META_API',
              model,
              requestedModel: model,
              actualModel: null,
              actualModelStatus: 'UNCONFIRMED',
              modelIdentityConfirmed: false,
              callProof: null,
              liveAttemptsUsed,
              maxLiveAttempts,
              timestamp,
              observedAt,
              timestampSource,
              explicitMockTimeMetadata,
              callerAuthIgnored,
              ignoredCallerFields,
              currentState,
              plantLimits: owners.PLANT_MANIFEST,
              initialAccepted: false,
              unsafeAcceptedCount: 0,
              correctionAttempts: 0,
              maxBoundedCorrections: owners.MAX_BOUNDED_CORRECTIONS,
              recoveredByBoundedCorrection: false,
              receipt: budgetReceipt,
              receipts: [budgetReceipt],
              chainVerification: budgetChain,
              runRecord: budgetRunRecord
            }));
            return;
          }
          liveAttemptsUsed += 1;
        }

        // Delegate proposal generation to injected accepted owner with server-owned auth only
        const result = await owners.requestLlamaPhysicsProposal({
          instruction,
          currentState,
          model,
          offlineFixture,
          timeoutMs: boundedTimeoutMs,
          requireConfirmedModelIdentity,
          env: frozenEmptyEnv,
          rulesVerified: trustedExternalAllowed,
          keyLoader: zeroArgKeyLoader,
          fetchImpl: effectiveFetchImpl
        });

        const requestedModel = result.requestedModel ?? model;
        const safeCallProof = sanitizeCandidateCallProof(result.callProof || null, owners, requestedModel);
        const isSyntheticCall = Boolean(safeCallProof && safeCallProof.fixtureMode === 'SYNTHETIC');
        const fixtureMode = isSyntheticCall
          ? 'SYNTHETIC'
          : (result.fixtureMode || (offlineFixture ? 'MOCK_OFFLINE_FIXTURE' : 'LIVE_META_API'));
        const actualModel = result.actualModel ?? null;
        const actualModelStatus = isSyntheticCall && result.status === 'ok' && actualModel === requestedModel
          ? 'SYNTHETIC'
          : (result.actualModelStatus ?? (offlineFixture ? 'NOT_APPLICABLE_OFFLINE_FIXTURE' : 'UNCONFIRMED'));
        const modelIdentityConfirmed = isSyntheticCall ? false : Boolean(result.modelIdentityConfirmed);
        const reportedLiveAttemptsUsed = isSyntheticCall ? 0 : liveAttemptsUsed;

        if (result.status !== 'ok' || !result.proposal) {
          const refusalReceipt = owners.generateKinematicProposalReceipt({
            step,
            previousHash,
            currentState,
            proposal: {},
            evaluation: result,
            correctionAttempt: 0,
            plantLimits: owners.PLANT_MANIFEST,
            timestamp
          });
          const refusalChain = owners.verifyProposalReceiptChain([refusalReceipt], previousHash);
          const refusalRunRecord = buildSanitizedCandidateRunRecord({
            owners,
            runId: activeRunId,
            timestamp,
            timestampSource,
            fixtureMode,
            input: {
              instruction,
              requestedModel,
              currentState,
              step,
              allowBoundedCorrection,
              strictLimitTamper,
              timeoutMs: boundedTimeoutMs
            },
            callProof: safeCallProof,
            evaluationSummary: {
              status: 'refused',
              verdict: 'refused',
              code: result.code || 'REFUSED',
              correctionAttempts: 0,
              recoveredByBoundedCorrection: false
            },
            previousHash,
            receipts: [refusalReceipt],
            swarmReceipt: null,
            chainVerification: refusalChain
          });
          res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            ...result,
            ...(activeRunId ? { runId: activeRunId } : {}),
            verdict: 'refused',
            fixtureMode,
            model: requestedModel,
            requestedModel,
            actualModel,
            actualModelStatus,
            modelIdentityConfirmed,
            providerResponseIdStatus: safeCallProof ? safeCallProof.providerResponseIdStatus : 'UNCONFIRMED',
            usageStatus: safeCallProof ? safeCallProof.usageStatus : 'UNAVAILABLE',
            callProof: safeCallProof,
            liveAttemptsUsed: reportedLiveAttemptsUsed,
            maxLiveAttempts,
            timestamp,
            observedAt,
            timestampSource,
            explicitMockTimeMetadata,
            callerAuthIgnored,
            ignoredCallerFields,
            currentState,
            plantLimits: owners.PLANT_MANIFEST,
            initialAccepted: false,
            unsafeAcceptedCount: 0,
            correctionAttempts: 0,
            maxBoundedCorrections: owners.MAX_BOUNDED_CORRECTIONS,
            recoveredByBoundedCorrection: false,
            receipt: refusalReceipt,
            receipts: [refusalReceipt],
            chainVerification: refusalChain,
            runRecord: refusalRunRecord
          }));
          return;
        }

        const gated = owners.evaluateAndGateLlamaProposal({
          proposal: result.proposal,
          currentState,
          previousHash,
          step,
          timestamp,
          allowBoundedCorrection,
          strictLimitTamper,
          plantLimits: owners.PLANT_MANIFEST,
          correctionOverride,
          criticEvaluator: owners.evaluateKinematicCritic,
          interlockEvaluator: owners.evaluateSafetyInterlock,
          quorumResolver: owners.resolveSwarmQuorum
        });

        const interlockProvenance = owners.evaluateInterlock(
          gated.criticVote,
          owners.PLANT_MANIFEST_HASH,
          owners.PLANT_MANIFEST_HASH
        );

        const swarmReceipt = owners.generateSwarmStepReceipt({
          step,
          previousHash,
          plannerProposal: gated.proposal,
          criticVote: gated.criticVote,
          interlockVote: gated.interlockVote,
          quorumDecision: gated.quorumDecision,
          timestamp
        });

        const chainVerification = owners.verifyProposalReceiptChain(gated.receipts, previousHash);
        const runRecord = buildSanitizedCandidateRunRecord({
          owners,
          runId: activeRunId,
          timestamp,
          timestampSource,
          fixtureMode,
          input: {
            instruction,
            requestedModel,
            currentState,
            step,
            allowBoundedCorrection,
            strictLimitTamper,
            timeoutMs: boundedTimeoutMs
          },
          callProof: safeCallProof,
          evaluationSummary: {
            status: gated.status,
            verdict: gated.verdict,
            code: gated.code || null,
            correctionAttempts: gated.correctionAttempts,
            recoveredByBoundedCorrection: gated.recoveredByBoundedCorrection
          },
          previousHash,
          receipts: gated.receipts,
          swarmReceipt,
          chainVerification
        });
        const httpStatus = gated.status === 'ok' ? 200 : 422;

        res.writeHead(httpStatus, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          ...gated,
          ...(activeRunId ? { runId: activeRunId } : {}),
          source: isSyntheticCall ? 'synthetic_injected_transport' : result.source,
          fixtureMode,
          model: requestedModel,
          requestedModel,
          actualModel,
          actualModelStatus,
          modelIdentityConfirmed,
          providerResponseIdStatus: safeCallProof ? safeCallProof.providerResponseIdStatus : 'UNCONFIRMED',
          usageStatus: safeCallProof ? safeCallProof.usageStatus : 'UNAVAILABLE',
          callProof: safeCallProof,
          liveAttemptsUsed: reportedLiveAttemptsUsed,
          maxLiveAttempts,
          timestamp,
          observedAt,
          timestampSource,
          explicitMockTimeMetadata,
          callerAuthIgnored,
          ignoredCallerFields,
          interlockProvenance,
          swarmReceipt,
          chainVerification,
          runRecord
        }));
        return;
      } catch (err) {
        const isTooLarge = Boolean(err && err.code === 'PAYLOAD_TOO_LARGE');
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          status: 'error',
          code: isTooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST_JSON',
          message: isTooLarge ? 'Request payload exceeds 256 KB limit' : 'Malformed JSON request body'
        }));
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: 'not_found',
      path: pathname
    }));
  });

  return server;
}

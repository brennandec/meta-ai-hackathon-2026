/**
 * Clean-Room Meta Model API (Muse Spark 1.3 / Muse Wonder 1.0) Physics Adapter.
 * Zero external dependencies. Zero monorepo house imports.
 * Strict 7-bit ASCII implementation.
 * Enforces Pre-Rules Release Gate (META_OFFICIAL_RULES_VERIFIED=1) prior to live API dispatch.
 * Supports structured 9-parameter physical JSON Schema, immutable plant limits,
 * bounded 1-step safe correction, and deterministic currentState receipt chaining.
 */

import {
  evaluatePhysicsProposal,
  canonicalStringify,
  sha256Sync,
  HEX64_REGEX
} from './meta-physics-agent.mjs';

export const DEFAULT_LLAMA_MODEL = 'muse-spark-1.3';
export const CONFIGURABLE_LLAMA_MODELS = Object.freeze([
  'muse-spark-1.3',
  'muse-wonder-1.0'
]);
export const META_LLAMA_ENDPOINT = 'https://api.meta.ai/v1/chat/completions';
export const MAX_COMPLETION_TOKENS = 512;
export const MAX_BOUNDED_CORRECTIONS = 1;
export const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
export const GENESIS_RECEIPT_HASH = '0'.repeat(64);

/**
 * Server-owned immutable plant physical limits (matches PLANT_MANIFEST in swarm-verifier.mjs).
 * Untrusted model proposals cannot inflate or override these physical bounds.
 */
export const IMMUTABLE_PLANT_LIMITS = Object.freeze({
  frictionMu: 0.8,
  maxSafeBrakeForceN: 5000.0,
  structuralLimitN: 10000.0
});

export const PLANT_LIMIT_FIELDS = Object.freeze([
  'frictionMu',
  'maxSafeBrakeForceN',
  'structuralLimitN'
]);

export const STATE_SNAPSHOT_FIELDS = Object.freeze([
  'massKg',
  'velocityMps',
  'stopDistanceM',
  'thrustN'
]);

/**
 * Strict JSON Schema for Meta Model API response_format (json_schema protocol).
 */
export const PROPOSAL_SCHEMA = Object.freeze({
  name: 'kinematic_physics_proposal',
  strict: true,
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: Object.freeze([
      'id',
      'title',
      'massKg',
      'velocityMps',
      'stopDistanceM',
      'frictionMu',
      'maxSafeBrakeForceN',
      'thrustN',
      'structuralLimitN'
    ]),
    properties: Object.freeze({
      id: Object.freeze({ type: 'string' }),
      title: Object.freeze({ type: 'string' }),
      massKg: Object.freeze({ type: 'number' }),
      velocityMps: Object.freeze({ type: 'number' }),
      stopDistanceM: Object.freeze({ type: 'number' }),
      frictionMu: Object.freeze({ type: 'number' }),
      maxSafeBrakeForceN: Object.freeze({ type: 'number' }),
      thrustN: Object.freeze({ type: 'number' }),
      structuralLimitN: Object.freeze({ type: 'number' })
    })
  })
});

export const LLAMA_PROPOSAL_JSON_SCHEMA = PROPOSAL_SCHEMA;

const REQUIRED_PROPOSAL_KEY_SET = new Set(PROPOSAL_SCHEMA.schema.required);

/**
 * Hard Pre-Rules Release Gate & Dedicated Keyfile Loader Gate.
 * Refuses live outbound HTTP calls unless official rules verification is active
 * (note removed for export)
 * returns { state: 'ready', key }.
 * Never reads ambient process.env API keys, OAuth tokens, or request-controlled key paths,
 * and never invokes keyLoader() before official rules verification passes.
 */
export function checkMetaRulesGate(env = {}, options = {}) {
  const isRulesVerified = Boolean(
    (env && typeof env === 'object' && (env.META_OFFICIAL_RULES_VERIFIED === '1' || env.rulesVerified === true)) ||
    (options && typeof options === 'object' && options.rulesVerified === true)
  );

  if (!isRulesVerified) {
    return {
      allowed: false,
      status: 'refused',
      code: 'META_RULES_GATE_UNVERIFIED',
      keyState: 'unchecked_before_rules_gate',
      refusal: {
        status: 'refused',
        code: 'META_RULES_GATE_UNVERIFIED',
        keyState: 'unchecked_before_rules_gate',
        reason: 'Live outbound Meta Model API requests refused: Meta Official Hackathon Rules not verified (requires META_OFFICIAL_RULES_VERIFIED=1 before dedicated keyfile load)'
      }
    };
  }

  const keyLoader = typeof options?.keyLoader === 'function'
    ? options.keyLoader
    : (env && typeof env === 'object' && typeof env.keyLoader === 'function' ? env.keyLoader : null);

  if (typeof keyLoader !== 'function') {
    return {
      allowed: false,
      status: 'refused',
      code: 'META_RULES_GATE_UNVERIFIED',
      keyState: 'key-loader-unbound',
      refusal: {
        status: 'refused',
        code: 'META_RULES_GATE_UNVERIFIED',
        keyState: 'key-loader-unbound',
        reason: 'Live outbound Meta Model API requests refused: dedicated keyfile loader (loadKey) is not bound; ambient env fallback is disabled'
      }
    };
  }

  let loaded;
  try {
    // Invoke with zero arguments so no caller or HTTP request can pass a custom keyFile path
    loaded = keyLoader();
  } catch {
    return {
      allowed: false,
      status: 'refused',
      code: 'META_RULES_GATE_UNVERIFIED',
      keyState: 'key-file-unreadable',
      refusal: {
        status: 'refused',
        code: 'META_RULES_GATE_UNVERIFIED',
        keyState: 'key-file-unreadable',
        reason: 'Live outbound Meta Model API requests refused: dedicated hackathon keyfile unreadable'
      }
    };
  }

  const keyState = loaded && typeof loaded.state === 'string' ? loaded.state : 'key-not-placed';
  const rawKey = loaded && loaded.state === 'ready' && typeof loaded.key === 'string'
    ? loaded.key.trim()
    : '';

  if (keyState !== 'ready' || !rawKey) {
    return {
      allowed: false,
      status: 'refused',
      code: 'META_RULES_GATE_UNVERIFIED',
      keyState,
      refusal: {
        status: 'refused',
        code: 'META_RULES_GATE_UNVERIFIED',
        keyState,
        reason: `Live outbound Meta Model API requests refused: dedicated hackathon keyfile not ready (state: ${keyState})`
      }
    };
  }

  return {
    allowed: true,
    apiKey: rawKey,
    keyState: 'ready',
    authSource: 'dedicated_keyfile_loader'
  };
}

/**
 * Constructs an OpenAI-compatible prompt targeting the 9-parameter physical schema.
 */
export function buildLlamaPhysicsPrompt({ instruction = 'Plan safe stopping deceleration for autonomous rover', currentState = {} } = {}) {
  const systemPrompt = [
    'You are an autonomous kinetic physics agent reasoning over robotic actuation.',
    'You must output ONLY a valid JSON object specifying physical parameters conforming to the schema:',
    '{',
    '  "id": "<string_identifier>",',
    '  "title": "<string_title>",',
    '  "massKg": <positive_number>,',
    '  "velocityMps": <non_negative_number>,',
    '  "stopDistanceM": <positive_number>,',
    '  "frictionMu": <positive_number>,',
    '  "maxSafeBrakeForceN": <positive_number>,',
    '  "thrustN": <non_negative_number>,',
    '  "structuralLimitN": <positive_number>',
    '}',
    'Do NOT wrap the output in conversational prose. Respond with ONLY the raw JSON object.'
  ].join('\n');

  const userPrompt = [
    `Actuation Instruction: ${instruction}`,
    'Current State Context:',
    JSON.stringify(currentState, null, 2)
  ].join('\n');

  return {
    system: systemPrompt,
    user: userPrompt,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };
}

/**
 * Extracts and strictly validates the 9-parameter physical proposal against PROPOSAL_SCHEMA.
 * Rejects unknown properties (additionalProperties: false) and missing/empty required id or title.
 * Preserves structured model refusal payloads (status === 'refused' or non-empty refusal string).
 */
export function extractPhysicsProposal(content) {
  if (!content) {
    return {
      status: 'refused',
      code: 'INVALID_PROPOSAL_SHAPE',
      reason: 'Empty response content'
    };
  }

  let raw = content;
  if (typeof raw === 'string') {
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonStr = fenceMatch ? fenceMatch[1].trim() : raw.trim();
    try {
      raw = JSON.parse(jsonStr);
    } catch (err) {
      const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        try {
          raw = JSON.parse(objectMatch[0]);
        } catch {
          return {
            status: 'refused',
            code: 'INVALID_PROPOSAL_SHAPE',
            reason: 'Failed to parse JSON proposal from response text: ' + err.message
          };
        }
      } else {
        return {
          status: 'refused',
          code: 'INVALID_PROPOSAL_SHAPE',
          reason: 'Failed to parse JSON proposal from response text: ' + err.message
        };
      }
    }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      status: 'refused',
      code: 'INVALID_PROPOSAL_SHAPE',
      reason: 'Extracted proposal is not a valid non-null object'
    };
  }

  // G2: Preserve refusal reason when given a refusal-shaped object
  if (raw.status === 'refused' || (typeof raw.refusal === 'string' && raw.refusal.trim())) {
    const refusalReason = typeof raw.reason === 'string' && raw.reason.trim()
      ? raw.reason.trim()
      : (typeof raw.refusal === 'string' && raw.refusal.trim()
        ? raw.refusal.trim()
        : 'Model refused to generate physics proposal');
    return {
      status: 'refused',
      code: typeof raw.code === 'string' && raw.code.trim() ? raw.code.trim() : 'MODEL_REFUSAL',
      reason: refusalReason,
      ...(typeof raw.field === 'string' && raw.field ? { field: raw.field } : {})
    };
  }

  // Enforce strict schema additionalProperties: false
  for (const key of Object.keys(raw)) {
    if (!REQUIRED_PROPOSAL_KEY_SET.has(key)) {
      return {
        status: 'refused',
        code: 'INVALID_PROPOSAL_SHAPE',
        field: key,
        reason: `Unexpected property ${key} is not permitted by PROPOSAL_SCHEMA (additionalProperties: false)`
      };
    }
  }

  const requiredNumericFields = [
    'massKg',
    'velocityMps',
    'stopDistanceM',
    'frictionMu',
    'maxSafeBrakeForceN',
    'thrustN',
    'structuralLimitN'
  ];

  for (const field of requiredNumericFields) {
    if (typeof raw[field] !== 'number' || !Number.isFinite(raw[field])) {
      return {
        status: 'refused',
        code: 'NUMERICAL_INSTABILITY',
        field,
        reason: `Required numeric field ${field} is missing or non-finite`
      };
    }
  }

  if (typeof raw.id !== 'string' || !raw.id.trim()) {
    return {
      status: 'refused',
      code: 'INVALID_PROPOSAL_SHAPE',
      field: 'id',
      reason: 'Required string field id is missing or empty'
    };
  }

  if (typeof raw.title !== 'string' || !raw.title.trim()) {
    return {
      status: 'refused',
      code: 'INVALID_PROPOSAL_SHAPE',
      field: 'title',
      reason: 'Required string field title is missing or empty'
    };
  }

  return {
    id: raw.id.trim().slice(0, 64),
    title: raw.title.trim().slice(0, 128),
    massKg: raw.massKg,
    velocityMps: raw.velocityMps,
    stopDistanceM: raw.stopDistanceM,
    frictionMu: raw.frictionMu,
    maxSafeBrakeForceN: raw.maxSafeBrakeForceN,
    thrustN: raw.thrustN,
    structuralLimitN: raw.structuralLimitN
  };
}

/**
 * Validates that a server-owned currentState snapshot is a non-null plain object
 * and that any present kinematic state fields are finite numbers within physical domains.
 */
export function validateAuthoritativeCurrentState(currentState) {
  if (!currentState || typeof currentState !== 'object' || Array.isArray(currentState)) {
    return {
      valid: false,
      status: 'refused',
      code: 'INVALID_CURRENT_STATE',
      reason: 'currentState must be a non-null plain object'
    };
  }

  if (Object.hasOwn(currentState, 'massKg') && currentState.massKg !== undefined) {
    if (typeof currentState.massKg !== 'number' || !Number.isFinite(currentState.massKg) || currentState.massKg <= 0) {
      return {
        valid: false,
        status: 'refused',
        code: 'INVALID_CURRENT_STATE',
        field: 'massKg',
        reason: 'currentState.massKg must be a finite positive number'
      };
    }
  }

  if (Object.hasOwn(currentState, 'velocityMps') && currentState.velocityMps !== undefined) {
    if (typeof currentState.velocityMps !== 'number' || !Number.isFinite(currentState.velocityMps) || currentState.velocityMps < 0) {
      return {
        valid: false,
        status: 'refused',
        code: 'INVALID_CURRENT_STATE',
        field: 'velocityMps',
        reason: 'currentState.velocityMps must be a finite non-negative number'
      };
    }
  }

  if (Object.hasOwn(currentState, 'stopDistanceM') && currentState.stopDistanceM !== undefined) {
    if (typeof currentState.stopDistanceM !== 'number' || !Number.isFinite(currentState.stopDistanceM) || currentState.stopDistanceM <= 0) {
      return {
        valid: false,
        status: 'refused',
        code: 'INVALID_CURRENT_STATE',
        field: 'stopDistanceM',
        reason: 'currentState.stopDistanceM must be a finite positive number'
      };
    }
  }

  if (Object.hasOwn(currentState, 'thrustN') && currentState.thrustN !== undefined) {
    if (typeof currentState.thrustN !== 'number' || !Number.isFinite(currentState.thrustN) || currentState.thrustN < 0) {
      return {
        valid: false,
        status: 'refused',
        code: 'INVALID_CURRENT_STATE',
        field: 'thrustN',
        reason: 'currentState.thrustN must be a finite non-negative number'
      };
    }
  }

  return {
    valid: true,
    state: { ...currentState }
  };
}

/**
 * Enforces immutable server-owned plant limits AND authoritative currentState snapshot
 * on an untrusted proposal (G3).
 * Detects any attempt to alter or inflate frictionMu, maxSafeBrakeForceN, or structuralLimitN,
 * or to falsify currentState's massKg, velocityMps, stopDistanceM, or thrustN.
 */
export function enforceImmutablePlantLimits(
  proposal,
  plantLimits = IMMUTABLE_PLANT_LIMITS,
  currentState = null
) {
  const pinned = plantLimits && typeof plantLimits === 'object' ? plantLimits : IMMUTABLE_PLANT_LIMITS;
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
    return {
      enforcedProposal: null,
      limitTamper: null,
      limitsInflated: false,
      invalidLimitField: null,
      stateTamper: null
    };
  }

  const tamperedFields = [];
  const inflatedFields = [];
  let invalidLimitField = null;

  for (const field of PLANT_LIMIT_FIELDS) {
    const proposedVal = proposal[field];
    const pinnedVal = pinned[field];
    if (Object.hasOwn(proposal, field) && proposedVal !== undefined) {
      if (typeof proposedVal !== 'number' || !Number.isFinite(proposedVal) || proposedVal <= 0) {
        if (!invalidLimitField) {
          invalidLimitField = {
            code: 'NUMERICAL_INSTABILITY',
            field,
            proposed: proposedVal,
            reason: `Proposal plant limit field ${field} must be a finite positive number`
          };
        }
      }
      if (!Object.is(proposedVal, pinnedVal)) {
        tamperedFields.push({
          field,
          proposed: proposedVal,
          pinned: pinnedVal
        });
        if (typeof proposedVal === 'number' && Number.isFinite(proposedVal) && proposedVal > pinnedVal) {
          inflatedFields.push({
            field,
            proposed: proposedVal,
            pinned: pinnedVal
          });
        }
      }
    }
  }

  const limitTamper = tamperedFields.length > 0
    ? {
        code: 'LIMIT_TAMPER',
        field: tamperedFields[0].field,
        proposed: tamperedFields[0].proposed,
        pinned: tamperedFields[0].pinned,
        tamperedFields,
        inflatedFields
      }
    : null;

  const stateMismatches = [];
  const hasStateObj = currentState && typeof currentState === 'object' && !Array.isArray(currentState);
  if (hasStateObj) {
    for (const field of STATE_SNAPSHOT_FIELDS) {
      if (
        Object.hasOwn(currentState, field) &&
        typeof currentState[field] === 'number' &&
        Number.isFinite(currentState[field])
      ) {
        const authoritativeVal = currentState[field];
        const proposedVal = proposal[field];
        if (typeof proposedVal === 'number' && Number.isFinite(proposedVal) && !Object.is(proposedVal, authoritativeVal)) {
          stateMismatches.push({
            field,
            proposed: proposedVal,
            authoritative: authoritativeVal
          });
        }
      }
    }
  }

  const stateTamper = stateMismatches.length > 0
    ? {
        code: 'STATE_SNAPSHOT_MISMATCH',
        field: stateMismatches[0].field,
        proposed: stateMismatches[0].proposed,
        authoritative: stateMismatches[0].authoritative,
        mismatches: stateMismatches
      }
    : null;

  const resolveStateField = (field) => {
    const proposedVal = proposal[field];
    if (typeof proposedVal !== 'number' || !Number.isFinite(proposedVal)) {
      return proposedVal;
    }
    if (
      hasStateObj &&
      Object.hasOwn(currentState, field) &&
      typeof currentState[field] === 'number' &&
      Number.isFinite(currentState[field])
    ) {
      return currentState[field];
    }
    return proposedVal;
  };

  const enforcedProposal = {
    id: typeof proposal.id === 'string' && proposal.id ? proposal.id.slice(0, 64) : 'llama-proposal',
    title: typeof proposal.title === 'string' && proposal.title ? proposal.title.slice(0, 128) : 'Physical Deceleration Proposal',
    massKg: resolveStateField('massKg'),
    velocityMps: resolveStateField('velocityMps'),
    stopDistanceM: resolveStateField('stopDistanceM'),
    frictionMu: invalidLimitField?.field === 'frictionMu' ? proposal.frictionMu : pinned.frictionMu,
    maxSafeBrakeForceN: invalidLimitField?.field === 'maxSafeBrakeForceN' ? proposal.maxSafeBrakeForceN : pinned.maxSafeBrakeForceN,
    thrustN: resolveStateField('thrustN'),
    structuralLimitN: invalidLimitField?.field === 'structuralLimitN' ? proposal.structuralLimitN : pinned.structuralLimitN
  };

  return {
    enforcedProposal,
    limitTamper,
    limitsInflated: inflatedFields.length > 0,
    invalidLimitField,
    stateTamper
  };
}

/**
 * Deterministic 1-step bounded safe correction (G2).
 * Given a refused proposal and its refusal evaluation, synthesizes at most ONE bounded correction
 * clamped strictly inside server-owned plant limits.
 */
export function applyBoundedStepCorrection(
  proposal,
  refusalEvaluation,
  plantLimits = IMMUTABLE_PLANT_LIMITS,
  correctionOverride = null
) {
  const pinned = plantLimits && typeof plantLimits === 'object' ? plantLimits : IMMUTABLE_PLANT_LIMITS;

  if (correctionOverride && typeof correctionOverride === 'object') {
    const { enforcedProposal } = enforceImmutablePlantLimits(correctionOverride, pinned);
    return enforcedProposal;
  }

  if (!proposal || typeof proposal !== 'object') {
    return null;
  }

  const massKg = proposal.massKg;
  const rawStopDistance = proposal.stopDistanceM;
  const rawVelocity = proposal.velocityMps;

  // Cannot deterministically repair non-finite or non-positive plant mass
  if (typeof massKg !== 'number' || !Number.isFinite(massKg) || massKg <= 0) {
    return {
      ...proposal,
      frictionMu: pinned.frictionMu,
      maxSafeBrakeForceN: pinned.maxSafeBrakeForceN,
      structuralLimitN: pinned.structuralLimitN
    };
  }

  if (typeof rawVelocity !== 'number' || !Number.isFinite(rawVelocity) || rawVelocity < 0 ||
      typeof rawStopDistance !== 'number' || !Number.isFinite(rawStopDistance) || rawStopDistance <= 0) {
    return {
      ...proposal,
      frictionMu: pinned.frictionMu,
      maxSafeBrakeForceN: pinned.maxSafeBrakeForceN,
      structuralLimitN: pinned.structuralLimitN
    };
  }

  // Cannot synthesize a valid 1-step correction when stopDistanceM is already inside collision horizon (< 1.0m) at high velocity
  if (rawStopDistance < 1.0 && rawVelocity > 5.0) {
    return {
      ...proposal,
      frictionMu: pinned.frictionMu,
      maxSafeBrakeForceN: pinned.maxSafeBrakeForceN,
      structuralLimitN: pinned.structuralLimitN
    };
  }

  const safeStopDistanceM = Math.max(rawStopDistance, 2.0);
  const maxFrictionForceN = pinned.frictionMu * massKg * 9.80665;
  const maxEnvelopeForceN = Math.min(
    maxFrictionForceN,
    pinned.maxSafeBrakeForceN,
    pinned.structuralLimitN
  ) * 0.85;

  const maxSafeVelocityMps = Math.sqrt((2.0 * maxEnvelopeForceN * safeStopDistanceM) / massKg);
  const correctedVelocityMps = Math.floor(Math.min(rawVelocity, maxSafeVelocityMps) * 1000) / 1000;

  return {
    id: `${proposal.id || 'llama-proposal'}-bounded-correction-1`.slice(0, 64),
    title: `${proposal.title || 'Proposal'} (Bounded 1-Step Safe Correction)`.slice(0, 128),
    massKg,
    velocityMps: correctedVelocityMps,
    stopDistanceM: safeStopDistanceM,
    frictionMu: pinned.frictionMu,
    maxSafeBrakeForceN: pinned.maxSafeBrakeForceN,
    thrustN: 0.0,
    structuralLimitN: pinned.structuralLimitN
  };
}

/**
 * Generates a canonical SHA-256 kinematic proposal receipt that includes currentState
 * and links via previousHash (G6).
 */
export function generateKinematicProposalReceipt({
  step = 1,
  previousHash = GENESIS_RECEIPT_HASH,
  currentState = {},
  proposal = {},
  evaluation = {},
  criticVote = null,
  interlockVote = null,
  quorumDecision = null,
  correctionAttempt = 0,
  parentRefusalCode = null,
  parentRefusalReason = null,
  plantLimits = IMMUTABLE_PLANT_LIMITS,
  timestamp = new Date().toISOString()
} = {}) {
  if (typeof previousHash !== 'string' || !HEX64_REGEX.test(previousHash)) {
    throw new Error('INVALID_PREVIOUS_HASH: previousHash must be a 64-character lowercase hex SHA-256 digest');
  }

  const cleanNum = (v) => {
    if (typeof v === 'number' && !Number.isFinite(v)) return `__nonfinite:${String(v)}`;
    return v ?? null;
  };

  const normalizedState = currentState && typeof currentState === 'object' && !Array.isArray(currentState)
    ? currentState
    : {};

  const status = evaluation?.status === 'accepted' ? 'accepted' : 'refused';
  const code = status === 'accepted' ? null : (evaluation?.code ?? quorumDecision?.refusalCode ?? 'CONTRACT_REFUSED');
  const reason = status === 'accepted'
    ? (evaluation?.reason ?? quorumDecision?.reason ?? 'Kinematic proposal verified within plant safety limits')
    : (evaluation?.reason ?? quorumDecision?.reason ?? 'Kinematic proposal refused by safety contract gate');

  const canonicalObj = {
    code,
    correctionAttempt,
    criticVote: criticVote ? {
      code: criticVote.code ?? null,
      role: criticVote.role || 'kinematic_critic',
      vote: criticVote.vote
    } : null,
    currentState: normalizedState,
    interlockVote: interlockVote ? {
      code: interlockVote.code ?? null,
      contractStatus: interlockVote.contractStatus,
      role: interlockVote.role || 'safety_interlock',
      vote: interlockVote.vote
    } : null,
    metrics: evaluation?.metrics ?? evaluation?.state ?? null,
    parentRefusalCode: parentRefusalCode ?? null,
    parentRefusalReason: parentRefusalReason ?? null,
    plantLimits: plantLimits || IMMUTABLE_PLANT_LIMITS,
    previousHash,
    proposal: {
      frictionMu: cleanNum(proposal?.frictionMu),
      id: proposal?.id || `step-${step}`,
      massKg: cleanNum(proposal?.massKg),
      maxSafeBrakeForceN: cleanNum(proposal?.maxSafeBrakeForceN),
      stopDistanceM: cleanNum(proposal?.stopDistanceM),
      structuralLimitN: cleanNum(proposal?.structuralLimitN),
      thrustN: cleanNum(proposal?.thrustN),
      title: proposal?.title || `Step ${step}`,
      velocityMps: cleanNum(proposal?.velocityMps)
    },
    quorumStatus: quorumDecision?.status ?? (status === 'accepted' ? 'ACCEPTED' : 'REFUSED'),
    reason,
    status,
    step,
    timestamp
  };

  const canonicalJson = canonicalStringify(canonicalObj);
  const receiptHash = sha256Sync(canonicalJson);

  return {
    step,
    status,
    code,
    reason,
    correctionAttempt,
    parentRefusalCode: canonicalObj.parentRefusalCode,
    parentRefusalReason: canonicalObj.parentRefusalReason,
    currentState: normalizedState,
    previousHash,
    canonicalObj,
    canonicalJson,
    receiptHash,
    timestamp
  };
}

/**
 * Verifies a chain of kinematic proposal receipts, ensuring currentState presence,
 * outer receipt field fidelity against canonicalObj, canonical hash integrity,
 * previousHash linkage (currentState -> refusal -> correction),
 * and MAX_BOUNDED_CORRECTIONS = 1 bound.
 */
export function verifyProposalReceiptChain(receipts, initialPreviousHash = GENESIS_RECEIPT_HASH) {
  if (!Array.isArray(receipts) || receipts.length === 0) {
    return {
      valid: false,
      verified: false,
      code: 'EMPTY_RECEIPT_CHAIN',
      step: null,
      reason: 'Receipt chain must be a non-empty array'
    };
  }

  if (receipts.length > MAX_BOUNDED_CORRECTIONS + 1) {
    return {
      valid: false,
      verified: false,
      code: 'BOUNDED_CORRECTION_LIMIT_EXCEEDED',
      step: receipts.length,
      reason: `Receipt chain length ${receipts.length} exceeds MAX_BOUNDED_CORRECTIONS (${MAX_BOUNDED_CORRECTIONS}) + 1`
    };
  }

  let expectedPreviousHash = initialPreviousHash;

  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];
    if (!r || typeof r !== 'object' || !r.canonicalObj) {
      return {
        valid: false,
        verified: false,
        code: 'INVALID_RECEIPT_OBJECT',
        step: i + 1,
        reason: `Receipt at index ${i} is missing canonicalObj`
      };
    }

    if (!r.canonicalObj.currentState || typeof r.canonicalObj.currentState !== 'object' || Array.isArray(r.canonicalObj.currentState)) {
      return {
        valid: false,
        verified: false,
        code: 'MISSING_CURRENT_STATE',
        step: i + 1,
        reason: `Receipt at index ${i} is missing valid currentState object`
      };
    }

    if (r.previousHash !== expectedPreviousHash || r.canonicalObj.previousHash !== expectedPreviousHash) {
      return {
        valid: false,
        verified: false,
        code: 'TAMPER_CHAIN_BROKEN',
        step: i + 1,
        reason: `Chain link broken at index ${i}: expected previousHash ${expectedPreviousHash}, got ${r.previousHash}`
      };
    }

    // Verify outer receipt fields match canonicalObj (prevents outer-field spoofing without touching canonicalObj)
    const outerMismatch =
      r.step !== r.canonicalObj.step ||
      r.status !== r.canonicalObj.status ||
      r.code !== r.canonicalObj.code ||
      r.reason !== r.canonicalObj.reason ||
      r.correctionAttempt !== r.canonicalObj.correctionAttempt ||
      r.parentRefusalCode !== r.canonicalObj.parentRefusalCode ||
      r.parentRefusalReason !== r.canonicalObj.parentRefusalReason ||
      r.previousHash !== r.canonicalObj.previousHash ||
      r.timestamp !== r.canonicalObj.timestamp ||
      canonicalStringify(r.currentState) !== canonicalStringify(r.canonicalObj.currentState);

    if (outerMismatch) {
      return {
        valid: false,
        verified: false,
        code: 'TAMPER_PAYLOAD_MISMATCH',
        step: i + 1,
        reason: `Outer receipt fields at index ${i} do not match canonicalObj payload`
      };
    }

    const recomputedJson = canonicalStringify(r.canonicalObj);
    if (typeof r.canonicalJson === 'string' && r.canonicalJson !== recomputedJson) {
      return {
        valid: false,
        verified: false,
        code: 'TAMPER_PAYLOAD_MISMATCH',
        step: i + 1,
        reason: `Receipt canonicalJson mismatch at index ${i}`
      };
    }

    const recomputedHash = sha256Sync(recomputedJson);
    if (recomputedHash !== r.receiptHash) {
      return {
        valid: false,
        verified: false,
        code: 'TAMPER_PAYLOAD_MISMATCH',
        step: i + 1,
        reason: `Receipt hash mismatch at index ${i}`
      };
    }

    if (i === 1) {
      if (receipts[0].canonicalObj.status !== 'refused') {
        return {
          valid: false,
          verified: false,
          code: 'UNWARRANTED_CORRECTION_STEP',
          step: 2,
          reason: 'Bounded correction receipt present when initial receipt was not refused'
        };
      }
      if (
        r.canonicalObj.correctionAttempt !== 1 ||
        r.canonicalObj.parentRefusalCode !== receipts[0].canonicalObj.code
      ) {
        return {
          valid: false,
          verified: false,
          code: 'CORRECTION_PROVENANCE_MISMATCH',
          step: 2,
          reason: 'Correction receipt does not link parentRefusalCode and correctionAttempt=1 to initial refusal'
        };
      }
    }

    expectedPreviousHash = r.receiptHash;
  }

  const rootPreimage = receipts.map((r) => r.receiptHash).join('\n') + '\n';
  return {
    valid: true,
    verified: true,
    code: null,
    stepsVerified: receipts.length,
    chainRootSha256: sha256Sync(rootPreimage)
  };
}

/**
 * Deterministic offline simulation fixtures for local testing and offline replay.
 * Plant limits match IMMUTABLE_PLANT_LIMITS (frictionMu: 0.8, maxSafeBrakeForceN: 5000, structuralLimitN: 10000).
 */
export const OFFLINE_LLAMA_FIXTURES = Object.freeze({
  nominal_warehouse_stop: {
    id: 'nominal_warehouse_stop',
    title: 'Nominal AMR Warehouse Stopping Deceleration',
    instruction: 'Stop autonomous mobile robot safely before aisle marker A12',
    proposal: {
      id: 'nominal_warehouse_stop',
      title: 'Nominal AMR Warehouse Stopping Deceleration',
      massKg: 500.0,
      velocityMps: 3.0,
      stopDistanceM: 2.0,
      frictionMu: 0.8,
      maxSafeBrakeForceN: 5000.0,
      thrustN: 0.0,
      structuralLimitN: 10000.0
    },
    expectedStatus: 'accepted'
  },
  velocity_drift_skid: {
    id: 'velocity_drift_skid',
    title: 'Velocity Drift Road Skid (Friction Exceeded)',
    instruction: 'Emergency stop after high velocity transit on low friction surface',
    proposal: {
      id: 'velocity_drift_skid',
      title: 'Velocity Drift Road Skid (Friction Exceeded)',
      massKg: 500.0,
      velocityMps: 6.0,
      stopDistanceM: 1.5,
      frictionMu: 0.8,
      maxSafeBrakeForceN: 5000.0,
      thrustN: 0.0,
      structuralLimitN: 10000.0
    },
    expectedStatus: 'refused',
    expectedCode: 'FRICTION_LIMIT_EXCEEDED'
  },
  brake_overload: {
    id: 'brake_overload',
    title: 'Brake Caliper Force Overload',
    instruction: 'Rapid deceleration of heavy cargo carrier beyond actuator rating',
    proposal: {
      id: 'brake_overload',
      title: 'Brake Caliper Force Overload',
      massKg: 1200.0,
      velocityMps: 7.5,
      stopDistanceM: 4.0,
      frictionMu: 0.8,
      maxSafeBrakeForceN: 5000.0,
      thrustN: 0.0,
      structuralLimitN: 10000.0
    },
    expectedStatus: 'refused',
    expectedCode: 'BRAKE_FORCE_EXCEEDED'
  },
  excessive_thrust_structural_failure: {
    id: 'excessive_thrust_structural_failure',
    title: 'High Acceleration Structural Limit Exceeded',
    instruction: 'Apply simultaneous deceleration with active thruster assist',
    proposal: {
      id: 'excessive_thrust_structural_failure',
      title: 'High Acceleration Structural Limit Exceeded',
      massKg: 800.0,
      velocityMps: 5.0,
      stopDistanceM: 2.0,
      frictionMu: 0.8,
      maxSafeBrakeForceN: 5000.0,
      thrustN: 12000.0,
      structuralLimitN: 10000.0
    },
    expectedStatus: 'refused',
    expectedCode: 'STRUCTURAL_LIMIT_EXCEEDED'
  },
  numerical_instability: {
    id: 'numerical_instability',
    title: 'Hallucinated NaN Parameter',
    instruction: 'Malformed token proposal with non-numeric velocity parameter',
    proposal: {
      id: 'numerical_instability',
      title: 'Hallucinated NaN Parameter',
      massKg: 500.0,
      velocityMps: NaN,
      stopDistanceM: 2.0,
      frictionMu: 0.8,
      maxSafeBrakeForceN: 5000.0,
      thrustN: 0.0,
      structuralLimitN: 10000.0
    },
    expectedStatus: 'refused',
    expectedCode: 'NUMERICAL_INSTABILITY'
  }
});

/**
 * Derives the server-owned authoritative kinematic state snapshot for an offline fixture
 * when a caller selects a fixture without specifying an explicit currentState override.
 */
export function deriveAuthoritativeStateSnapshot(offlineFixture) {
  let src = null;
  if (typeof offlineFixture === 'string' && OFFLINE_LLAMA_FIXTURES[offlineFixture]) {
    src = OFFLINE_LLAMA_FIXTURES[offlineFixture].proposal;
  } else if (offlineFixture && typeof offlineFixture === 'object') {
    src = offlineFixture.proposal && typeof offlineFixture.proposal === 'object'
      ? offlineFixture.proposal
      : offlineFixture;
  }

  return {
    massKg: typeof src?.massKg === 'number' && Number.isFinite(src.massKg) && src.massKg > 0 ? src.massKg : 500.0,
    velocityMps: typeof src?.velocityMps === 'number' && Number.isFinite(src.velocityMps) && src.velocityMps >= 0 ? src.velocityMps : 3.0,
    stopDistanceM: typeof src?.stopDistanceM === 'number' && Number.isFinite(src.stopDistanceM) && src.stopDistanceM > 0 ? src.stopDistanceM : 2.0,
    ...(typeof src?.thrustN === 'number' && Number.isFinite(src.thrustN) && src.thrustN >= 0 ? { thrustN: src.thrustN } : {})
  };
}

/**
 * Evaluates an untrusted proposal under immutable server-owned plant limits and authoritative currentState,
 * mints the initial currentState kinematic receipt, and executes at most ONE
 * bounded correction step (MAX_BOUNDED_CORRECTIONS = 1) when refused (G1, G2, G3, G6).
 */
export function evaluateAndGateLlamaProposal({
  proposal,
  currentState = {},
  previousHash = GENESIS_RECEIPT_HASH,
  step = 1,
  timestamp = new Date().toISOString(),
  allowBoundedCorrection = true,
  strictLimitTamper = false,
  plantLimits = IMMUTABLE_PLANT_LIMITS,
  correctionOverride = null,
  criticEvaluator = null,
  interlockEvaluator = null,
  quorumResolver = null
} = {}) {
  const pinnedLimits = plantLimits && typeof plantLimits === 'object' ? plantLimits : IMMUTABLE_PLANT_LIMITS;
  const stateCheck = validateAuthoritativeCurrentState(currentState);
  if (!stateCheck.valid) {
    const invalidStateEval = {
      status: 'refused',
      code: stateCheck.code,
      field: stateCheck.field,
      reason: stateCheck.reason
    };
    const safeStateObj = currentState && typeof currentState === 'object' && !Array.isArray(currentState)
      ? currentState
      : {};
    const refusalReceipt = generateKinematicProposalReceipt({
      step,
      previousHash,
      currentState: safeStateObj,
      proposal: proposal && typeof proposal === 'object' ? proposal : {},
      evaluation: invalidStateEval,
      correctionAttempt: 0,
      plantLimits: pinnedLimits,
      timestamp
    });
    return {
      status: 'refused',
      verdict: 'refused',
      code: invalidStateEval.code,
      reason: invalidStateEval.reason,
      currentState: safeStateObj,
      plantLimits: pinnedLimits,
      limitTamper: null,
      stateTamper: null,
      limitsInflated: false,
      proposal: null,
      evaluation: invalidStateEval,
      initialEvaluation: invalidStateEval,
      finalEvaluation: invalidStateEval,
      initialAccepted: false,
      unsafeAcceptedCount: 0,
      correctionAttempts: 0,
      maxBoundedCorrections: MAX_BOUNDED_CORRECTIONS,
      recoveredByBoundedCorrection: false,
      boundedCorrection: null,
      receipt: refusalReceipt,
      receipts: [refusalReceipt]
    };
  }

  const authoritativeState = stateCheck.state;
  const {
    enforcedProposal,
    limitTamper,
    limitsInflated,
    invalidLimitField,
    stateTamper
  } = enforceImmutablePlantLimits(proposal, pinnedLimits, authoritativeState);

  if (!enforcedProposal) {
    const invalidEval = {
      status: 'refused',
      code: 'INVALID_PROPOSAL_SHAPE',
      reason: 'Proposal must be a valid object'
    };
    const refusalReceipt = generateKinematicProposalReceipt({
      step,
      previousHash,
      currentState: authoritativeState,
      proposal: {},
      evaluation: invalidEval,
      correctionAttempt: 0,
      plantLimits: pinnedLimits,
      timestamp
    });
    return {
      status: 'refused',
      verdict: 'refused',
      code: invalidEval.code,
      reason: invalidEval.reason,
      currentState: authoritativeState,
      plantLimits: pinnedLimits,
      limitTamper: null,
      stateTamper: null,
      limitsInflated: false,
      proposal: null,
      evaluation: invalidEval,
      initialEvaluation: invalidEval,
      finalEvaluation: invalidEval,
      initialAccepted: false,
      unsafeAcceptedCount: 0,
      correctionAttempts: 0,
      maxBoundedCorrections: MAX_BOUNDED_CORRECTIONS,
      recoveredByBoundedCorrection: false,
      boundedCorrection: null,
      receipt: refusalReceipt,
      receipts: [refusalReceipt]
    };
  }

  const physicsOnAuthoritative = evaluatePhysicsProposal(enforcedProposal);
  let initialEvaluation;
  if (invalidLimitField) {
    initialEvaluation = {
      status: 'refused',
      code: invalidLimitField.code,
      field: invalidLimitField.field,
      reason: invalidLimitField.reason
    };
  } else if ((strictLimitTamper || proposal?.forgedLimits === true) && limitTamper) {
    initialEvaluation = {
      status: 'refused',
      code: 'LIMIT_TAMPER',
      field: limitTamper.field,
      reason: `Untrusted proposal attempted to override immutable plant limit ${limitTamper.field} (${limitTamper.proposed} !== ${limitTamper.pinned})`
    };
  } else if (stateTamper) {
    initialEvaluation = {
      status: 'refused',
      code: physicsOnAuthoritative.status === 'refused' ? physicsOnAuthoritative.code : 'STATE_SNAPSHOT_MISMATCH',
      field: stateTamper.field,
      stateTamper,
      state: physicsOnAuthoritative.state || null,
      reason: physicsOnAuthoritative.status === 'refused'
        ? `${physicsOnAuthoritative.reason} (evaluated against authoritative currentState after rejecting proposal state mismatch on ${stateTamper.field}: ${stateTamper.proposed} !== ${stateTamper.authoritative})`
        : `Untrusted proposal attempted to alter authoritative currentState.${stateTamper.field} (${stateTamper.proposed} !== ${stateTamper.authoritative})`
    };
  } else {
    initialEvaluation = physicsOnAuthoritative;
  }

  const proposalForSwarm = (strictLimitTamper || proposal?.forgedLimits === true) && limitTamper
    ? { ...enforcedProposal, ...proposal }
    : enforcedProposal;

  const rawCriticVote = typeof criticEvaluator === 'function'
    ? criticEvaluator(proposalForSwarm, { strictManifest: Boolean(strictLimitTamper) }, pinnedLimits)
    : {
        role: 'kinematic_critic',
        vote: initialEvaluation.status === 'accepted' ? 'APPROVE' : 'OBJECT',
        code: initialEvaluation.status === 'accepted' ? null : initialEvaluation.code,
        reason: initialEvaluation.reason || 'Kinematic critic evaluation',
        metrics: initialEvaluation.state || initialEvaluation.metrics || null,
        limitsSource: 'manifest'
      };

  const criticVote = initialEvaluation.status !== 'accepted' && rawCriticVote.vote === 'APPROVE'
    ? {
        ...rawCriticVote,
        vote: 'OBJECT',
        code: initialEvaluation.code,
        reason: initialEvaluation.reason
      }
    : rawCriticVote;

  const rawInterlockVote = typeof interlockEvaluator === 'function'
    ? interlockEvaluator(proposalForSwarm, { strictManifest: Boolean(strictLimitTamper) }, pinnedLimits)
    : {
        role: 'safety_interlock',
        vote: initialEvaluation.status === 'accepted' ? 'APPROVE' : 'INTERLOCK_HALT',
        contractStatus: initialEvaluation.status === 'accepted' ? 'accepted' : 'refused',
        code: initialEvaluation.status === 'accepted' ? null : initialEvaluation.code,
        reason: initialEvaluation.reason || 'Safety interlock contract evaluation',
        state: initialEvaluation.state || null
      };

  const interlockVote = initialEvaluation.status !== 'accepted' && rawInterlockVote.vote === 'APPROVE'
    ? {
        ...rawInterlockVote,
        vote: 'INTERLOCK_HALT',
        contractStatus: 'refused',
        code: initialEvaluation.code,
        reason: initialEvaluation.reason
      }
    : rawInterlockVote;

  const quorumDecision = typeof quorumResolver === 'function'
    ? quorumResolver({ plannerProposal: proposalForSwarm, criticVote, interlockVote })
    : {
        status: initialEvaluation.status === 'accepted' && criticVote.vote === 'APPROVE' && interlockVote.vote === 'APPROVE'
          ? 'ACCEPTED'
          : 'REFUSED',
        refusalCode: initialEvaluation.status === 'accepted' ? null : initialEvaluation.code,
        reason: initialEvaluation.status === 'accepted'
          ? 'Unanimous quorum approval across all roles'
          : (initialEvaluation.reason || interlockVote.reason || criticVote.reason)
      };

  const initialReceipt = generateKinematicProposalReceipt({
    step,
    previousHash,
    currentState: authoritativeState,
    proposal: enforcedProposal,
    evaluation: initialEvaluation,
    criticVote,
    interlockVote,
    quorumDecision,
    correctionAttempt: 0,
    plantLimits: pinnedLimits,
    timestamp
  });

  if (initialEvaluation.status === 'accepted' && quorumDecision.status === 'ACCEPTED') {
    return {
      status: 'ok',
      verdict: 'accepted',
      code: null,
      reason: quorumDecision.reason,
      currentState: authoritativeState,
      plantLimits: pinnedLimits,
      limitTamper,
      stateTamper,
      limitsInflated,
      proposal: enforcedProposal,
      rawProposal: proposal,
      evaluation: initialEvaluation,
      initialEvaluation,
      finalEvaluation: initialEvaluation,
      criticVote,
      interlockVote,
      quorumDecision,
      initialAccepted: true,
      unsafeAcceptedCount: 0,
      correctionAttempts: 0,
      maxBoundedCorrections: MAX_BOUNDED_CORRECTIONS,
      recoveredByBoundedCorrection: false,
      boundedCorrection: null,
      receipt: initialReceipt,
      receipts: [initialReceipt]
    };
  }

  // Initial proposal was refused: never count it as accepted.
  // State snapshot tampering (model falsifying currentState) or disabled bounded correction halts immediately.
  if (!allowBoundedCorrection || stateTamper || invalidLimitField) {
    return {
      status: 'refused',
      verdict: 'refused',
      code: initialEvaluation.code || quorumDecision.refusalCode,
      reason: initialEvaluation.reason || quorumDecision.reason,
      currentState: authoritativeState,
      plantLimits: pinnedLimits,
      limitTamper,
      stateTamper,
      limitsInflated,
      proposal: enforcedProposal,
      rawProposal: proposal,
      evaluation: initialEvaluation,
      initialEvaluation,
      finalEvaluation: initialEvaluation,
      criticVote,
      interlockVote,
      quorumDecision,
      initialAccepted: false,
      unsafeAcceptedCount: 0,
      correctionAttempts: 0,
      maxBoundedCorrections: MAX_BOUNDED_CORRECTIONS,
      recoveredByBoundedCorrection: false,
      boundedCorrection: null,
      receipt: initialReceipt,
      receipts: [initialReceipt]
    };
  }

  // Execute at most ONE bounded correction step (MAX_BOUNDED_CORRECTIONS = 1)
  const correctedProposal = applyBoundedStepCorrection(
    enforcedProposal,
    initialEvaluation,
    pinnedLimits,
    correctionOverride
  );
  const correctedEvaluation = evaluatePhysicsProposal(correctedProposal);

  const correctedCriticVote = typeof criticEvaluator === 'function'
    ? criticEvaluator(correctedProposal, { strictManifest: true }, pinnedLimits)
    : {
        role: 'kinematic_critic',
        vote: correctedEvaluation.status === 'accepted' ? 'APPROVE' : 'OBJECT',
        code: correctedEvaluation.status === 'accepted' ? null : correctedEvaluation.code,
        reason: correctedEvaluation.reason || 'Kinematic critic evaluation on bounded correction',
        metrics: correctedEvaluation.state || correctedEvaluation.metrics || null,
        limitsSource: 'manifest'
      };

  const correctedInterlockVote = typeof interlockEvaluator === 'function'
    ? interlockEvaluator(correctedProposal, { strictManifest: true }, pinnedLimits)
    : {
        role: 'safety_interlock',
        vote: correctedEvaluation.status === 'accepted' ? 'APPROVE' : 'INTERLOCK_HALT',
        contractStatus: correctedEvaluation.status === 'accepted' ? 'accepted' : 'refused',
        code: correctedEvaluation.status === 'accepted' ? null : correctedEvaluation.code,
        reason: correctedEvaluation.reason || 'Safety interlock evaluation on bounded correction',
        state: correctedEvaluation.state || null
      };

  const correctedQuorum = typeof quorumResolver === 'function'
    ? quorumResolver({
        plannerProposal: correctedProposal,
        criticVote: correctedCriticVote,
        interlockVote: correctedInterlockVote
      })
    : {
        status: correctedEvaluation.status === 'accepted' &&
          correctedCriticVote.vote === 'APPROVE' &&
          correctedInterlockVote.vote === 'APPROVE'
          ? 'ACCEPTED'
          : 'REFUSED',
        refusalCode: correctedEvaluation.status === 'accepted' ? null : correctedEvaluation.code,
        reason: correctedEvaluation.status === 'accepted'
          ? 'Bounded 1-step correction approved by unanimous quorum'
          : (correctedEvaluation.reason || correctedInterlockVote.reason)
      };

  const correctionReceipt = generateKinematicProposalReceipt({
    step,
    previousHash: initialReceipt.receiptHash,
    currentState: authoritativeState,
    proposal: correctedProposal,
    evaluation: correctedEvaluation,
    criticVote: correctedCriticVote,
    interlockVote: correctedInterlockVote,
    quorumDecision: correctedQuorum,
    correctionAttempt: 1,
    parentRefusalCode: initialReceipt.code,
    parentRefusalReason: initialReceipt.reason,
    plantLimits: pinnedLimits,
    timestamp
  });

  const recovered = correctedEvaluation.status === 'accepted' && correctedQuorum.status === 'ACCEPTED';
  const boundedCorrection = {
    attempt: 1,
    maxAttempts: MAX_BOUNDED_CORRECTIONS,
    parentRefusalCode: initialReceipt.code,
    parentRefusalReason: initialReceipt.reason,
    correctedProposal,
    evaluation: correctedEvaluation,
    criticVote: correctedCriticVote,
    interlockVote: correctedInterlockVote,
    quorumDecision: correctedQuorum,
    receipt: correctionReceipt
  };

  return {
    status: recovered ? 'ok' : 'refused',
    verdict: recovered ? 'corrected_after_refusal' : 'refused',
    code: initialReceipt.code,
    reason: initialReceipt.reason,
    currentState: authoritativeState,
    plantLimits: pinnedLimits,
    limitTamper,
    stateTamper,
    limitsInflated,
    proposal: enforcedProposal,
    rawProposal: proposal,
    correctedProposal: recovered ? correctedProposal : null,
    evaluation: initialEvaluation,
    initialEvaluation,
    finalEvaluation: correctedEvaluation,
    criticVote,
    interlockVote,
    quorumDecision,
    initialAccepted: false,
    unsafeAcceptedCount: 0,
    correctionAttempts: 1,
    maxBoundedCorrections: MAX_BOUNDED_CORRECTIONS,
    recoveredByBoundedCorrection: recovered,
    boundedCorrection,
    receipt: correctionReceipt,
    receipts: [initialReceipt, correctionReceipt]
  };
}

/**
 * Requests a physical parameter proposal from Meta Model API (Muse Spark 1.3 / Muse Wonder 1.0).
 * If offlineFixture is specified, replays offline without network access.
 * Otherwise, enforces Pre-Rules Release Gate and a bounded AbortController deadline (timeoutMs)
 * before issuing a single-attempt outbound request.
 */
export async function requestLlamaPhysicsProposal({
  instruction = 'Plan deceleration maneuver',
  currentState = {},
  model = DEFAULT_LLAMA_MODEL,
  env = {},
  rulesVerified = false,
  keyLoader = null,
  fetchImpl = globalThis.fetch,
  offlineFixture = null,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
} = {}) {
  // 0. Validate model against official Meta Model API allowlist
  if (typeof model !== 'string' || !CONFIGURABLE_LLAMA_MODELS.includes(model)) {
    return {
      status: 'refused',
      code: 'UNSUPPORTED_META_MODEL',
      model,
      reason: `Model ${String(model)} is not in CONFIGURABLE_LLAMA_MODELS (${CONFIGURABLE_LLAMA_MODELS.join(', ')})`
    };
  }

  // 1. Offline Fixture Replay
  if (offlineFixture) {
    if (typeof offlineFixture === 'string' && OFFLINE_LLAMA_FIXTURES[offlineFixture]) {
      const fixtureProposal = OFFLINE_LLAMA_FIXTURES[offlineFixture].proposal;
      return {
        status: 'ok',
        source: `offline_fixture:${offlineFixture}`,
        fixtureMode: 'MOCK_OFFLINE_FIXTURE',
        model,
        proposal: fixtureProposal
      };
    }
    if (typeof offlineFixture === 'object' && offlineFixture.proposal) {
      const extracted = extractPhysicsProposal(offlineFixture.proposal);
      if (extracted.status === 'refused') {
        return extracted;
      }
      return {
        status: 'ok',
        source: 'offline_fixture',
        fixtureMode: 'MOCK_OFFLINE_FIXTURE',
        model,
        proposal: extracted
      };
    }
    const extracted = extractPhysicsProposal(offlineFixture);
    if (extracted.status === 'refused') {
      return extracted;
    }
    return {
      status: 'ok',
      source: 'offline_fixture',
      fixtureMode: 'MOCK_OFFLINE_FIXTURE',
      model,
      proposal: extracted
    };
  }

  // 2. Pre-Rules Release Gate & Dedicated Keyfile Loader Enforcement
  const gate = checkMetaRulesGate(env, { rulesVerified, keyLoader });
  if (!gate.allowed) {
    return gate.refusal;
  }

  if (typeof fetchImpl !== 'function') {
    return {
      status: 'refused',
      code: 'NETWORK_ERROR',
      reason: 'No valid fetch implementation available for Meta Model API dispatch'
    };
  }

  const effectiveTimeoutMs = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_REQUEST_TIMEOUT_MS;

  // 3. Construct Meta Model API Request Payload (max_completion_tokens + json_schema)
  const promptData = buildLlamaPhysicsPrompt({ instruction, currentState });
  const payload = {
    model,
    messages: promptData.messages,
    temperature: 0.1,
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    response_format: {
      type: 'json_schema',
      json_schema: PROPOSAL_SCHEMA
    }
  };

  const requestBodyStr = JSON.stringify(payload);
  const requestSha256 = sha256Sync(canonicalStringify(payload));
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timerId = null;

  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      if (controller) {
        try {
          controller.abort(new Error(`Meta Model API request timed out after ${effectiveTimeoutMs}ms`));
        } catch {
          // ignore abort errors
        }
      }
      const timeoutErr = new Error(`Meta Model API request timed out after ${effectiveTimeoutMs}ms`);
      timeoutErr.code = 'REQUEST_TIMEOUT';
      reject(timeoutErr);
    }, effectiveTimeoutMs);
  });

  try {
    const response = await Promise.race([
      fetchImpl(META_LLAMA_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${gate.apiKey}`
        },
        body: requestBodyStr,
        ...(controller ? { signal: controller.signal } : {})
      }),
      timeoutPromise
    ]);

    if (!response || typeof response.ok !== 'boolean') {
      return {
        status: 'refused',
        code: 'NETWORK_ERROR',
        reason: 'Meta Model API returned an invalid HTTP response object'
      };
    }

    if (!response.ok) {
      return {
        status: 'refused',
        code: 'META_API_ERROR',
        httpStatus: response.status,
        reason: `Meta Model API responded with HTTP ${response.status}`
      };
    }

    let data;
    try {
      data = await Promise.race([response.json(), timeoutPromise]);
    } catch (jsonErr) {
      if (jsonErr && (jsonErr.code === 'REQUEST_TIMEOUT' || jsonErr.name === 'AbortError')) {
        throw jsonErr;
      }
      return {
        status: 'refused',
        code: 'INVALID_PROPOSAL_SHAPE',
        reason: 'Malformed JSON body in HTTP 200 response from Meta Model API: ' + (jsonErr?.message || String(jsonErr))
      };
    }

    const responseSha256 = sha256Sync(canonicalStringify(data || {}));
    const callProof = {
      fixtureMode: 'LIVE_META_API',
      authSource: 'dedicated_keyfile_loader',
      keyState: 'ready',
      endpoint: META_LLAMA_ENDPOINT,
      requestedModel: model,
      actualModel: typeof data?.model === 'string' ? data.model : model,
      providerResponseId: typeof data?.id === 'string' ? data.id : null,
      requestSha256,
      responseSha256,
      usage: data?.usage || null,
      timestamp: new Date().toISOString()
    };

    const messageObj = data?.choices?.[0]?.message;

    if (typeof messageObj?.refusal === 'string' && messageObj.refusal.trim()) {
      return {
        status: 'refused',
        code: 'MODEL_REFUSAL',
        reason: messageObj.refusal.trim(),
        callProof
      };
    }

    const content = messageObj?.content;
    const proposal = extractPhysicsProposal(content);

    if (proposal.status === 'refused') {
      return {
        ...proposal,
        callProof
      };
    }

    return {
      status: 'ok',
      source: `remote_llama:${model}`,
      fixtureMode: 'LIVE_META_API',
      model,
      proposal,
      callProof
    };
  } catch (err) {
    const isTimeout = Boolean(
      err && (err.code === 'REQUEST_TIMEOUT' || err.name === 'AbortError' || String(err.message).includes('timed out'))
    );
    return {
      status: 'refused',
      code: 'NETWORK_ERROR',
      ...(isTimeout ? { timeoutCode: 'REQUEST_TIMEOUT', timedOut: true } : {}),
      reason: isTimeout
        ? `Meta Model API request aborted after ${effectiveTimeoutMs}ms deadline: ${err.message}`
        : 'Failed to communicate with Meta Model API endpoint: ' + (err?.message || String(err))
    };
  } finally {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
  }
}



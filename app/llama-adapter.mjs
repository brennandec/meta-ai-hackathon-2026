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
  'stopDistanceM'
]);

export const MUTABLE_CONTROL_FIELDS = Object.freeze([
  'id',
  'title',
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
export function extractPhysicsProposal(content, options = {}) {
  if (!content) {
    return {
      status: 'refused',
      code: 'INVALID_PROPOSAL_SHAPE',
      reason: 'Empty response content'
    };
  }

  const knownSecret = typeof options?.knownSecret === 'string' && options.knownSecret.length > 0
    ? options.knownSecret
    : null;

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
            reason: 'Failed to parse JSON proposal from response text (JSON_PARSE_ERROR)'
          };
        }
      } else {
        return {
          status: 'refused',
          code: 'INVALID_PROPOSAL_SHAPE',
          reason: 'Failed to parse JSON proposal from response text (JSON_PARSE_ERROR)'
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

  // G2 & F3: Preserve refusal reason when given a refusal-shaped object; fail closed on malformed non-null/non-string refusal
  const hasStringRefusal = typeof raw.refusal === 'string' && raw.refusal.trim().length > 0;
  const hasMalformedNonStringRefusal = raw.refusal !== undefined && raw.refusal !== null && typeof raw.refusal !== 'string';
  if (raw.status === 'refused' || hasStringRefusal || hasMalformedNonStringRefusal) {
    let refusalReason = 'Model refused to generate physics proposal';
    if (typeof raw.reason === 'string' && raw.reason.trim()) {
      refusalReason = raw.reason.trim();
    } else if (hasStringRefusal) {
      refusalReason = raw.refusal.trim();
    } else if (
      hasMalformedNonStringRefusal &&
      typeof raw.refusal === 'object' &&
      !Array.isArray(raw.refusal) &&
      typeof raw.refusal.message === 'string' &&
      raw.refusal.message.trim()
    ) {
      refusalReason = raw.refusal.message.trim();
    }
    if (knownSecret && refusalReason.includes(knownSecret)) {
      refusalReason = 'Model refused request (refusal text redacted)';
    } else {
      refusalReason = refusalReason.slice(0, 256);
    }
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

  // F4: Check raw decoded id and title BEFORE trimming/truncation so a credential suffix
  // crossing the 64/128-character boundary cannot leak a partial credential prefix.
  if (
    knownSecret &&
    (raw.id.includes(knownSecret) || raw.title.includes(knownSecret))
  ) {
    return {
      status: 'refused',
      code: 'INVALID_PROPOSAL_SHAPE',
      reason: 'Proposal metadata contains forbidden credential echo'
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
 * Extracts the distinctly typed mutable control proposal from a 9-parameter kinematic proposal.
 * Only control parameters (id, title, thrustN) are mutable; observed state (massKg, velocityMps, stopDistanceM)
 * and plant limits (frictionMu, maxSafeBrakeForceN, structuralLimitN) are immutable server-owned inputs.
 */
export function extractMutableControlProposal(proposal) {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
    return null;
  }
  return Object.freeze({
    type: 'mutable_control_proposal',
    id: typeof proposal.id === 'string' && proposal.id ? proposal.id.slice(0, 64) : 'llama-proposal',
    title: typeof proposal.title === 'string' && proposal.title ? proposal.title.slice(0, 128) : 'Physical Deceleration Proposal',
    thrustN: proposal.thrustN
  });
}

/**
 * Enforces immutable server-owned plant limits AND authoritative currentState snapshot
 * on an untrusted proposal (G3).
 * Detects any attempt to alter or inflate frictionMu, maxSafeBrakeForceN, or structuralLimitN,
 * or to falsify currentState's immutable observed massKg, velocityMps, or stopDistanceM.
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
      controlProposal: null,
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
        if (
          Object.hasOwn(proposal, field) &&
          proposedVal !== undefined &&
          typeof proposedVal === 'number' &&
          Number.isFinite(proposedVal) &&
          !Object.is(proposedVal, authoritativeVal)
        ) {
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

  const controlProposal = extractMutableControlProposal(proposal);

  const enforcedProposal = {
    id: controlProposal.id,
    title: controlProposal.title,
    massKg: resolveStateField('massKg'),
    velocityMps: resolveStateField('velocityMps'),
    stopDistanceM: resolveStateField('stopDistanceM'),
    frictionMu: invalidLimitField?.field === 'frictionMu' ? proposal.frictionMu : pinned.frictionMu,
    maxSafeBrakeForceN: invalidLimitField?.field === 'maxSafeBrakeForceN' ? proposal.maxSafeBrakeForceN : pinned.maxSafeBrakeForceN,
    thrustN: controlProposal.thrustN,
    structuralLimitN: invalidLimitField?.field === 'structuralLimitN' ? proposal.structuralLimitN : pinned.structuralLimitN
  };

  return {
    enforcedProposal,
    controlProposal,
    limitTamper,
    limitsInflated: inflatedFields.length > 0,
    invalidLimitField,
    stateTamper
  };
}

/**
 * Deterministic 1-step bounded safe control correction (G2).
 * Given a refused proposal and the authoritative currentState snapshot, synthesizes at most ONE
 * bounded control correction that adjusts ONLY mutable control actuation (thrustN = 0.0)
 * while keeping observed massKg, velocityMps, and stopDistanceM strictly equal to the authoritative snapshot.
 * Never solves an impossible stop by altering observed massKg, velocityMps, or stopDistanceM.
 */
export function applyBoundedStepCorrection(
  proposal,
  refusalEvaluation,
  plantLimits = IMMUTABLE_PLANT_LIMITS,
  correctionOverride = null,
  currentState = null
) {
  const pinned = plantLimits && typeof plantLimits === 'object' ? plantLimits : IMMUTABLE_PLANT_LIMITS;
  const snapshot = currentState && typeof currentState === 'object' && !Array.isArray(currentState)
    ? currentState
    : proposal;

  if (correctionOverride && typeof correctionOverride === 'object') {
    const { enforcedProposal } = enforceImmutablePlantLimits(correctionOverride, pinned, snapshot);
    return enforcedProposal;
  }

  if (!proposal || typeof proposal !== 'object') {
    return null;
  }

  const observedMassKg = snapshot && typeof snapshot.massKg === 'number' && Number.isFinite(snapshot.massKg)
    ? snapshot.massKg
    : proposal.massKg;
  const observedVelocityMps = snapshot && typeof snapshot.velocityMps === 'number' && Number.isFinite(snapshot.velocityMps)
    ? snapshot.velocityMps
    : proposal.velocityMps;
  const observedStopDistanceM = snapshot && typeof snapshot.stopDistanceM === 'number' && Number.isFinite(snapshot.stopDistanceM)
    ? snapshot.stopDistanceM
    : proposal.stopDistanceM;

  return {
    id: `${proposal.id || 'llama-proposal'}-bounded-correction-1`.slice(0, 64),
    title: `${proposal.title || 'Proposal'} (Bounded 1-Step Safe Control Correction)`.slice(0, 128),
    massKg: observedMassKg,
    velocityMps: observedVelocityMps,
    stopDistanceM: observedStopDistanceM,
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
 * Includes only immutable observed physical state fields (massKg, velocityMps, stopDistanceM).
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
    stopDistanceM: typeof src?.stopDistanceM === 'number' && Number.isFinite(src.stopDistanceM) && src.stopDistanceM > 0 ? src.stopDistanceM : 2.0
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
      controlProposal: null,
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
    controlProposal,
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
      controlProposal: null,
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

  const effectiveSnapshot = {
    ...authoritativeState,
    ...(typeof authoritativeState.massKg === 'number' && Number.isFinite(authoritativeState.massKg)
      ? {}
      : (typeof enforcedProposal.massKg === 'number' && Number.isFinite(enforcedProposal.massKg) ? { massKg: enforcedProposal.massKg } : {})),
    ...(typeof authoritativeState.velocityMps === 'number' && Number.isFinite(authoritativeState.velocityMps)
      ? {}
      : (typeof enforcedProposal.velocityMps === 'number' && Number.isFinite(enforcedProposal.velocityMps) ? { velocityMps: enforcedProposal.velocityMps } : {})),
    ...(typeof authoritativeState.stopDistanceM === 'number' && Number.isFinite(authoritativeState.stopDistanceM)
      ? {}
      : (typeof enforcedProposal.stopDistanceM === 'number' && Number.isFinite(enforcedProposal.stopDistanceM) ? { stopDistanceM: enforcedProposal.stopDistanceM } : {}))
  };

  const physicsOnAuthoritative = evaluatePhysicsProposal(effectiveSnapshot, enforcedProposal);
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
      controlProposal,
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
      controlProposal,
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
  // Both automatic bounded control correction and caller correctionOverride are evaluated
  // against the SAME immutable observed effectiveSnapshot (massKg, velocityMps, stopDistanceM).
  const rawCorrectionCandidate = correctionOverride && typeof correctionOverride === 'object'
    ? correctionOverride
    : applyBoundedStepCorrection(
        enforcedProposal,
        initialEvaluation,
        pinnedLimits,
        null,
        effectiveSnapshot
      );

  const correctionEnforcement = enforceImmutablePlantLimits(
    rawCorrectionCandidate,
    pinnedLimits,
    effectiveSnapshot
  );
  const correctedProposal = correctionEnforcement.enforcedProposal;
  const correctedControlProposal = correctionEnforcement.controlProposal;
  const correctionStateTamper = correctionEnforcement.stateTamper;
  const correctionLimitTamper = correctionEnforcement.limitTamper;
  const correctionInvalidLimit = correctionEnforcement.invalidLimitField;

  const correctedPhysicsEval = evaluatePhysicsProposal(effectiveSnapshot, correctedProposal);
  let correctedEvaluation;
  if (correctionInvalidLimit) {
    correctedEvaluation = {
      status: 'refused',
      code: correctionInvalidLimit.code,
      field: correctionInvalidLimit.field,
      reason: correctionInvalidLimit.reason
    };
  } else if (correctionStateTamper) {
    correctedEvaluation = {
      status: 'refused',
      code: 'STATE_SNAPSHOT_MISMATCH',
      field: correctionStateTamper.field,
      stateTamper: correctionStateTamper,
      state: correctedPhysicsEval.state || null,
      reason: `Bounded correction attempted to alter authoritative currentState.${correctionStateTamper.field} (${correctionStateTamper.proposed} !== ${correctionStateTamper.authoritative})`
    };
  } else if ((strictLimitTamper || rawCorrectionCandidate?.forgedLimits === true) && correctionLimitTamper) {
    correctedEvaluation = {
      status: 'refused',
      code: 'LIMIT_TAMPER',
      field: correctionLimitTamper.field,
      reason: `Bounded correction attempted to override immutable plant limit ${correctionLimitTamper.field} (${correctionLimitTamper.proposed} !== ${correctionLimitTamper.pinned})`
    };
  } else {
    correctedEvaluation = correctedPhysicsEval;
  }

  const rawCorrectedCriticVote = typeof criticEvaluator === 'function'
    ? criticEvaluator(correctedProposal, { strictManifest: true }, pinnedLimits)
    : {
        role: 'kinematic_critic',
        vote: correctedEvaluation.status === 'accepted' ? 'APPROVE' : 'OBJECT',
        code: correctedEvaluation.status === 'accepted' ? null : correctedEvaluation.code,
        reason: correctedEvaluation.reason || 'Kinematic critic evaluation on bounded correction',
        metrics: correctedEvaluation.state || correctedEvaluation.metrics || null,
        limitsSource: 'manifest'
      };

  const correctedCriticVote = correctedEvaluation.status !== 'accepted' && rawCorrectedCriticVote.vote === 'APPROVE'
    ? {
        ...rawCorrectedCriticVote,
        vote: 'OBJECT',
        code: correctedEvaluation.code,
        reason: correctedEvaluation.reason
      }
    : rawCorrectedCriticVote;

  const rawCorrectedInterlockVote = typeof interlockEvaluator === 'function'
    ? interlockEvaluator(correctedProposal, { strictManifest: true }, pinnedLimits)
    : {
        role: 'safety_interlock',
        vote: correctedEvaluation.status === 'accepted' ? 'APPROVE' : 'INTERLOCK_HALT',
        contractStatus: correctedEvaluation.status === 'accepted' ? 'accepted' : 'refused',
        code: correctedEvaluation.status === 'accepted' ? null : correctedEvaluation.code,
        reason: correctedEvaluation.reason || 'Safety interlock evaluation on bounded correction',
        state: correctedEvaluation.state || null
      };

  const correctedInterlockVote = correctedEvaluation.status !== 'accepted' && rawCorrectedInterlockVote.vote === 'APPROVE'
    ? {
        ...rawCorrectedInterlockVote,
        vote: 'INTERLOCK_HALT',
        contractStatus: 'refused',
        code: correctedEvaluation.code,
        reason: correctedEvaluation.reason
      }
    : rawCorrectedInterlockVote;

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
    controlProposal: correctedControlProposal,
    stateTamper: correctionStateTamper,
    evaluation: correctedEvaluation,
    criticVote: correctedCriticVote,
    interlockVote: correctedInterlockVote,
    quorumDecision: correctedQuorum,
    receipt: correctionReceipt
  };

  return {
    status: recovered ? 'ok' : 'refused',
    verdict: recovered ? 'corrected_after_refusal' : 'refused',
    code: recovered ? initialReceipt.code : (correctedEvaluation.code || initialReceipt.code),
    reason: recovered ? initialReceipt.reason : (correctedEvaluation.reason || initialReceipt.reason),
    currentState: authoritativeState,
    plantLimits: pinnedLimits,
    limitTamper,
    stateTamper: stateTamper || correctionStateTamper,
    limitsInflated,
    proposal: enforcedProposal,
    controlProposal,
    rawProposal: proposal,
    correctedProposal: recovered ? correctedProposal : null,
    correctedControlProposal: recovered ? correctedControlProposal : null,
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

export const ALLOWED_PROVIDER_USAGE_COUNTERS = Object.freeze([
  'prompt_tokens',
  'completion_tokens',
  'total_tokens'
]);

/**
 * Sanitizes provider token usage to an allowlist of documented finite non-negative
 * safe-integer counters (prompt_tokens, completion_tokens, total_tokens).
 * Rejects/omits unknown fields, nested objects/strings, negative/non-integer values,
 * and any credential echo.
 */
export function sanitizeProviderUsage(rawUsage, knownSecret = null) {
  if (!rawUsage || typeof rawUsage !== 'object' || Array.isArray(rawUsage)) {
    return null;
  }
  const proto = Object.getPrototypeOf(rawUsage);
  if (proto !== Object.prototype && proto !== null) {
    return null;
  }
  if (typeof knownSecret === 'string' && knownSecret.length > 0) {
    for (const [k, v] of Object.entries(rawUsage)) {
      if (k.includes(knownSecret) || (typeof v === 'string' && v.includes(knownSecret))) {
        if (!ALLOWED_PROVIDER_USAGE_COUNTERS.includes(k)) {
          continue;
        }
        return null;
      }
    }
  }
  const clean = {};
  let count = 0;
  for (const key of ALLOWED_PROVIDER_USAGE_COUNTERS) {
    if (Object.hasOwn(rawUsage, key) && rawUsage[key] !== undefined) {
      const val = rawUsage[key];
      if (
        typeof val !== 'number' ||
        !Number.isFinite(val) ||
        !Number.isSafeInteger(val) ||
        val < 0
      ) {
        return null;
      }
      clean[key] = val;
      count += 1;
    }
  }
  if (count === 0) {
    return null;
  }
  return Object.freeze(clean);
}

/**
 * Sanitizes a bounded provider trace identifier (request ID, response ID, model ID)
 * and strips any value containing the known credential or unsafe characters.
 */
export function sanitizeProviderTraceString(rawValue, knownSecret = null, maxLen = 128) {
  if (typeof rawValue !== 'string') {
    return null;
  }
  const trimmed = rawValue.trim();
  if (!trimmed || trimmed.length > maxLen) {
    return null;
  }
  if (typeof knownSecret === 'string' && knownSecret.length > 0 && trimmed.includes(knownSecret)) {
    return null;
  }
  if (!/^[A-Za-z0-9._:/-]+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Classifies transport/dispatch exceptions into safe typed error classifications
 * without echoing raw err.message or arbitrary exception strings.
 */
export function classifySafeTransportError(err, effectiveTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const isTimeout = Boolean(
    err && (
      err.code === 'REQUEST_TIMEOUT' ||
      err.name === 'AbortError' ||
      String(err?.message || '').toLowerCase().includes('timed out')
    )
  );
  if (isTimeout) {
    return Object.freeze({
      isTimeout: true,
      errorType: 'REQUEST_TIMEOUT',
      timeoutCode: 'REQUEST_TIMEOUT',
      reason: `Meta Model API request aborted after ${effectiveTimeoutMs}ms deadline (REQUEST_TIMEOUT)`
    });
  }
  if (err && err.code === 'EXTERNAL_CALLS_BLOCKED_BY_DEFAULT') {
    return Object.freeze({
      isTimeout: false,
      errorType: 'EXTERNAL_CALLS_BLOCKED_BY_DEFAULT',
      timeoutCode: null,
      reason: 'Failed to communicate with Meta Model API endpoint: external calls blocked by default (EXTERNAL_CALLS_BLOCKED_BY_DEFAULT)'
    });
  }
  return Object.freeze({
    isTimeout: false,
    errorType: 'TRANSPORT_DISPATCH_ERROR',
    timeoutCode: null,
    reason: 'Failed to communicate with Meta Model API endpoint (TRANSPORT_DISPATCH_ERROR)'
  });
}

function extractProviderRequestIdHeader(headers) {
  if (!headers) {
    return null;
  }
  const headerKeys = ['x-request-id', 'x-meta-request-id', 'request-id'];
  if (typeof headers.get === 'function') {
    for (const key of headerKeys) {
      const value = headers.get(key);
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
  } else if (typeof headers === 'object') {
    for (const [k, v] of Object.entries(headers)) {
      if (headerKeys.includes(String(k).toLowerCase()) && typeof v === 'string' && v.trim().length > 0) {
        return v.trim();
      }
    }
  }
  return null;
}

/**
 * Requests a physical parameter proposal from Meta Model API (Muse Spark 1.3 / Muse Wonder 1.0).
 * If offlineFixture is specified, replays offline without network access.
 * Otherwise, enforces Pre-Rules Release Gate and a bounded AbortController deadline (timeoutMs)
 * before issuing a single-attempt outbound request.
 *
 * Model identity & trace invariants:
 * - Preserves requestedModel separately from provider-reported actualModel.
 * - When provider data.model is missing/absent, actualModel is null and actualModelStatus is 'UNCONFIRMED'
 *   (never filled with requestedModel as proof). When requireConfirmedModelIdentity is true, missing
 *   actualModel is refused with UNCONFIRMED_ACTUAL_MODEL.
 * - When provider data.model is unknown (not in CONFIGURABLE_LLAMA_MODELS) or differs from requestedModel,
 *   marks actualModelStatus 'UNCONFIRMED_UNKNOWN_MODEL' / 'UNCONFIRMED_MODEL_MISMATCH' and refuses with
 *   UNCONFIRMED_ACTUAL_MODEL / ACTUAL_MODEL_MISMATCH.
 * - Sanitizes provider usage to documented finite non-negative safe-integer counters and replaces raw
 *   transport/parse exception text with safe typed classifications.
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
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  requireConfirmedModelIdentity = false
} = {}) {
  // 0. Validate model against official Meta Model API allowlist
  if (typeof model !== 'string' || !CONFIGURABLE_LLAMA_MODELS.includes(model)) {
    return {
      status: 'refused',
      code: 'UNSUPPORTED_META_MODEL',
      model,
      requestedModel: model,
      actualModel: null,
      actualModelStatus: 'UNCONFIRMED',
      modelIdentityConfirmed: false,
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
        requestedModel: model,
        actualModel: null,
        actualModelStatus: 'NOT_APPLICABLE_OFFLINE_FIXTURE',
        modelIdentityConfirmed: false,
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
        requestedModel: model,
        actualModel: null,
        actualModelStatus: 'NOT_APPLICABLE_OFFLINE_FIXTURE',
        modelIdentityConfirmed: false,
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
      requestedModel: model,
      actualModel: null,
      actualModelStatus: 'NOT_APPLICABLE_OFFLINE_FIXTURE',
      modelIdentityConfirmed: false,
      proposal: extracted
    };
  }

  // 2. Pre-Rules Release Gate & Dedicated Keyfile Loader Enforcement
  const gate = checkMetaRulesGate(env, { rulesVerified, keyLoader });
  if (!gate.allowed) {
    return {
      ...gate.refusal,
      requestedModel: model,
      actualModel: null,
      actualModelStatus: 'UNCONFIRMED',
      modelIdentityConfirmed: false
    };
  }

  if (typeof fetchImpl !== 'function') {
    return {
      status: 'refused',
      code: 'NETWORK_ERROR',
      requestedModel: model,
      actualModel: null,
      actualModelStatus: 'UNCONFIRMED',
      modelIdentityConfirmed: false,
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
  const attemptStartedAt = new Date().toISOString();
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
      const completedAt = new Date().toISOString();
      const invalidResponseCallProof = {
        fixtureMode: 'LIVE_META_API',
        authSource: 'dedicated_keyfile_loader',
        keyState: 'ready',
        endpoint: META_LLAMA_ENDPOINT,
        singleAttempt: true,
        attemptCount: 1,
        retriesPerformed: 0,
        httpStatus: null,
        requestedModel: model,
        actualModel: null,
        actualModelStatus: 'UNCONFIRMED',
        modelIdentityConfirmed: false,
        providerRequestId: null,
        providerResponseId: null,
        providerResponseIdStatus: 'UNCONFIRMED',
        requestSha256,
        responseSha256: null,
        usage: null,
        usageStatus: 'UNAVAILABLE',
        attemptStartedAt,
        timestamp: completedAt
      };
      return {
        status: 'refused',
        code: 'NETWORK_ERROR',
        requestedModel: model,
        actualModel: null,
        actualModelStatus: 'UNCONFIRMED',
        modelIdentityConfirmed: false,
        reason: 'Meta Model API returned an invalid HTTP response object',
        callProof: invalidResponseCallProof
      };
    }

    const headerRequestId = sanitizeProviderTraceString(
      extractProviderRequestIdHeader(response.headers),
      gate.apiKey,
      128
    );

    if (!response.ok) {
      let errData = null;
      if (typeof response.json === 'function') {
        try {
          errData = await Promise.race([response.json(), timeoutPromise]);
        } catch {
          errData = null;
        }
      }
      const errResponseId = sanitizeProviderTraceString(errData?.id, gate.apiKey, 128);
      const errActualModel = sanitizeProviderTraceString(errData?.model, gate.apiKey, 64);
      const errUsage = sanitizeProviderUsage(errData?.usage, gate.apiKey);
      const completedAt = new Date().toISOString();
      const httpErrorCallProof = {
        fixtureMode: 'LIVE_META_API',
        authSource: 'dedicated_keyfile_loader',
        keyState: 'ready',
        endpoint: META_LLAMA_ENDPOINT,
        singleAttempt: true,
        attemptCount: 1,
        retriesPerformed: 0,
        httpStatus: response.status,
        requestedModel: model,
        actualModel: errActualModel,
        actualModelStatus: 'UNCONFIRMED',
        modelIdentityConfirmed: false,
        providerRequestId: headerRequestId || errResponseId || null,
        providerResponseId: errResponseId,
        providerResponseIdStatus: errResponseId ? 'CONFIRMED' : 'UNCONFIRMED',
        requestSha256,
        responseSha256: errData && typeof errData === 'object' ? sha256Sync(canonicalStringify(errData)) : null,
        usage: errUsage,
        usageStatus: errUsage ? 'PROVIDER_REPORTED' : 'UNAVAILABLE',
        attemptStartedAt,
        timestamp: completedAt
      };
      return {
        status: 'refused',
        code: 'META_API_ERROR',
        httpStatus: response.status,
        requestedModel: model,
        actualModel: errActualModel,
        actualModelStatus: 'UNCONFIRMED',
        modelIdentityConfirmed: false,
        reason: `Meta Model API responded with HTTP ${response.status}`,
        callProof: httpErrorCallProof
      };
    }

    let data;
    try {
      data = await Promise.race([response.json(), timeoutPromise]);
    } catch (jsonErr) {
      if (jsonErr && (jsonErr.code === 'REQUEST_TIMEOUT' || jsonErr.name === 'AbortError')) {
        throw jsonErr;
      }
      const completedAt = new Date().toISOString();
      const parseErrorCallProof = {
        fixtureMode: 'LIVE_META_API',
        authSource: 'dedicated_keyfile_loader',
        keyState: 'ready',
        endpoint: META_LLAMA_ENDPOINT,
        singleAttempt: true,
        attemptCount: 1,
        retriesPerformed: 0,
        httpStatus: response.status,
        requestedModel: model,
        actualModel: null,
        actualModelStatus: 'UNCONFIRMED',
        modelIdentityConfirmed: false,
        providerRequestId: headerRequestId,
        providerResponseId: null,
        providerResponseIdStatus: 'UNCONFIRMED',
        requestSha256,
        responseSha256: null,
        usage: null,
        usageStatus: 'UNAVAILABLE',
        errorType: 'JSON_PARSE_ERROR',
        attemptStartedAt,
        timestamp: completedAt
      };
      return {
        status: 'refused',
        code: 'INVALID_PROPOSAL_SHAPE',
        errorType: 'JSON_PARSE_ERROR',
        requestedModel: model,
        actualModel: null,
        actualModelStatus: 'UNCONFIRMED',
        modelIdentityConfirmed: false,
        reason: 'Malformed JSON body in HTTP 200 response from Meta Model API (JSON_PARSE_ERROR)',
        callProof: parseErrorCallProof
      };
    }

    const responseSha256 = sha256Sync(canonicalStringify(data || {}));
    const providerResponseId = sanitizeProviderTraceString(data?.id, gate.apiKey, 128);
    const providerRequestId = headerRequestId || providerResponseId || null;
    const hasRawModelString = typeof data?.model === 'string' && data.model.trim().length > 0;
    const sanitizedReportedModel = sanitizeProviderTraceString(data?.model, gate.apiKey, 64);

    // Never fall back actualModel to requestedModel when data.model is missing, and never echo credentials in actualModel
    const actualModel = hasRawModelString
      ? (sanitizedReportedModel || '[REDACTED_UNCONFIRMED_MODEL]')
      : null;
    const isKnownAllowedActual = actualModel !== null && CONFIGURABLE_LLAMA_MODELS.includes(actualModel);
    const isMatchingActual = isKnownAllowedActual && actualModel === model;
    const actualModelStatus = actualModel === null
      ? 'UNCONFIRMED'
      : (!isKnownAllowedActual
        ? 'UNCONFIRMED_UNKNOWN_MODEL'
        : (!isMatchingActual ? 'UNCONFIRMED_MODEL_MISMATCH' : 'CONFIRMED'));
    const modelIdentityConfirmed = isMatchingActual;
    const usage = sanitizeProviderUsage(data?.usage, gate.apiKey);
    const usageStatus = usage ? 'PROVIDER_REPORTED' : 'UNAVAILABLE';
    const completedAt = new Date().toISOString();

    const callProof = {
      fixtureMode: 'LIVE_META_API',
      authSource: 'dedicated_keyfile_loader',
      keyState: 'ready',
      endpoint: META_LLAMA_ENDPOINT,
      singleAttempt: true,
      attemptCount: 1,
      retriesPerformed: 0,
      httpStatus: response.status,
      requestedModel: model,
      actualModel,
      actualModelStatus,
      modelIdentityConfirmed,
      providerRequestId,
      providerResponseId,
      providerResponseIdStatus: providerResponseId ? 'CONFIRMED' : 'UNCONFIRMED',
      requestSha256,
      responseSha256,
      usage,
      usageStatus,
      attemptStartedAt,
      timestamp: completedAt
    };

    if (actualModel !== null && !isKnownAllowedActual) {
      return {
        status: 'refused',
        code: 'UNCONFIRMED_ACTUAL_MODEL',
        model,
        requestedModel: model,
        actualModel,
        actualModelStatus,
        modelIdentityConfirmed: false,
        reason: `Provider reported unknown or unsupported actual model "${actualModel}" (requested "${model}")`,
        callProof
      };
    }

    if (actualModel !== null && !isMatchingActual) {
      return {
        status: 'refused',
        code: 'ACTUAL_MODEL_MISMATCH',
        model,
        requestedModel: model,
        actualModel,
        actualModelStatus,
        modelIdentityConfirmed: false,
        reason: `Provider reported actual model "${actualModel}" which differs from requested model "${model}"`,
        callProof
      };
    }

    if (actualModel === null && requireConfirmedModelIdentity === true) {
      return {
        status: 'refused',
        code: 'UNCONFIRMED_ACTUAL_MODEL',
        model,
        requestedModel: model,
        actualModel: null,
        actualModelStatus: 'UNCONFIRMED',
        modelIdentityConfirmed: false,
        reason: `Provider response omitted actual model identifier for requested model "${model}" (UNCONFIRMED)`,
        callProof
      };
    }

    const messageObj = data?.choices?.[0]?.message;

    if (messageObj && messageObj.refusal !== undefined && messageObj.refusal !== null) {
      if (typeof messageObj.refusal === 'string') {
        if (messageObj.refusal.trim()) {
          const rawRefusal = messageObj.refusal.trim();
          const safeRefusal = (typeof gate.apiKey === 'string' && gate.apiKey.length > 0 && rawRefusal.includes(gate.apiKey))
            ? 'Model refused request (refusal text redacted)'
            : rawRefusal.slice(0, 256);
          return {
            status: 'refused',
            code: 'MODEL_REFUSAL',
            model,
            requestedModel: model,
            actualModel,
            actualModelStatus,
            modelIdentityConfirmed,
            reason: safeRefusal,
            callProof
          };
        }
      } else {
        const rawObjRefusalMsg = (
          typeof messageObj.refusal === 'object' &&
          !Array.isArray(messageObj.refusal) &&
          typeof messageObj.refusal.message === 'string' &&
          messageObj.refusal.message.trim()
        )
          ? messageObj.refusal.message.trim()
          : (
            typeof messageObj.refusal === 'object' &&
            !Array.isArray(messageObj.refusal) &&
            typeof messageObj.refusal.reason === 'string' &&
            messageObj.refusal.reason.trim()
              ? messageObj.refusal.reason.trim()
              : null
          );
        const safeMalformedRefusal = rawObjRefusalMsg
          ? ((typeof gate.apiKey === 'string' && gate.apiKey.length > 0 && rawObjRefusalMsg.includes(gate.apiKey))
              ? 'Model refused request (refusal text redacted)'
              : rawObjRefusalMsg.slice(0, 256))
          : 'Model refused request (malformed non-string refusal payload)';
        return {
          status: 'refused',
          code: 'MODEL_REFUSAL',
          model,
          requestedModel: model,
          actualModel,
          actualModelStatus,
          modelIdentityConfirmed,
          reason: safeMalformedRefusal,
          callProof
        };
      }
    }

    const content = messageObj?.content;
    const proposal = extractPhysicsProposal(content, { knownSecret: gate.apiKey });

    if (proposal.status === 'refused') {
      const hasSecretInRefusal = Boolean(
        typeof gate.apiKey === 'string' &&
        gate.apiKey.length > 0 &&
        (
          (typeof proposal.reason === 'string' && proposal.reason.includes(gate.apiKey)) ||
          (typeof proposal.code === 'string' && proposal.code.includes(gate.apiKey)) ||
          (typeof proposal.field === 'string' && proposal.field.includes(gate.apiKey))
        )
      );
      return {
        status: 'refused',
        code: hasSecretInRefusal ? 'INVALID_PROPOSAL_SHAPE' : proposal.code,
        reason: hasSecretInRefusal ? 'Proposal rejected by schema validation (redacted credential echo)' : proposal.reason,
        ...(!hasSecretInRefusal && typeof proposal.field === 'string' && proposal.field ? { field: proposal.field } : {}),
        model,
        requestedModel: model,
        actualModel,
        actualModelStatus,
        modelIdentityConfirmed,
        callProof
      };
    }

    if (
      typeof gate.apiKey === 'string' &&
      gate.apiKey.length > 0 &&
      (proposal.id.includes(gate.apiKey) || proposal.title.includes(gate.apiKey))
    ) {
      return {
        status: 'refused',
        code: 'INVALID_PROPOSAL_SHAPE',
        reason: 'Proposal metadata contains forbidden credential echo',
        model,
        requestedModel: model,
        actualModel,
        actualModelStatus,
        modelIdentityConfirmed,
        callProof
      };
    }

    return {
      status: 'ok',
      source: `remote_llama:${model}`,
      fixtureMode: 'LIVE_META_API',
      model,
      requestedModel: model,
      actualModel,
      actualModelStatus,
      modelIdentityConfirmed,
      proposal,
      callProof
    };
  } catch (err) {
    const classified = classifySafeTransportError(err, effectiveTimeoutMs);
    const safeErrRequestId = sanitizeProviderTraceString(err?.providerRequestId, gate.apiKey, 128);
    const completedAt = new Date().toISOString();
    const errorCallProof = {
      fixtureMode: 'LIVE_META_API',
      authSource: 'dedicated_keyfile_loader',
      keyState: 'ready',
      endpoint: META_LLAMA_ENDPOINT,
      singleAttempt: true,
      attemptCount: 1,
      retriesPerformed: 0,
      httpStatus: null,
      requestedModel: model,
      actualModel: null,
      actualModelStatus: 'UNCONFIRMED',
      modelIdentityConfirmed: false,
      providerRequestId: safeErrRequestId,
      providerResponseId: null,
      providerResponseIdStatus: 'UNCONFIRMED',
      requestSha256,
      responseSha256: null,
      usage: null,
      usageStatus: 'UNAVAILABLE',
      errorType: classified.errorType,
      attemptStartedAt,
      timestamp: completedAt,
      ...(classified.isTimeout ? { timeoutCode: 'REQUEST_TIMEOUT', timedOut: true } : {})
    };
    return {
      status: 'refused',
      code: 'NETWORK_ERROR',
      errorType: classified.errorType,
      model,
      requestedModel: model,
      actualModel: null,
      actualModelStatus: 'UNCONFIRMED',
      modelIdentityConfirmed: false,
      ...(classified.isTimeout ? { timeoutCode: 'REQUEST_TIMEOUT', timedOut: true } : {}),
      reason: classified.reason,
      callProof: errorCallProof
    };
  } finally {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
  }
}

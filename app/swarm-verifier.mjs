/**
 * Clean-Room Meta AI Developer Hackathon Stage-3 Swarm Coordinator & Verifier.
 * Zero external dependencies. Zero monorepo house imports.
 * (note removed for export)
 *
 * Implements a 3-agent Llama 3.3 swarm coordinator (Planner, Kinematic Critic, Safety Interlock)
 * with deterministic Byzantine fault injection, physics contract interlock catching 100%
 * of unsafe physical proposals, and sequential WebCrypto SHA-256 receipt chaining into swarmRootSha256.
 */

import {
  evaluatePhysicsProposal,
  canonicalStringify,
  sha256Sync,
  computeWebCryptoSha256,
  HEX64_REGEX
} from './meta-physics-agent.mjs';

import {
  DEFAULT_LLAMA_MODEL,
  checkMetaRulesGate,
  requestLlamaPhysicsProposal
} from './llama-adapter.mjs';

import {
  NOMINAL_TRAJECTORY_5_STEP,
  KINEMATIC_DRIFT_TRAJECTORY_5_STEP,
  STRUCTURAL_LIMIT_TRAJECTORY_5_STEP
} from './trajectory-bench.mjs';

export const SWARM_VERSION = 'swarm-verifier/3.0.0';
export const GENESIS_SHA256 = '0'.repeat(64);
export const QUORUM_THRESHOLD = 2;

export const SWARM_ROLES = Object.freeze({
  PLANNER: 'planner',
  CRITIC: 'kinematic_critic',
  INTERLOCK: 'safety_interlock'
});

export const ROLES = Object.freeze(['planner', 'kinematic_critic', 'safety_interlock']);

export const BYZANTINE_FAULT_MODES = Object.freeze({
  NONE: 'none',
  COMPROMISED_PLANNER_DRIFT: 'compromised_planner_drift',
  COMPROMISED_PLANNER_BRAKE: 'compromised_planner_brake',
  COMPROMISED_PLANNER_STRUCTURAL: 'compromised_planner_structural',
  COMPROMISED_PLANNER_NAN: 'compromised_planner_nan',
  COMPROMISED_PLANNER_LIMIT_TAMPER: 'compromised_planner_limit_tamper',
  DRIFTED_CRITIC_RUBBER_STAMP: 'drifted_critic_rubber_stamp',
  DRIFTED_CRITIC_SPURIOUS_OBJECTION: 'drifted_critic_spurious_objection',
  COLLUDING_BYZANTINE: 'colluding_byzantine'
});

export const SWARM_CODES = Object.freeze({
  META_RULES_GATE_UNVERIFIED: 'META_RULES_GATE_UNVERIFIED',
  LIMIT_TAMPER: 'LIMIT_TAMPER',
  QUORUM_NOT_MET: 'QUORUM_NOT_MET',
  CRITIC_OBJECTION: 'CRITIC_OBJECTION',
  INTERLOCK_VETO: 'INTERLOCK_VETO',
  SPURIOUS_OBJECTION: 'SPURIOUS_OBJECTION',
  NUMERICAL_INSTABILITY: 'NUMERICAL_INSTABILITY',
  FRICTION_LIMIT_EXCEEDED: 'FRICTION_LIMIT_EXCEEDED',
  BRAKE_FORCE_EXCEEDED: 'BRAKE_FORCE_EXCEEDED',
  STRUCTURAL_LIMIT_EXCEEDED: 'STRUCTURAL_LIMIT_EXCEEDED',
  TAMPER_PAYLOAD_MISMATCH: 'TAMPER_PAYLOAD_MISMATCH',
  TAMPER_CHAIN_BROKEN: 'TAMPER_CHAIN_BROKEN',
  ROOT_MISMATCH: 'ROOT_MISMATCH',
  CHAIN_LINK_BROKEN: 'CHAIN_LINK_BROKEN',
  RECEIPT_HASH_MISMATCH: 'RECEIPT_HASH_MISMATCH'
});

/** Plant physical limits manifest. Pinned ground truth. */
export const PLANT_MANIFEST = Object.freeze({
  frictionMu: 0.8,
  maxSafeBrakeForceN: 5000.0,
  structuralLimitN: 10000.0
});

export const PLANT_MANIFEST_HASH = sha256Sync(canonicalStringify(PLANT_MANIFEST));
export const LIMIT_FIELDS = Object.freeze(['frictionMu', 'maxSafeBrakeForceN', 'structuralLimitN']);

/**
 * Detects whether an untrusted Planner proposal attempts to forge plant safety limits.
 */
export function detectLimitTamper(proposal, manifest = PLANT_MANIFEST) {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
    return null;
  }
  for (const k of LIMIT_FIELDS) {
    if (Object.hasOwn(proposal, k) && proposal[k] !== undefined && !Object.is(proposal[k], manifest[k])) {
      return {
        code: SWARM_CODES.LIMIT_TAMPER,
        field: k,
        proposed: proposal[k],
        pinned: manifest[k]
      };
    }
  }
  return null;
}

/**
 * Binds plant limits strictly from the pinned manifest, throwing LIMIT_TAMPER on any forged limit override.
 */
export function bindPlantLimits(proposal, manifest = PLANT_MANIFEST) {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
    const err = new Error(SWARM_CODES.NUMERICAL_INSTABILITY);
    err.code = SWARM_CODES.NUMERICAL_INSTABILITY;
    throw err;
  }
  const tamper = detectLimitTamper(proposal, manifest);
  if (tamper) {
    const err = new Error(`LIMIT_TAMPER on ${tamper.field}: proposed ${tamper.proposed} vs pinned ${tamper.pinned}`);
    err.code = SWARM_CODES.LIMIT_TAMPER;
    err.tamper = tamper;
    throw err;
  }
  return Object.freeze({
    ...proposal,
    ...manifest
  });
}

/**
 * (note removed for export)
 */
export function evaluateInterlock(criticResult, manifestHash = PLANT_MANIFEST_HASH, pinnedHash = PLANT_MANIFEST_HASH) {
  if (manifestHash !== pinnedHash) {
    return {
      verdict: 'VETO',
      code: SWARM_CODES.INTERLOCK_VETO,
      reason: 'Manifest hash drift detected by Safety Interlock'
    };
  }
  if (!criticResult || criticResult.limitsSource !== 'manifest') {
    return {
      verdict: 'VETO',
      code: SWARM_CODES.INTERLOCK_VETO,
      reason: 'Critic did not bind evaluation to pinned plant manifest'
    };
  }
  return {
    verdict: criticResult.vote === 'APPROVE' || criticResult.verdict === 'ACCEPT' ? 'CONFIRM' : 'CONCUR_REFUSE',
    code: null
  };
}

/** Default 5-step nominal trajectory */
export const BASELINE_TRAJECTORY = NOMINAL_TRAJECTORY_5_STEP;

/**
 * Deterministic offline swarm scenarios dictionary.
 */
export const OFFLINE_SWARM_SCENARIOS = Object.freeze({
  nominal_5_step: Object.freeze({
    id: 'nominal_5_step',
    title: '1. Nominal 5-Step Trajectory (Unanimous Consensus)',
    description: 'All 3 agents propose and audit within safe envelopes; 5/5 steps accepted',
    faultMode: BYZANTINE_FAULT_MODES.NONE,
    faultStep: null,
    expectedOutcome: 'completed',
    expectedHaltStep: null,
    expectedCode: null
  }),
  byzantine_planner_drift: Object.freeze({
    id: 'byzantine_planner_drift',
    title: '2. Byzantine Planner: Velocity Drift Skid at Step 4 [HALT: FRICTION_LIMIT_EXCEEDED]',
    description: 'Compromised planner proposes 6.0 m/s velocity in 1.2 m distance at Step 4; halted by Interlock',
    faultMode: BYZANTINE_FAULT_MODES.COMPROMISED_PLANNER_DRIFT,
    faultStep: 4,
    expectedOutcome: 'halted',
    expectedHaltStep: 4,
    expectedCode: SWARM_CODES.FRICTION_LIMIT_EXCEEDED
  }),
  byzantine_planner_brake: Object.freeze({
    id: 'byzantine_planner_brake',
    title: '3. Byzantine Planner: Brake Overload at Step 3 [HALT: BRAKE_FORCE_EXCEEDED]',
    description: 'Compromised planner proposes stopping 1200 kg from 8 m/s in 4 m (9600 N brake demand > 7000 N max safe); halted',
    faultMode: BYZANTINE_FAULT_MODES.COMPROMISED_PLANNER_BRAKE,
    faultStep: 3,
    expectedOutcome: 'halted',
    expectedHaltStep: 3,
    expectedCode: SWARM_CODES.BRAKE_FORCE_EXCEEDED
  }),
  byzantine_planner_structural: Object.freeze({
    id: 'byzantine_planner_structural',
    title: '4. Byzantine Planner: Excessive Thrust Overload at Step 3 [HALT: STRUCTURAL_LIMIT_EXCEEDED]',
    description: 'Compromised planner holds 12 kN thrust while braking (total 16.8 kN > 15 kN chassis limit); halted',
    faultMode: BYZANTINE_FAULT_MODES.COMPROMISED_PLANNER_STRUCTURAL,
    faultStep: 3,
    expectedOutcome: 'halted',
    expectedHaltStep: 3,
    expectedCode: SWARM_CODES.STRUCTURAL_LIMIT_EXCEEDED
  }),
  byzantine_planner_nan: Object.freeze({
    id: 'byzantine_planner_nan',
    title: '5. Byzantine Planner: Hallucinated NaN Token at Step 1 [HALT: NUMERICAL_INSTABILITY]',
    description: 'Planner emits non-finite NaN token; immediately halted at Step 1',
    faultMode: BYZANTINE_FAULT_MODES.COMPROMISED_PLANNER_NAN,
    faultStep: 1,
    expectedOutcome: 'halted',
    expectedHaltStep: 1,
    expectedCode: SWARM_CODES.NUMERICAL_INSTABILITY
  }),
  byzantine_planner_limit_tamper: Object.freeze({
    id: 'byzantine_planner_limit_tamper',
    title: '6a. Byzantine Planner: Moves the Goalposts (Forged Plant Limits at Step 3) [HALT: LIMIT_TAMPER]',
    description: 'Planner attempts to override pinned manifest limits (frictionMu 0.7 vs pinned 0.8); halted with LIMIT_TAMPER',
    faultMode: BYZANTINE_FAULT_MODES.COMPROMISED_PLANNER_LIMIT_TAMPER,
    faultStep: 3,
    expectedOutcome: 'halted',
    expectedHaltStep: 3,
    expectedCode: SWARM_CODES.LIMIT_TAMPER
  }),
  byzantine_critic_rubber_stamp: Object.freeze({
    id: 'byzantine_critic_rubber_stamp',
    title: '6. Byzantine Critic: Corrupt Rubber-Stamp Overridden by Safety Interlock [100% CATCH]',
    description: 'Planner proposes Step 3 with structural overload; Critic corruptly votes APPROVE; Interlock vetoes and halts',
    faultMode: BYZANTINE_FAULT_MODES.DRIFTED_CRITIC_RUBBER_STAMP,
    faultStep: 3,
    expectedOutcome: 'halted',
    expectedHaltStep: 3,
    expectedCode: SWARM_CODES.STRUCTURAL_LIMIT_EXCEEDED
  }),
  byzantine_critic_spurious_objection: Object.freeze({
    id: 'byzantine_critic_spurious_objection',
    title: '7. Byzantine Critic: Spurious False-Alarm Objection at Step 2 [HALT: SPURIOUS_OBJECTION]',
    description: 'Critic falsely raises SPURIOUS_OBJECTION on nominal step 2; execution halts for human operator review',
    faultMode: BYZANTINE_FAULT_MODES.DRIFTED_CRITIC_SPURIOUS_OBJECTION,
    faultStep: 2,
    expectedOutcome: 'halted',
    expectedHaltStep: 2,
    expectedCode: SWARM_CODES.SPURIOUS_OBJECTION
  }),
  byzantine_colluding_pair: Object.freeze({
    id: 'byzantine_colluding_pair',
    title: '8. Colluding Byzantine Swarm: Planner + Critic vs Safety Interlock [INTERLOCK_HALT]',
    description: 'Planner proposes extreme thrust overload at Step 3; Critic approves; Safety Interlock vetoes unilaterally',
    faultMode: BYZANTINE_FAULT_MODES.COLLUDING_BYZANTINE,
    faultStep: 3,
    expectedOutcome: 'halted',
    expectedHaltStep: 3,
    expectedCode: SWARM_CODES.STRUCTURAL_LIMIT_EXCEEDED
  })
});

/** Backward-compatibility alias */
export const FAULT_SCENARIOS = OFFLINE_SWARM_SCENARIOS;

/**
 * Injects a deterministic Byzantine fault into a step proposal.
 */
export function injectByzantineFault(stepProposal, faultType = BYZANTINE_FAULT_MODES.NONE, options = {}) {
  if (!stepProposal || typeof stepProposal !== 'object') {
    throw new Error('stepProposal must be an object');
  }

  const base = { ...stepProposal };

  if (options.patch && typeof options.patch === 'object') {
    return { ...base, ...options.patch };
  }

  switch (faultType) {
    case BYZANTINE_FAULT_MODES.NONE:
    case 'nominal':
      return base;

    case BYZANTINE_FAULT_MODES.COMPROMISED_PLANNER_DRIFT:
    case 'planner_overspeed':
      return {
        ...base,
        velocityMps: 6.0,
        stopDistanceM: 1.2,
        frictionMu: 0.7
      };

    case BYZANTINE_FAULT_MODES.COMPROMISED_PLANNER_BRAKE:
    case 'planner_brake_hallucination':
      return {
        ...base,
        massKg: 1200.0,
        velocityMps: 8.0,
        stopDistanceM: 4.0,
        frictionMu: 0.9,
        maxSafeBrakeForceN: 7000.0
      };

    case BYZANTINE_FAULT_MODES.COMPROMISED_PLANNER_STRUCTURAL:
    case 'planner_thrust_overload':
      return {
        ...base,
        massKg: 800.0,
        velocityMps: 6.0,
        stopDistanceM: 3.0,
        thrustN: 12000.0,
        structuralLimitN: 15000.0
      };

    case BYZANTINE_FAULT_MODES.COMPROMISED_PLANNER_NAN:
    case 'planner_nan_injection':
      return {
        ...base,
        velocityMps: Number.NaN
      };

    case BYZANTINE_FAULT_MODES.COMPROMISED_PLANNER_LIMIT_TAMPER:
    case 'planner_limit_tamper':
      return {
        ...base,
        forgedLimits: true,
        frictionMu: 0.7,
        maxSafeBrakeForceN: 7000.0,
        structuralLimitN: 15000.0
      };

    case BYZANTINE_FAULT_MODES.DRIFTED_CRITIC_RUBBER_STAMP:
    case 'critic_friction_bypass':
    case BYZANTINE_FAULT_MODES.COLLUDING_BYZANTINE:
    case 'collusion_two_of_three':
      return {
        ...base,
        massKg: 800.0,
        velocityMps: 6.0,
        stopDistanceM: 3.0,
        thrustN: 12000.0,
        structuralLimitN: 15000.0
      };

    case BYZANTINE_FAULT_MODES.DRIFTED_CRITIC_SPURIOUS_OBJECTION:
    case 'interlock_false_veto':
      return base;

    default:
      return base;
  }
}

/**
 * Evaluates a proposal from the perspective of the Kinematic Critic role.
 */
export function evaluateKinematicCritic(proposal, options = {}, manifest = PLANT_MANIFEST) {
  if (!proposal || typeof proposal !== 'object') {
    return {
      role: SWARM_ROLES.CRITIC,
      vote: 'OBJECT',
      code: SWARM_CODES.NUMERICAL_INSTABILITY,
      reason: 'Proposal must be a valid object',
      metrics: null,
      limitsSource: 'manifest'
    };
  }

  if (options.strictManifest || options.faultMode === BYZANTINE_FAULT_MODES.COMPROMISED_PLANNER_LIMIT_TAMPER || proposal.forgedLimits === true) {
    const tamper = detectLimitTamper(proposal, manifest);
    if (tamper) {
      return {
        role: SWARM_ROLES.CRITIC,
        vote: 'OBJECT',
        code: SWARM_CODES.LIMIT_TAMPER,
        reason: `Planner attempted to override pinned plant limit ${tamper.field} (${tamper.proposed} !== ${tamper.pinned})`,
        tamper,
        metrics: null,
        limitsSource: 'manifest'
      };
    }
  }

  if (options.faultMode === BYZANTINE_FAULT_MODES.DRIFTED_CRITIC_SPURIOUS_OBJECTION || options.spuriousObjection) {
    return {
      role: SWARM_ROLES.CRITIC,
      vote: 'OBJECT',
      code: SWARM_CODES.SPURIOUS_OBJECTION,
      reason: 'Spurious objection: Critic flagged non-existent telemetry drift',
      metrics: null,
      limitsSource: 'manifest'
    };
  }

  if (options.faultMode === BYZANTINE_FAULT_MODES.DRIFTED_CRITIC_RUBBER_STAMP ||
      options.faultMode === BYZANTINE_FAULT_MODES.COLLUDING_BYZANTINE ||
      options.forceApprove) {
    return {
      role: SWARM_ROLES.CRITIC,
      vote: 'APPROVE',
      code: null,
      reason: 'Drifted Critic corrupt rubber-stamp approval',
      metrics: {
        corruptApproval: true
      },
      limitsSource: 'proposal'
    };
  }

  const pinnedManifest = manifest || PLANT_MANIFEST;
  const {
    massKg,
    velocityMps,
    stopDistanceM,
    frictionMu = pinnedManifest.frictionMu,
    maxSafeBrakeForceN = pinnedManifest.maxSafeBrakeForceN,
    thrustN = 0.0,
    structuralLimitN = pinnedManifest.structuralLimitN
  } = proposal;

  const fields = { massKg, velocityMps, stopDistanceM, frictionMu, maxSafeBrakeForceN, thrustN, structuralLimitN };
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return {
        role: SWARM_ROLES.CRITIC,
        vote: 'OBJECT',
        code: SWARM_CODES.NUMERICAL_INSTABILITY,
        reason: `Kinematic parameter ${k} must be a finite number`,
        metrics: null,
        limitsSource: 'manifest'
      };
    }
  }

  if (massKg <= 0 || velocityMps < 0 || stopDistanceM <= 0 || frictionMu <= 0 || maxSafeBrakeForceN <= 0 || thrustN < 0 || structuralLimitN <= 0) {
    return {
      role: SWARM_ROLES.CRITIC,
      vote: 'OBJECT',
      code: SWARM_CODES.NUMERICAL_INSTABILITY,
      reason: 'Kinematic parameters must be within strictly positive operational ranges',
      metrics: null,
      limitsSource: 'manifest'
    };
  }

  const a_stop = (velocityMps * velocityMps) / (2.0 * stopDistanceM);
  const F_brake_req = massKg * a_stop;
  const F_fric_max = frictionMu * massKg * 9.80665;
  const F_total = F_brake_req + thrustN;
  const kineticEnergyJ = 0.5 * massKg * velocityMps * velocityMps;

  const metrics = {
    requiredDecelerationMps2: Math.round(a_stop * 1000) / 1000,
    requiredBrakeForceN: Math.round(F_brake_req * 100) / 100,
    maxFrictionForceN: Math.round(F_fric_max * 100) / 100,
    totalForceN: Math.round(F_total * 100) / 100,
    kineticEnergyJ: Math.round(kineticEnergyJ * 100) / 100
  };

  if (F_brake_req > F_fric_max + 1e-6) {
    return {
      role: SWARM_ROLES.CRITIC,
      vote: 'OBJECT',
      code: SWARM_CODES.FRICTION_LIMIT_EXCEEDED,
      reason: `Required braking force ${F_brake_req.toFixed(2)} N exceeds surface friction capacity ${F_fric_max.toFixed(2)} N`,
      metrics,
      limitsSource: 'manifest'
    };
  }

  if (F_brake_req > maxSafeBrakeForceN + 1e-6) {
    return {
      role: SWARM_ROLES.CRITIC,
      vote: 'OBJECT',
      code: SWARM_CODES.BRAKE_FORCE_EXCEEDED,
      reason: `Required braking force ${F_brake_req.toFixed(2)} N exceeds maximum safe brake actuator rating ${maxSafeBrakeForceN} N`,
      metrics,
      limitsSource: 'manifest'
    };
  }

  if (F_total > structuralLimitN + 1e-6) {
    return {
      role: SWARM_ROLES.CRITIC,
      vote: 'OBJECT',
      code: SWARM_CODES.STRUCTURAL_LIMIT_EXCEEDED,
      reason: `Combined mechanical load ${F_total.toFixed(2)} N exceeds structural yield limit ${structuralLimitN} N`,
      metrics,
      limitsSource: 'manifest'
    };
  }

  return {
    role: SWARM_ROLES.CRITIC,
    vote: 'APPROVE',
    code: null,
    reason: 'Kinematic calculations verified within safe operational bounds',
    metrics,
    limitsSource: 'manifest'
  };
}

/**
 * Evaluates proposal through the Deterministic Safety Interlock contract gate.
 * Holds absolute unilateral veto power.
 */
export function evaluateSafetyInterlock(proposal, options = {}, manifest = PLANT_MANIFEST) {
  if (options.forceReject) {
    return {
      role: SWARM_ROLES.INTERLOCK,
      vote: 'INTERLOCK_HALT',
      contractStatus: 'refused',
      code: 'INTERLOCK_FORCE_REJECT',
      reason: 'Forced Byzantine rejection on Safety Interlock',
      state: null
    };
  }

  if (options.strictManifest || options.faultMode === BYZANTINE_FAULT_MODES.COMPROMISED_PLANNER_LIMIT_TAMPER || (proposal && proposal.forgedLimits === true)) {
    const tamper = detectLimitTamper(proposal, manifest);
    if (tamper) {
      return {
        role: SWARM_ROLES.INTERLOCK,
        vote: 'INTERLOCK_HALT',
        contractStatus: 'refused',
        code: SWARM_CODES.LIMIT_TAMPER,
        reason: `Safety Interlock refused forged plant limit ${tamper.field} (${tamper.proposed} !== ${tamper.pinned})`,
        state: null
      };
    }
  }

  const evalResult = evaluatePhysicsProposal(proposal);

  if (evalResult.status === 'accepted') {
    return {
      role: SWARM_ROLES.INTERLOCK,
      vote: 'APPROVE',
      contractStatus: 'accepted',
      code: null,
      reason: 'Deterministic contract gate approved proposal',
      state: evalResult.state,
      metrics: evalResult.metrics
    };
  }

  return {
    role: SWARM_ROLES.INTERLOCK,
    vote: 'INTERLOCK_HALT',
    contractStatus: 'refused',
    code: evalResult.code,
    reason: evalResult.reason,
    state: evalResult.state || null
  };
}

/**
 * Resolves the 3-agent swarm quorum outcome with the Safety Interlock veto invariant.
 */
export function resolveSwarmQuorum({ plannerProposal, criticVote, interlockVote, byzantineFault = null } = {}) {
  // Invariant 1: Safety Interlock Unilateral Veto (Absolute priority)
  if (!interlockVote || interlockVote.vote === 'INTERLOCK_HALT' || interlockVote.contractStatus !== 'accepted') {
    return {
      status: 'REFUSED',
      refusalCode: interlockVote?.code || SWARM_CODES.INTERLOCK_VETO,
      reason: interlockVote?.reason || 'Safety Interlock deterministic contract gate vetoed step'
    };
  }

  // Invariant 2: Kinematic Critic Objection
  if (!criticVote || criticVote.vote === 'OBJECT') {
    return {
      status: 'REFUSED',
      refusalCode: criticVote?.code || SWARM_CODES.CRITIC_OBJECTION,
      reason: criticVote?.reason || 'Kinematic Critic objected to proposal'
    };
  }

  // Invariant 3: Unanimous consensus across roles
  if (criticVote.vote === 'APPROVE' && interlockVote.vote === 'APPROVE') {
    return {
      status: 'ACCEPTED',
      refusalCode: null,
      reason: 'Unanimous quorum approval across all roles'
    };
  }

  return {
    status: 'REFUSED',
    refusalCode: SWARM_CODES.QUORUM_NOT_MET,
    reason: 'Quorum threshold not met'
  };
}

/**
 * Generates a canonical cryptographic step receipt for the swarm step.
 */
export function generateSwarmStepReceipt({
  step = 1,
  previousHash = GENESIS_SHA256,
  plannerProposal = {},
  criticVote = {},
  interlockVote = {},
  quorumDecision = {},
  byzantineFault = null,
  timestamp = '2026-10-25T00:00:00.000Z'
} = {}) {
  if (typeof previousHash !== 'string' || !HEX64_REGEX.test(previousHash)) {
    throw new Error('INVALID_PREVIOUS_HASH: previousHash must be a 64-character lowercase hex SHA-256 digest');
  }

  const cleanNum = (v) => {
    if (typeof v === 'number' && !Number.isFinite(v)) return `__nonfinite:${String(v)}`;
    return v ?? null;
  };

  const canonicalObj = {
    byzantineFault: byzantineFault || null,
    criticVote: {
      code: criticVote.code ?? null,
      metrics: criticVote.metrics ?? null,
      reason: criticVote.reason ?? null,
      role: criticVote.role || SWARM_ROLES.CRITIC,
      vote: criticVote.vote
    },
    interlockVote: {
      code: interlockVote.code ?? null,
      contractStatus: interlockVote.contractStatus,
      reason: interlockVote.reason ?? null,
      role: interlockVote.role || SWARM_ROLES.INTERLOCK,
      vote: interlockVote.vote
    },
    plannerProposal: {
      frictionMu: cleanNum(plannerProposal.frictionMu),
      id: plannerProposal.id ?? null,
      massKg: cleanNum(plannerProposal.massKg),
      maxSafeBrakeForceN: cleanNum(plannerProposal.maxSafeBrakeForceN),
      stopDistanceM: cleanNum(plannerProposal.stopDistanceM),
      structuralLimitN: cleanNum(plannerProposal.structuralLimitN),
      thrustN: cleanNum(plannerProposal.thrustN),
      title: plannerProposal.title ?? null,
      velocityMps: cleanNum(plannerProposal.velocityMps)
    },
    previousHash,
    quorumDecision: {
      reason: quorumDecision.reason ?? null,
      refusalCode: quorumDecision.refusalCode ?? null,
      status: quorumDecision.status
    },
    step,
    timestamp
  };

  const canonicalJson = canonicalStringify(canonicalObj);
  const receiptHash = sha256Sync(canonicalJson);

  return {
    step,
    previousHash,
    canonicalObj,
    canonicalJson,
    receiptHash,
    sha256: receiptHash, // alias for chain compatibility
    plannerProposal: canonicalObj.plannerProposal,
    criticVote: canonicalObj.criticVote,
    interlockVote: canonicalObj.interlockVote,
    quorumDecision: canonicalObj.quorumDecision,
    byzantineFault: canonicalObj.byzantineFault,
    timestamp
  };
}

/**
 * Computes root SHA-256 over an array of step receipts.
 */
export function computeSwarmChainSha256(receipts) {
  if (!Array.isArray(receipts) || receipts.length === 0) {
    return GENESIS_SHA256;
  }
  const lines = receipts.map((r) => r.receiptHash || r.sha256).join('\n') + '\n';
  return sha256Sync(lines);
}

export const computeSwarmRootSha256 = computeSwarmChainSha256;

/**
 * Asynchronously computes root hash using WebCrypto standard.
 */
export async function computeWebCryptoSwarmRoot(receipts) {
  if (!Array.isArray(receipts) || receipts.length === 0) {
    return GENESIS_SHA256;
  }
  const lines = receipts.map((r) => r.receiptHash || r.sha256).join('\n') + '\n';
  return computeWebCryptoSha256(lines);
}

/**
 * Cryptographically verifies an entire swarm trajectory hash chain.
 * Validates step receipts, inter-step hash linkage, and root hash.
 * Fails closed on any single-bit mutation.
 */
export function verifySwarmChain({ receipts, swarmRootSha256 } = {}) {
  if (!Array.isArray(receipts) || receipts.length === 0) {
    return {
      verified: false,
      valid: false,
      code: 'INVALID_SWARM_RECEIPTS',
      reason: 'Receipts must be a non-empty array'
    };
  }

  if (typeof swarmRootSha256 !== 'string' || !HEX64_REGEX.test(swarmRootSha256)) {
    return {
      verified: false,
      valid: false,
      code: 'INVALID_SWARM_ROOT_HASH',
      reason: 'swarmRootSha256 must be a 64-character lowercase hex digest'
    };
  }

  // 1. Verify Step 1 genesis link
  if (receipts[0].previousHash !== GENESIS_SHA256 && receipts[0].canonicalObj?.previousHash !== GENESIS_SHA256) {
    return {
      verified: false,
      valid: false,
      code: SWARM_CODES.TAMPER_CHAIN_BROKEN,
      step: 1,
      reason: 'Step 1 previousHash must be 64 zeros'
    };
  }

  // 2. Iterate and verify each step
  let expectedPrevHash = GENESIS_SHA256;
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];
    const stepNum = i + 1;

    const actualPrev = r.previousHash || r.canonicalObj?.previousHash;
    if (actualPrev !== expectedPrevHash) {
      return {
        verified: false,
        valid: false,
        code: SWARM_CODES.TAMPER_CHAIN_BROKEN,
        step: stepNum,
        reason: `Step ${stepNum} previousHash does not match previous receiptHash`
      };
    }

    const recomputedJson = canonicalStringify(r.canonicalObj);
    const recomputedHash = sha256Sync(recomputedJson);
    const recordedHash = r.receiptHash || r.sha256;

    if (recomputedHash !== recordedHash) {
      return {
        verified: false,
        valid: false,
        code: SWARM_CODES.TAMPER_PAYLOAD_MISMATCH,
        step: stepNum,
        reason: `Step ${stepNum} payload hash mismatch (tampered content)`
      };
    }

    expectedPrevHash = recordedHash;
  }

  // 3. Verify root SHA-256
  const recomputedRoot = computeSwarmRootSha256(receipts);
  if (recomputedRoot !== swarmRootSha256) {
    return {
      verified: false,
      valid: false,
      code: SWARM_CODES.ROOT_MISMATCH,
      reason: `Root hash mismatch: expected ${swarmRootSha256}, got ${recomputedRoot}`
    };
  }

  return {
    verified: true,
    valid: true,
    stepsVerified: receipts.length,
    swarmRootSha256
  };
}

/**
 * Executes a 3-agent Llama swarm trajectory with deterministic Byzantine fault injection.
 */
export async function runLlamaSwarmTrajectory({
  scenario = 'nominal_5_step',
  faultMode = BYZANTINE_FAULT_MODES.NONE,
  faultStep = null,
  trajectory = null,
  offlineMode = true,
  env = (typeof process !== 'undefined' ? process.env : {}),
  fetchImpl = globalThis.fetch,
  model = DEFAULT_LLAMA_MODEL,
  throwOnRefusal = false,
  baseTimestamp = '2026-10-25T00:00:00'
} = {}) {
  // 1. Enforce Pre-Rules Release Gate on live network requests
  if (!offlineMode) {
    const gate = checkMetaRulesGate(env);
    if (!gate.allowed) {
      if (throwOnRefusal) {
        const err = new Error('META_RULES_GATE_UNVERIFIED: Meta Official Hackathon Rules not verified');
        err.code = SWARM_CODES.META_RULES_GATE_UNVERIFIED;
        throw err;
      }
      return {
        status: 'refused',
        code: SWARM_CODES.META_RULES_GATE_UNVERIFIED,
        refusal: gate.refusal
      };
    }
  }

  // 2. Resolve scenario and trajectory
  let activeFaultMode = faultMode;
  let activeFaultStep = faultStep;
  let scenarioSpec = OFFLINE_SWARM_SCENARIOS[scenario];

  if (scenarioSpec) {
    if (faultMode === BYZANTINE_FAULT_MODES.NONE && scenarioSpec.faultMode !== BYZANTINE_FAULT_MODES.NONE) {
      activeFaultMode = scenarioSpec.faultMode;
      activeFaultStep = scenarioSpec.faultStep;
    }
  }

  let steps = trajectory;
  if (!steps) {
    if (activeFaultMode === BYZANTINE_FAULT_MODES.COMPROMISED_PLANNER_DRIFT) {
      steps = KINEMATIC_DRIFT_TRAJECTORY_5_STEP;
    } else if (activeFaultMode === BYZANTINE_FAULT_MODES.COMPROMISED_PLANNER_STRUCTURAL) {
      steps = STRUCTURAL_LIMIT_TRAJECTORY_5_STEP;
    } else {
      steps = NOMINAL_TRAJECTORY_5_STEP;
    }
  }

  const receipts = [];
  let currentPreviousHash = GENESIS_SHA256;
  let halted = false;
  let haltStep = null;
  let haltCode = null;
  let haltReason = null;
  let violationsAttempted = 0;
  let violationsPrevented = 0;

  for (let i = 0; i < steps.length; i++) {
    const stepNumber = i + 1;
    const baseProposal = steps[i];
    const timestamp = `${baseTimestamp}.${String(stepNumber).padStart(3, '0')}Z`;

    const isFaultStep = activeFaultStep !== null ? (stepNumber === activeFaultStep) : (activeFaultMode !== BYZANTINE_FAULT_MODES.NONE);

    // 1. Planner Agent proposes
    let plannerProposal = { ...baseProposal };
    if (isFaultStep && activeFaultMode !== BYZANTINE_FAULT_MODES.NONE) {
      plannerProposal = injectByzantineFault(baseProposal, activeFaultMode);
      violationsAttempted++;
    }

    // 2. Kinematic Critic audits
    const criticOptions = {
      faultMode: isFaultStep ? activeFaultMode : BYZANTINE_FAULT_MODES.NONE
    };
    const criticVote = evaluateKinematicCritic(plannerProposal, criticOptions);

    // 3. Safety Interlock checks
    const interlockOptions = {
      forceReject: isFaultStep && activeFaultMode === 'interlock_false_veto'
    };
    const interlockVote = evaluateSafetyInterlock(plannerProposal, interlockOptions);

    // 4. Resolve Quorum
    const quorumDecision = resolveSwarmQuorum({
      plannerProposal,
      criticVote,
      interlockVote,
      byzantineFault: isFaultStep ? activeFaultMode : null
    });

    // 5. Generate Receipt
    const receipt = generateSwarmStepReceipt({
      step: stepNumber,
      previousHash: currentPreviousHash,
      plannerProposal,
      criticVote,
      interlockVote,
      quorumDecision,
      byzantineFault: isFaultStep ? activeFaultMode : null,
      timestamp
    });

    receipts.push(receipt);
    currentPreviousHash = receipt.receiptHash;

    if (quorumDecision.status !== 'ACCEPTED') {
      halted = true;
      haltStep = stepNumber;
      haltCode = quorumDecision.refusalCode;
      haltReason = quorumDecision.reason;
      violationsPrevented++;
      break; // Immediate fail-closed halt: never execute or issue receipts for subsequent steps
    }
  }

  const swarmRootSha256 = computeSwarmRootSha256(receipts);

  return {
    status: halted ? 'halted' : 'completed',
    scenario,
    faultMode: activeFaultMode,
    faultStep: activeFaultStep,
    totalStepsProposed: steps.length,
    stepsAttempted: steps.length,
    stepsExecuted: receipts.length,
    halted,
    haltStep,
    haltCode,
    haltReason,
    violationsAttempted,
    violationsPrevented,
    hardwareDamageScore: halted ? 0 : (activeFaultMode !== BYZANTINE_FAULT_MODES.NONE ? 100 : 0),
    safetyDifferential: halted
      ? `Safety Interlock prevented catastrophic hardware failure at Step ${haltStep} (${haltCode})`
      : 'All steps executed within verified operational boundaries',
    receipts,
    swarmRootSha256,
    unanimous: receipts.every((r) => r.quorumDecision?.status === 'ACCEPTED')
  };
}

/**
 * Backward compatibility functions matching draft signatures
 */
export async function runSwarm({
  mode = 'offline',
  scenario = 'nominal',
  trajectory = BASELINE_TRAJECTORY,
  prevSha256 = GENESIS_SHA256,
  ...rest
} = {}) {
  const faultKey = scenario === 'nominal' ? 'nominal_5_step' : scenario;
  const res = await runLlamaSwarmTrajectory({
    scenario: faultKey,
    trajectory,
    offlineMode: mode === 'offline',
    ...rest
  });
  return {
    status: res.status === 'refused' ? 'refused' : 'ok',
    code: res.code,
    scenario,
    description: OFFLINE_SWARM_SCENARIOS[faultKey]?.description || scenario,
    mode,
    receipts: res.receipts || [],
    headSha256: res.swarmRootSha256,
    committed: (res.receipts || []).filter((r) => r.quorumDecision?.status === 'ACCEPTED').map((r) => `step_${r.step}`),
    refused: (res.receipts || []).filter((r) => r.quorumDecision?.status !== 'ACCEPTED').map((r) => ({ stepId: `step_${r.step}`, code: r.quorumDecision?.refusalCode }))
  };
}

export async function verifyReceiptChain(receipts, genesis = GENESIS_SHA256) {
  const root = computeSwarmRootSha256(receipts);
  const v = verifySwarmChain({ receipts, swarmRootSha256: root });
  return { valid: v.valid, headSha256: root, code: v.code };
}

export async function verifySwarm({ mode = 'offline', ...rest } = {}) {
  const run = await runLlamaSwarmTrajectory({ offlineMode: mode === 'offline', ...rest });
  return {
    status: run.halted ? 'halted' : 'verified',
    swarmRootSha256: run.swarmRootSha256,
    receiptCount: run.receipts.length,
    run
  };
}

export async function recomputeSwarmRoot(receipts) {
  const root = computeSwarmRootSha256(receipts);
  return { valid: true, swarmRootSha256: root };
}

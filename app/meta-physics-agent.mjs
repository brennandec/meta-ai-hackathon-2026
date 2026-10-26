/**
 * Clean-Room Meta Llama 3.x Physics Agent & Deterministic Contract Gate.
 * Zero external dependencies. Zero monorepo house imports.
 * Evaluates orbital physics maneuvers with strict conservation laws and WebCrypto SHA-256 receipts.
 */

export const PHYSICAL_CONSTANTS = Object.freeze({
  MU: 398600.4418, // Earth gravitational parameter (km^3/s^2)
  R_EARTH: 6378.137, // Earth equatorial radius (km)
  H_SAFE: 150.0, // Minimum safe altitude to prevent atmospheric decay/collision (km)
  F_MAX: 500.0, // Maximum rated thruster force (N)
  ISP: 310.0, // Specific impulse (s)
  G0: 9.80665e-3, // Standard gravity (km/s^2)
  DT_MIN: 0.1, // Minimum maneuver step (s)
  DT_MAX: 3600.0 // Maximum maneuver step (s)
});

/**
 * Computes specific orbital energy: epsilon = v^2 / 2 - mu / r (km^2/s^2)
 * Vis-Viva formulation for two-body orbital mechanics.
 */
export function computeOrbitalEnergy(r_km, v_km_s, mu = PHYSICAL_CONSTANTS.MU) {
  if (typeof r_km !== 'number' || typeof v_km_s !== 'number' || !Number.isFinite(r_km) || !Number.isFinite(v_km_s) || r_km <= 0) {
    return NaN;
  }
  return (v_km_s * v_km_s) / 2.0 - mu / r_km;
}

/**
 * Computes circular orbital speed at distance r from primary center: v_c = sqrt(mu / r) (km/s)
 */
export function computeCircularVelocity(r_km, mu = PHYSICAL_CONSTANTS.MU) {
  if (typeof r_km !== 'number' || !Number.isFinite(r_km) || r_km <= 0) {
    return NaN;
  }
  return Math.sqrt(mu / r_km);
}

/**
 * Validates a proposed physics maneuver against deterministic physical invariants.
 * Returns { status: 'accepted', state, maneuver } or { status: 'refused', code, reason, ... }
 */
export function validatePhysicsProposal(currentState, proposal) {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
    return {
      status: 'refused',
      code: 'INVALID_PROPOSAL_SHAPE',
      reason: 'Proposal must be a non-null object'
    };
  }

  const { deltaV_km_s, burnDuration_s, targetAltitude_km, thrusterForce_N } = proposal;

  // 1. Numerical Sanity
  const fields = { deltaV_km_s, burnDuration_s, targetAltitude_km, thrusterForce_N };
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      return {
        status: 'refused',
        code: 'NUMERICAL_INSTABILITY',
        field: key,
        reason: `Value for ${key} must be a finite number`
      };
    }
  }

  // 2. Thruster Engine Limits
  if (thrusterForce_N < 0 || thrusterForce_N > PHYSICAL_CONSTANTS.F_MAX) {
    return {
      status: 'refused',
      code: 'THRUST_LIMIT_EXCEEDED',
      field: 'thrusterForce_N',
      maxAllowed: PHYSICAL_CONSTANTS.F_MAX,
      actual: thrusterForce_N,
      reason: `Thruster force ${thrusterForce_N} N exceeds maximum rating of ${PHYSICAL_CONSTANTS.F_MAX} N`
    };
  }

  // 3. Burn Duration Limits
  if (burnDuration_s < PHYSICAL_CONSTANTS.DT_MIN || burnDuration_s > PHYSICAL_CONSTANTS.DT_MAX) {
    return {
      status: 'refused',
      code: 'BURN_DURATION_OUT_OF_BOUNDS',
      field: 'burnDuration_s',
      minAllowed: PHYSICAL_CONSTANTS.DT_MIN,
      maxAllowed: PHYSICAL_CONSTANTS.DT_MAX,
      actual: burnDuration_s,
      reason: `Burn duration ${burnDuration_s} s must be between ${PHYSICAL_CONSTANTS.DT_MIN} s and ${PHYSICAL_CONSTANTS.DT_MAX} s`
    };
  }

  // 4. Safe Altitude / Collision Invariant
  if (targetAltitude_km < PHYSICAL_CONSTANTS.H_SAFE) {
    return {
      status: 'refused',
      code: 'PERIAPSIS_COLLISION_RISK',
      field: 'targetAltitude_km',
      minAllowed: PHYSICAL_CONSTANTS.H_SAFE,
      actual: targetAltitude_km,
      reason: `Target altitude ${targetAltitude_km} km is below minimum safe threshold of ${PHYSICAL_CONSTANTS.H_SAFE} km`
    };
  }

  // 5. Energy Conservation & Work-Energy Theorem
  const mass_kg = (currentState && typeof currentState.mass_kg === 'number' && Number.isFinite(currentState.mass_kg) && currentState.mass_kg > 0)
    ? currentState.mass_kg
    : 1000.0;

  // Maximum achievable delta-V from thruster impulse (F * dt / m) in km/s (with 5% allowance for staging margin)
  const maxAchievableDeltaV_km_s = ((thrusterForce_N / mass_kg) * burnDuration_s) / 1000.0;
  if (Math.abs(deltaV_km_s) > maxAchievableDeltaV_km_s * 1.05 + 1e-6) {
    return {
      status: 'refused',
      code: 'ENERGY_CONSERVATION_VIOLATION',
      reason: 'Proposed delta-V exceeds physical work output achievable by thrusters',
      maxAchievableDeltaV_km_s,
      proposedDeltaV_km_s: deltaV_km_s
    };
  }

  // 6. Propellant consumption
  const propellantUsed_kg = (thrusterForce_N * burnDuration_s) / (PHYSICAL_CONSTANTS.ISP * PHYSICAL_CONSTANTS.G0 * 1000.0);
  if (propellantUsed_kg >= mass_kg) {
    return {
      status: 'refused',
      code: 'PROPELLANT_EXHAUSTED',
      reason: `Required propellant ${propellantUsed_kg.toFixed(2)} kg exceeds spacecraft mass ${mass_kg} kg`,
      propellantRequired_kg: propellantUsed_kg,
      spacecraftMass_kg: mass_kg
    };
  }

  const currentAltitude = (currentState && typeof currentState.altitude_km === 'number' && Number.isFinite(currentState.altitude_km))
    ? currentState.altitude_km
    : 300.0;
  const currentVelocity = (currentState && typeof currentState.velocity_km_s === 'number' && Number.isFinite(currentState.velocity_km_s))
    ? currentState.velocity_km_s
    : computeCircularVelocity(currentAltitude + PHYSICAL_CONSTANTS.R_EARTH);

  const r_initial = currentAltitude + PHYSICAL_CONSTANTS.R_EARTH;
  const r_final = targetAltitude_km + PHYSICAL_CONSTANTS.R_EARTH;
  const v_final = currentVelocity + deltaV_km_s;

  const energy_initial = computeOrbitalEnergy(r_initial, currentVelocity);
  const energy_final = computeOrbitalEnergy(r_final, v_final);

  return {
    status: 'accepted',
    state: {
      altitude_km: targetAltitude_km,
      velocity_km_s: Math.round(v_final * 10000) / 10000,
      mass_kg: Math.round((mass_kg - propellantUsed_kg) * 1000) / 1000,
      orbitalEnergy_km2_s2: Math.round(energy_final * 10000) / 10000,
      energyDelta_km2_s2: Math.round((energy_final - energy_initial) * 10000) / 10000
    },
    maneuver: {
      deltaV_km_s,
      burnDuration_s,
      propellantUsed_kg: Math.round(propellantUsed_kg * 1000) / 1000,
      thrusterForce_N
    }
  };
}

/**
 * Pure ES deterministic SHA-256 implementation.
 * Zero external dependencies. Zero node-specific imports required.
 * Generates bit-identical outputs to OpenSSL / WebCrypto SHA-256.
 */
export function sha256Sync(str) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let i, j;
  let result = '';
  const words = [];
  
  const utf8 = unescape(encodeURIComponent(str));
  const asciiBitLength = utf8.length * 8;
  
  let hash = [];
  const k = [];
  let primeCounter = 0;
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 312; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  
  let padded = utf8 + '\x80';
  while (padded.length % 64 !== 56) padded += '\x00';
  for (i = 0; i < padded.length; i++) {
    j = padded.charCodeAt(i);
    words[i >> 2] |= j << ((3 - i) % 4) * 8;
  }
  words[words.length] = ((asciiBitLength / maxWord) | 0);
  words[words.length] = (asciiBitLength | 0);
  
  for (j = 0; j < words.length;) {
    const w = words.slice(j, j += 16);
    const oldHash = hash.slice(0);
    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];
      const s0 = (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3));
      const s1 = (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10));
      w[i] = (i < 16) ? (w[i] | 0) : ((w[i - 16] + s0 + w[i - 7] + s1) | 0);
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      const temp1 = (hash[7] + (rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25)) + ch + k[i] + w[i]) | 0;
      const temp2 = ((rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22)) + maj) | 0;
      hash = [(temp1 + temp2) | 0, hash[0], hash[1], hash[2], (hash[3] + temp1) | 0, hash[4], hash[5], hash[6]];
    }
    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }
  for (i = 0; i < 8; i++) {
    for (j = 3; j >= 0; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += ((b < 16) ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

/**
 * Deterministic JSON stringifier with sorted keys for canonical hashing.
 */
export function canonicalStringify(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(k => JSON.stringify(k) + ':' + canonicalStringify(obj[k]));
  return '{' + pairs.join(',') + '}';
}

/**
 * Creates a deterministic, canonical JSON cryptographic receipt.
 */
export const HEX64_REGEX = /^[0-9a-f]{64}$/;

export function generateReceipt({ step = 1, previousHash = '0'.repeat(64), currentState = {}, proposal = {}, result = {}, timestamp = '2026-10-25T00:00:00.000Z' }) {
  if (typeof previousHash !== 'string' || !HEX64_REGEX.test(previousHash)) {
    throw new Error('INVALID_PREVIOUS_HASH: previousHash must be a 64-character lowercase hex SHA-256 digest');
  }
  const canonicalObj = {
    currentState: {
      altitude_km: currentState.altitude_km ?? 300.0,
      mass_kg: currentState.mass_kg ?? 1000.0,
      velocity_km_s: currentState.velocity_km_s ?? 7.726
    },
    previousHash,
    proposal: {
      burnDuration_s: proposal.burnDuration_s ?? null,
      deltaV_km_s: proposal.deltaV_km_s ?? null,
      targetAltitude_km: proposal.targetAltitude_km ?? null,
      thrusterForce_N: proposal.thrusterForce_N ?? null
    },
    refusalCode: result.code ?? null,
    state: result.state ?? null,
    status: result.status,
    step,
    timestamp
  };

  const canonicalJson = canonicalStringify(canonicalObj);
  const receiptHash = sha256Sync(canonicalJson);

  return {
    canonicalObj,
    canonicalJson,
    receiptHash
  };
}

/**
 * Browser-compatible WebCrypto SHA-256 calculation.
 */
export async function computeWebCryptoSha256(canonicalJson) {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(canonicalJson);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Sync(canonicalJson);
}

/**
 * Verifies a receipt against its canonical JSON payload.
 */
export function verifyReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || typeof receipt.canonicalJson !== 'string') {
    return { verified: false, valid: false, code: 'INVALID_RECEIPT', reason: 'Invalid receipt object' };
  }
  if (typeof receipt.receiptHash !== 'string' || !HEX64_REGEX.test(receipt.receiptHash)) {
    return { verified: false, valid: false, code: 'INVALID_RECEIPT_HASH', reason: 'Invalid receiptHash: must be 64 lowercase hex characters' };
  }
  const prevHash = receipt.canonicalObj && receipt.canonicalObj.previousHash;
  if (typeof prevHash !== 'string' || !HEX64_REGEX.test(prevHash)) {
    return { verified: false, valid: false, code: 'INVALID_PREVIOUS_HASH', reason: 'Invalid previousHash: must be 64 lowercase hex characters' };
  }
  const recomputedJson = receipt.canonicalObj ? canonicalStringify(receipt.canonicalObj) : receipt.canonicalJson;
  const computedHash = sha256Sync(recomputedJson);
  const verified = recomputedJson === receipt.canonicalJson && computedHash === receipt.receiptHash;
  return {
    verified,
    valid: verified,
    code: verified ? null : 'TAMPER_PAYLOAD_MISMATCH',
    expectedHash: receipt.receiptHash,
    computedHash,
    reason: verified ? 'Receipt cryptographic signature matches canonical payload' : 'Hash mismatch: data has been altered'
  };
}

/**
 * Pre-defined offline simulation fixtures.
 */
export const OFFLINE_FIXTURES = Object.freeze({
  valid_hohmann_transfer: {
    id: 'valid_hohmann_transfer',
    title: 'Valid Hohmann Orbit Elevation (300 km -> 500 km)',
    description: 'Autonomous orbit raising maneuver with realistic thrust and burn duration adhering to energy conservation.',
    currentState: { altitude_km: 300.0, velocity_km_s: 7.726, mass_kg: 1000.0 },
    proposal: {
      deltaV_km_s: 0.055,
      burnDuration_s: 110.0,
      thrusterForce_N: 500.0,
      targetAltitude_km: 500.0
    },
    expectedStatus: 'accepted'
  },
  thrust_limit_violation: {
    id: 'thrust_limit_violation',
    title: 'Thruster Force Exceeded (1200 N > 500 N)',
    description: 'Agent hallucinated engine capability exceeding physical thruster rating.',
    currentState: { altitude_km: 300.0, velocity_km_s: 7.726, mass_kg: 1000.0 },
    proposal: {
      deltaV_km_s: 0.055,
      burnDuration_s: 60.0,
      thrusterForce_N: 1200.0,
      targetAltitude_km: 500.0
    },
    expectedStatus: 'refused',
    expectedCode: 'THRUST_LIMIT_EXCEEDED'
  },
  energy_conservation_violation: {
    id: 'energy_conservation_violation',
    title: 'Energy Conservation Violation (Hallucinated Delta-V)',
    description: 'Agent proposed 2.5 km/s delta-V with only 500 N thrust for 30s (violates impulse theorem).',
    currentState: { altitude_km: 300.0, velocity_km_s: 7.726, mass_kg: 1000.0 },
    proposal: {
      deltaV_km_s: 2.5,
      burnDuration_s: 30.0,
      thrusterForce_N: 500.0,
      targetAltitude_km: 600.0
    },
    expectedStatus: 'refused',
    expectedCode: 'ENERGY_CONSERVATION_VIOLATION'
  },
  periapsis_collision_violation: {
    id: 'periapsis_collision_violation',
    title: 'Periapsis Collision Risk (85 km < 150 km)',
    description: 'Agent proposed de-orbit maneuver dipping trajectory into dense atmosphere.',
    currentState: { altitude_km: 300.0, velocity_km_s: 7.726, mass_kg: 1000.0 },
    proposal: {
      deltaV_km_s: -0.040,
      burnDuration_s: 80.0,
      thrusterForce_N: 500.0,
      targetAltitude_km: 85.0
    },
    expectedStatus: 'refused',
    expectedCode: 'PERIAPSIS_COLLISION_RISK'
  },
  burn_duration_violation: {
    id: 'burn_duration_violation',
    title: 'Burn Duration Out Of Bounds (7200 s > 3600 s)',
    description: 'Agent requested burn exceeding the 1-hour maximum continuous firing limit.',
    currentState: { altitude_km: 300.0, velocity_km_s: 7.726, mass_kg: 1000.0 },
    proposal: {
      deltaV_km_s: 0.150,
      burnDuration_s: 7200.0,
      thrusterForce_N: 200.0,
      targetAltitude_km: 450.0
    },
    expectedStatus: 'refused',
    expectedCode: 'BURN_DURATION_OUT_OF_BOUNDS'
  },
  numerical_instability_violation: {
    id: 'numerical_instability_violation',
    title: 'Numerical Instability (NaN / Non-finite values)',
    description: 'Agent model hallucinated non-numeric token output causing floating point breakdown.',
    currentState: { altitude_km: 300.0, velocity_km_s: 7.726, mass_kg: 1000.0 },
    proposal: {
      deltaV_km_s: NaN,
      burnDuration_s: 100.0,
      thrusterForce_N: 500.0,
      targetAltitude_km: 500.0
    },
    expectedStatus: 'refused',
    expectedCode: 'NUMERICAL_INSTABILITY'
  }
});

/**
 * Formats a clean prompt for Meta Llama 3.x physics reasoning.
 */
export function formatLlamaPrompt(currentState, missionGoal = 'Transfer from 300 km circular orbit to 500 km circular orbit') {
  return {
    system: 'You are an autonomous orbital physics agent. You output ONLY a valid JSON object specifying an orbital maneuver proposal with keys: deltaV_km_s, burnDuration_s, thrusterForce_N, targetAltitude_km.',
    user: `Current Spacecraft State:\n- Altitude: ${currentState.altitude_km} km\n- Velocity: ${currentState.velocity_km_s} km/s\n- Mass: ${currentState.mass_kg} kg\n\nMission Goal:\n${missionGoal}\n\nThruster Constraints:\n- Max Thrust: 500 N\n- Safe Altitude Minimum: 150 km\n- Max Burn Duration: 3600 s\n\nRespond with ONLY JSON.`
  };
}

/**
 * Parses raw Meta Llama model response to extract the proposal JSON.
 */
export function parseLlamaResponse(responseText) {
  if (!responseText || typeof responseText !== 'string') {
    return { success: false, error: 'Empty or non-string response' };
  }
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: 'No JSON object found in response' };
    }
    const parsed = JSON.parse(jsonMatch[0]);
    return { success: true, proposal: parsed };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Standard refusal codes for physical and contract invariants.
 */
export const REFUSAL_CODES = Object.freeze({
  INVALID_PROPOSAL_SHAPE: 'INVALID_PROPOSAL_SHAPE',
  NUMERICAL_INSTABILITY: 'NUMERICAL_INSTABILITY',
  THRUST_LIMIT_EXCEEDED: 'THRUST_LIMIT_EXCEEDED',
  BURN_DURATION_OUT_OF_BOUNDS: 'BURN_DURATION_OUT_OF_BOUNDS',
  PERIAPSIS_COLLISION_RISK: 'PERIAPSIS_COLLISION_RISK',
  ENERGY_CONSERVATION_VIOLATION: 'ENERGY_CONSERVATION_VIOLATION',
  PROPELLANT_EXHAUSTED: 'PROPELLANT_EXHAUSTED',
  FRICTION_LIMIT_EXCEEDED: 'FRICTION_LIMIT_EXCEEDED',
  BRAKE_FORCE_EXCEEDED: 'BRAKE_FORCE_EXCEEDED',
  STRUCTURAL_LIMIT_EXCEEDED: 'STRUCTURAL_LIMIT_EXCEEDED',
  META_RULES_GATE_UNVERIFIED: 'META_RULES_GATE_UNVERIFIED',
  TAMPER_PAYLOAD_MISMATCH: 'TAMPER_PAYLOAD_MISMATCH',
  TAMPER_CHAIN_BROKEN: 'TAMPER_CHAIN_BROKEN',
  INVALID_PREVIOUS_HASH: 'INVALID_PREVIOUS_HASH'
});

/**
 * Aliased physics scenarios to OFFLINE_FIXTURES for cross-seat audit compatibility.
 */
export const PHYSICS_SCENARIOS = OFFLINE_FIXTURES;

/**
 * Evaluates terrestrial / robotic kinematic proposals with 9-parameter physical schema:
 * { id, title, massKg, velocityMps, stopDistanceM, frictionMu, maxSafeBrakeForceN, thrustN, structuralLimitN }
 */
export function evaluateKinematicProposal(proposal) {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
    return {
      status: 'refused',
      code: 'INVALID_PROPOSAL_SHAPE',
      reason: 'Proposal must be a non-null object'
    };
  }

  const {
    massKg,
    velocityMps,
    stopDistanceM,
    frictionMu = 0.8,
    maxSafeBrakeForceN = 15000,
    thrustN = 0,
    structuralLimitN = 25000
  } = proposal;

  const numFields = { massKg, velocityMps, stopDistanceM, frictionMu, maxSafeBrakeForceN, thrustN, structuralLimitN };
  for (const [key, val] of Object.entries(numFields)) {
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      return {
        status: 'refused',
        code: 'NUMERICAL_INSTABILITY',
        field: key,
        reason: `Value for ${key} must be a finite number`
      };
    }
  }

  if (massKg <= 0) {
    return { status: 'refused', code: 'NUMERICAL_INSTABILITY', field: 'massKg', reason: 'massKg must be positive' };
  }
  if (velocityMps < 0) {
    return { status: 'refused', code: 'NUMERICAL_INSTABILITY', field: 'velocityMps', reason: 'velocityMps cannot be negative' };
  }
  if (stopDistanceM <= 0) {
    return { status: 'refused', code: 'NUMERICAL_INSTABILITY', field: 'stopDistanceM', reason: 'stopDistanceM must be positive' };
  }
  if (frictionMu <= 0) {
    return { status: 'refused', code: 'NUMERICAL_INSTABILITY', field: 'frictionMu', reason: 'frictionMu must be positive' };
  }
  if (maxSafeBrakeForceN <= 0) {
    return { status: 'refused', code: 'NUMERICAL_INSTABILITY', field: 'maxSafeBrakeForceN', reason: 'maxSafeBrakeForceN must be positive' };
  }
  if (thrustN < 0) {
    return { status: 'refused', code: 'NUMERICAL_INSTABILITY', field: 'thrustN', reason: 'thrustN cannot be negative' };
  }
  if (structuralLimitN <= 0) {
    return { status: 'refused', code: 'NUMERICAL_INSTABILITY', field: 'structuralLimitN', reason: 'structuralLimitN must be positive' };
  }

  // Kinematic calculations
  const a_stop = (velocityMps * velocityMps) / (2.0 * stopDistanceM);
  const F_brake_req = massKg * a_stop;
  const F_fric_max = frictionMu * massKg * 9.80665;
  const F_total = F_brake_req + thrustN;
  const kineticEnergyJ = 0.5 * massKg * velocityMps * velocityMps;

  // Invariant 1: Surface Friction Limit (skid prevention)
  if (F_brake_req > F_fric_max + 1e-6) {
    return {
      status: 'refused',
      code: 'FRICTION_LIMIT_EXCEEDED',
      requiredBrakeForceN: Math.round(F_brake_req * 100) / 100,
      maxFrictionForceN: Math.round(F_fric_max * 100) / 100,
      frictionMu,
      reason: `Required braking force ${F_brake_req.toFixed(2)} N exceeds friction limit ${F_fric_max.toFixed(2)} N (skid hazard)`
    };
  }

  // Invariant 2: Brake Force Actuator Limit
  if (F_brake_req > maxSafeBrakeForceN + 1e-6) {
    return {
      status: 'refused',
      code: 'BRAKE_FORCE_EXCEEDED',
      requiredBrakeForceN: Math.round(F_brake_req * 100) / 100,
      maxSafeBrakeForceN,
      reason: `Required braking force ${F_brake_req.toFixed(2)} N exceeds maximum safe brake force rating ${maxSafeBrakeForceN} N`
    };
  }

  // Invariant 3: Structural Chassis Limit
  if (F_total > structuralLimitN + 1e-6) {
    return {
      status: 'refused',
      code: 'STRUCTURAL_LIMIT_EXCEEDED',
      totalForceN: Math.round(F_total * 100) / 100,
      structuralLimitN,
      reason: `Total mechanical force ${F_total.toFixed(2)} N exceeds structural yield limit ${structuralLimitN} N`
    };
  }

  return {
    status: 'accepted',
    state: {
      massKg,
      velocityMps,
      stopDistanceM,
      kineticEnergyJ: Math.round(kineticEnergyJ * 100) / 100,
      requiredDecelerationMps2: Math.round(a_stop * 1000) / 1000,
      requiredBrakeForceN: Math.round(F_brake_req * 100) / 100,
      maxFrictionForceN: Math.round(F_fric_max * 100) / 100,
      totalForceN: Math.round(F_total * 100) / 100
    },
    metrics: {
      kineticEnergyJ: Math.round(kineticEnergyJ * 100) / 100,
      requiredBrakeForceN: Math.round(F_brake_req * 100) / 100,
      maxFrictionForceN: Math.round(F_fric_max * 100) / 100,
      totalForceN: Math.round(F_total * 100) / 100
    }
  };
}

/**
 * Unified physics proposal evaluation router supporting both orbital and kinematic schemas.
 */
export function evaluatePhysicsProposal(stateOrProposal, maybeProposal) {
  if (maybeProposal !== undefined && maybeProposal !== null) {
    // 2-argument call: evaluatePhysicsProposal(currentState, proposal)
    if (maybeProposal && typeof maybeProposal === 'object' && (maybeProposal.deltaV_km_s !== undefined || maybeProposal.burnDuration_s !== undefined || maybeProposal.targetAltitude_km !== undefined)) {
      return validatePhysicsProposal(stateOrProposal, maybeProposal);
    }
    return evaluateKinematicProposal(maybeProposal);
  }

  // 1-argument call: evaluatePhysicsProposal(proposal)
  const proposal = stateOrProposal;
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
    return {
      status: 'refused',
      code: 'INVALID_PROPOSAL_SHAPE',
      reason: 'Proposal must be a non-null object'
    };
  }

  if (proposal.deltaV_km_s !== undefined || proposal.burnDuration_s !== undefined || proposal.targetAltitude_km !== undefined) {
    return validatePhysicsProposal({}, proposal);
  }

  return evaluateKinematicProposal(proposal);
}


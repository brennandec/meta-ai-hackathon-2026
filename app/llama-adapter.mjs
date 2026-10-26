/**
 * Clean-Room Meta Llama 3.3 / 3.1 Open Model Adapter.
 * Zero external dependencies. Zero monorepo house imports.
 * Enforces Pre-Rules Release Gate (META_OFFICIAL_RULES_VERIFIED=1) prior to live API dispatch.
 * Supports structured 9-parameter physical schema and deterministic offline replay.
 */

export const DEFAULT_LLAMA_MODEL = 'meta-llama/Llama-3.3-70B-Instruct';
export const CONFIGURABLE_LLAMA_MODELS = Object.freeze([
  'meta-llama/Llama-3.3-70B-Instruct',
  'meta-llama/Llama-3.1-405B-Instruct',
  'meta-llama/Llama-3.1-70B-Instruct',
  'meta-llama/Llama-3.1-8B-Instruct',
  'meta-muse/Muse-Spark-1.0',
  'meta-muse/Muse-Wonder-1.0',
  'meta-sam/SAM-3.1-Vision'
]);
export const META_LLAMA_ENDPOINT = 'https://api.llama.com/v1/chat/completions';

/**
 * Hard Pre-Rules Release Gate.
 * Refuses live outbound HTTP calls unless official rules verification flag is set to 1
 * and an API key is explicitly supplied in the environment.
 */
export function checkMetaRulesGate(env = (typeof process !== 'undefined' ? process.env : {})) {
  if (!env || env.META_OFFICIAL_RULES_VERIFIED !== '1' || typeof env.META_LLAMA_API_KEY !== 'string' || !env.META_LLAMA_API_KEY.trim()) {
    return {
      allowed: false,
      status: 'refused',
      code: 'META_RULES_GATE_UNVERIFIED',
      refusal: {
        status: 'refused',
        code: 'META_RULES_GATE_UNVERIFIED',
        reason: 'Live outbound Llama API requests refused: Meta Official Hackathon Rules not verified (requires META_OFFICIAL_RULES_VERIFIED=1 and META_LLAMA_API_KEY)'
      }
    };
  }
  return { allowed: true };
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
 * Extracts and sanitizes the 9-parameter physical proposal from raw text or structured objects.
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
      // Fallback regex attempt for unclosed json
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

  const requiredFields = [
    'massKg',
    'velocityMps',
    'stopDistanceM',
    'frictionMu',
    'maxSafeBrakeForceN',
    'thrustN',
    'structuralLimitN'
  ];

  for (const field of requiredFields) {
    if (typeof raw[field] !== 'number' || !Number.isFinite(raw[field])) {
      return {
        status: 'refused',
        code: 'NUMERICAL_INSTABILITY',
        field,
        reason: `Required numeric field ${field} is missing or non-finite`
      };
    }
  }

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : 'llama-proposal',
    title: typeof raw.title === 'string' && raw.title ? raw.title.slice(0, 128) : 'Physical Deceleration Proposal',
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
 * Deterministic offline simulation fixtures for local testing and offline replay.
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
      maxSafeBrakeForceN: 4000.0,
      thrustN: 0.0,
      structuralLimitN: 8000.0
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
      frictionMu: 0.6,
      maxSafeBrakeForceN: 8000.0,
      thrustN: 0.0,
      structuralLimitN: 12000.0
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
      velocityMps: 8.0,
      stopDistanceM: 4.0,
      frictionMu: 0.9,
      maxSafeBrakeForceN: 7000.0,
      thrustN: 0.0,
      structuralLimitN: 20000.0
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
      frictionMu: 0.9,
      maxSafeBrakeForceN: 10000.0,
      thrustN: 12000.0,
      structuralLimitN: 15000.0
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
      maxSafeBrakeForceN: 4000.0,
      thrustN: 0.0,
      structuralLimitN: 8000.0
    },
    expectedStatus: 'refused',
    expectedCode: 'NUMERICAL_INSTABILITY'
  }
});

/**
 * Requests a physical parameter proposal from Meta Llama model.
 * If offlineFixture is specified, replays offline without network access.
 * Otherwise, enforces Pre-Rules Release Gate before issuing outbound request.
 */
export async function requestLlamaPhysicsProposal({
  instruction = 'Plan deceleration maneuver',
  currentState = {},
  model = DEFAULT_LLAMA_MODEL,
  env = (typeof process !== 'undefined' ? process.env : {}),
  fetchImpl = globalThis.fetch,
  offlineFixture = null
} = {}) {
  // 1. Offline Fixture Replay
  if (offlineFixture) {
    if (typeof offlineFixture === 'string' && OFFLINE_LLAMA_FIXTURES[offlineFixture]) {
      return {
        status: 'ok',
        source: `offline_fixture:${offlineFixture}`,
        model,
        proposal: OFFLINE_LLAMA_FIXTURES[offlineFixture].proposal
      };
    }
    if (typeof offlineFixture === 'object' && offlineFixture.proposal) {
      return {
        status: 'ok',
        source: 'offline_fixture',
        model,
        proposal: offlineFixture.proposal
      };
    }
    const extracted = extractPhysicsProposal(offlineFixture);
    if (extracted.status === 'refused') {
      return extracted;
    }
    return {
      status: 'ok',
      source: 'offline_fixture',
      model,
      proposal: extracted
    };
  }

  // 2. Pre-Rules Release Gate Enforcement
  const gate = checkMetaRulesGate(env);
  if (!gate.allowed) {
    return gate.refusal;
  }

  // 3. Construct OpenAI-Compatible Request Payload
  const promptData = buildLlamaPhysicsPrompt({ instruction, currentState });
  const payload = {
    model,
    messages: promptData.messages,
    temperature: 0.1,
    max_tokens: 512,
    response_format: { type: 'json_object' }
  };

  try {
    const response = await fetchImpl(META_LLAMA_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.META_LLAMA_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return {
        status: 'refused',
        code: 'META_API_ERROR',
        httpStatus: response.status,
        reason: `Meta Llama API responded with HTTP ${response.status}`
      };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const proposal = extractPhysicsProposal(content);

    if (proposal.status === 'refused') {
      return proposal;
    }

    return {
      status: 'ok',
      source: `remote_llama:${model}`,
      model,
      proposal
    };
  } catch (err) {
    return {
      status: 'refused',
      code: 'NETWORK_ERROR',
      reason: 'Failed to communicate with Meta Llama endpoint: ' + err.message
    };
  }
}

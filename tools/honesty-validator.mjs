#!/usr/bin/env node
// (note removed for export)
// Recursive record-honesty validator for run records.
// CLI: node tools/honesty-validator.mjs <record.json> [--ledger <receipts.jsonl>] [--events <events.jsonl>] [--packet <packet.json>]
// Exit 0 pass (warnings to stdout), 1 violations (each with JSON path), 2 error.
// Importable: validateRecord(obj, opts) -> {pass, genuine, violations[], warnings[], ...}.
// Values: split into tokens on separators and camelCase, case-folded; a token containing live or confirmed trips,
// negation never exempts (not_live, NEVER_LIVE, notlive trip). Innocent only: the exact tokens in INNOCENT_TOKENS
// and the intent mechanism name read from the packet's liveRunIntentContract (basename of intentDocumentPath).
// Keys: rev 4 rules (whole-word family and the two substring tokens always trip; glued family keys trip on truthy values).
// Genuine records bind to the door's real shape read from the packet contract: the open receipt (kind, subject,
// (note removed for export)
// command carries the intent document path and its sha256 (content_sha256 is not the file sha), plus runId equality.
import { closeSync, existsSync, openSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_WORDS = new Set(['live', 'confirmed']);
const FAMILY = ['live', 'confirmed'];
const SUB_TOKENS = ['livemetaapi', 'providerreported'];
export const INNOCENT_TOKENS = new Set(['unconfirmed', 'deliver', 'delivers', 'delivered', 'delivering', 'delivery', 'deliveries', 'deliverable', 'deliverables', 'alive', 'olive', 'olives', 'oblivion', 'oblivious', 'sliver', 'slivers']);
const REFUSED_STATUSES = new Set(['CONFIRMED', 'PROVIDER_REPORTED']);
const SYNTHETIC_ID_RE = /^(synth|mock|fixture|test|fake)/i;
const RCPT_RE = /^rcpt_[0-9a-f]{8,}$/i;
const WO_RE = /^wo_[0-9a-f]{16}$/;
const RUNID_RE = /^run_[0-9a-f]{32}$/;
const YES_STRINGS = new Set(['yes', 'y', 'true', 'verified']);
const NEG_STRINGS = new Set(['no', 'n', 'none', 'nope', 'zero', 'false', 'off', 'n/a', 'na', 'nil', 'null', 'undefined', 'never', 'empty', 'unconfirmed', 'unverified', 'pending']);
const CONTRACT_FIELDS = [
  ['intentDocumentPath'],
  ['doorReceiptShape', 'openReceipt', 'kind'],
  ['doorReceiptShape', 'openReceipt', 'subject'],
  ['doorReceiptShape', 'wardenReceipt', 'kind'],
  ['doorReceiptShape', 'wardenReceipt', 'subject'],
  ['doorReceiptShape', 'wardenReceipt', 'author'],
  ['doorReceiptShape', 'woVerifiedEventShape', 'type'],
  ['doorReceiptShape', 'woVerifiedEventShape', 'author'],
  ['recordBinding', 'recordRunIdField'],
  ['recordBinding', 'recordIntentReceiptField'],
];

function normalise(s) { return String(s).toLowerCase().replace(/[_-]+/g, ''); }
function wordsOf(s) { return normalise(s).split(/[^a-z0-9]+/).filter(Boolean); }
function joinedOf(s) { return normalise(s).replace(/[^a-z0-9]+/g, ''); }
function str(v) { return typeof v === 'string' ? v.trim() : ''; }
function keyExempt(nk) {
  return nk.includes('intent') || nk.includes('contract') || nk.includes('receipt') || nk.includes('remain') || nk.startsWith('max');
}
const at = (obj, parts) => parts.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);

export function tokensOf(s) {
  return String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function attemptTruthy(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (t === '') return false;
    if (YES_STRINGS.has(t)) return true;
    if (NEG_STRINGS.has(t)) return false;
    if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(t)) return Number(t) !== 0;
    if (/[0-9]/.test(t)) return true;
    return false;
  }
  if (Array.isArray(v)) return v.length > 0;
  if (v !== null && typeof v === 'object') return true;
  return false;
}

export function contractFrom(c) {
  if (!c || typeof c !== 'object') return { error: 'liveRunIntentContract missing' };
  for (const p of CONTRACT_FIELDS) {
    const v = at(c, p);
    if (typeof v !== 'string' || !v) return { error: 'liveRunIntentContract field missing: ' + p.join('.') };
  }
  return { contract: c };
}

export function defaultPacketPath() {
  return resolve(HERE, '..', 'DEPENDENCY-CONTRACT.json');
}

const CONTRACT_CACHE = new Map();
export function loadContract(packetPath = defaultPacketPath()) {
  let st;
  try { st = statSync(packetPath); } catch { return { error: 'packet unavailable: ' + packetPath }; }
  if (!st.isFile()) return { error: 'packet is not a file: ' + packetPath };
  const key = packetPath + '\n' + st.size + '\n' + st.mtimeMs;
  if (CONTRACT_CACHE.has(key)) return CONTRACT_CACHE.get(key);
  let res;
  try { res = contractFrom(JSON.parse(readFileSync(packetPath, 'utf8')).liveRunIntentContract); }
  catch (e) { res = { error: 'packet unreadable: ' + e.message }; }
  CONTRACT_CACHE.set(key, res);
  return res;
}

export function mechanismStems(contract) {
  if (!contract) return [];
  const toks = tokensOf(basename(contract.intentDocumentPath).replace(/\.[^.]+$/, ''));
  return toks.length ? [toks] : [];
}

export function familyHits(value, stems = []) {
  const toks = tokensOf(value);
  const kept = [];
  for (let i = 0; i < toks.length;) {
    const stem = stems.find((st) => st.every((t, k) => toks[i + k] === t));
    if (stem) { i += stem.length; continue; }
    kept.push(toks[i]);
    i += 1;
  }
  const glued = stems.map((st) => st.join(''));
  const hits = [];
  for (const tok of kept) {
    let t = tok;
    for (const g of glued) t = t.split(g).join(' ');
    for (const part of t.split(' ')) {
      if (!part || INNOCENT_TOKENS.has(part)) continue;
      if (FAMILY.some((w) => part.includes(w))) hits.push(part);
    }
  }
  return [...new Set(hits)];
}

function genericMarks(value, stems) {
  const marks = [];
  if (typeof value !== 'string') return marks;
  for (const hit of familyHits(value, stems)) marks.push('live-family:' + hit);
  const joined = joinedOf(value);
  for (const tok of SUB_TOKENS) {
    if (joined.includes(tok)) marks.push('live-sub:' + tok);
  }
  if (/\bP1\b/.test(value)) marks.push('P1-mark');
  return [...new Set(marks)];
}

function collectNodes(node, path, out) {
  out.push({ path, node });
  if (Array.isArray(node)) node.forEach((v, i) => collectNodes(v, path + '[' + i + ']', out));
  else if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) collectNodes(node[k], path + '.' + k, out);
  }
  return out;
}

export function defaultLedgerPath() {
  return resolve(HERE, '..', 'house-only', 'receipts.jsonl');
}

export function findRepoRoot(from) {
  let d = resolve(from);
  for (;;) {
    if (existsSync(join(d, '_system', 'ledger', 'receipts.jsonl'))) return d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

function fileState(p) {
  let st;
  try { st = statSync(p); } catch { return 'unavailable: ' + p; }
  if (st.isDirectory()) return 'is a directory, refusing: ' + p;
  if (!st.isFile()) return 'not a file, refusing: ' + p;
  return null;
}

export function scanLines(file, needle, onEntry) {
  const bad = fileState(file);
  if (bad) return { error: bad };
  const want = Buffer.from(needle);
  const fd = openSync(file, 'r');
  const buf = Buffer.allocUnsafe(1 << 22);
  let stopped = false;
  const search = (body) => {
    let i = body.indexOf(want);
    while (i >= 0 && !stopped) {
      const s = body.lastIndexOf(10, i) + 1;
      let e = body.indexOf(10, i); if (e < 0) e = body.length;
      let entry = null;
      try { entry = JSON.parse(body.toString('utf8', s, e)); } catch { entry = null; }
      if (entry && onEntry(entry) === false) stopped = true;
      i = body.indexOf(want, e);
    }
  };
  try {
    let carry = Buffer.alloc(0);
    let n;
    while (!stopped && (n = readSync(fd, buf, 0, buf.length, null)) > 0) {
      const chunk = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      const nl = chunk.lastIndexOf(10);
      if (nl < 0) { carry = Buffer.from(chunk); continue; }
      search(chunk.subarray(0, nl + 1));
      carry = Buffer.from(chunk.subarray(nl + 1));
    }
    if (!stopped && carry.length) search(carry);
  } finally {
    closeSync(fd);
  }
  return {};
}

export function findLedgerEntry(ledgerPath, id) {
  let found = null;
  const r = scanLines(ledgerPath, '"' + id + '"', (e) => { if (e.id === id) { found = e; return false; } return true; });
  if (r.error) return { error: r.error };
  return found ? { entry: found } : { error: 'not found: ' + id };
}

function sha256Bytes(b) { return createHash('sha256').update(b).digest('hex'); }

function sourceOf(entries, file, needle) {
  if (entries) {
    const list = entries instanceof Map ? [...entries.values()] : entries;
    return { entries: list.filter((e) => e && JSON.stringify(e).includes(needle)) };
  }
  const out = [];
  const r = scanLines(file, needle, (e) => { out.push(e); return true; });
  return r.error ? { error: r.error } : { entries: out };
}

function doorChain(entry, docAbs, sha, contract, opts) {
  const W = contract.doorReceiptShape.wardenReceipt;
  const V = contract.doorReceiptShape.woVerifiedEventShape;
  const receipts = sourceOf(opts.ledgerEntries, opts.ledgerPath, entry.id);
  if (receipts.error) return [{ field: 'door-verifier', detail: 'receipts ' + receipts.error }];
  const wardens = receipts.entries.filter((r) => r.id !== entry.id && r.kind === W.kind && r.subject === W.subject
    && r.author === W.author && Array.isArray(r.refs) && r.refs.includes(entry.id) && r.refs.some((x) => WO_RE.test(x)));
  if (!wardens.length) return [{ field: 'door-verifier', detail: 'no door-verifier receipt refs the open receipt and a wo_' }];
  let last = [{ field: 'wo.verified', detail: 'no wo.verified event for the door-verifier receipt' }];
  for (const wr of wardens) {
    const wo = wr.refs.find((x) => WO_RE.test(x));
    const events = sourceOf(opts.eventEntries, opts.eventsPath, wo);
    if (events.error) return [{ field: 'wo.verified', detail: 'events ' + events.error }];
    const verified = events.entries.filter((e) => e.type === V.type && e.author === V.author && e.receipt_id === wr.id
      && e.payload && e.payload.wo === wo && Array.isArray(e.payload.results) && e.payload.results.length > 0
      && e.payload.results.every((x) => x && x.pass === true));
    if (!verified.length) continue;
    const carries = verified.some((e) => e.payload.results.some((x) => typeof x.cmd === 'string' && x.cmd.includes(sha) && x.cmd.includes(docAbs)));
    if (carries) return [];
    last = [{ field: 'sha', detail: 'the wo.verified command does not carry the intent document path and its sha256' }];
  }
  return last;
}

function fieldAt(record, dotted) {
  return typeof dotted === 'string' && dotted ? at(record, dotted.split('.')) : undefined;
}

export function checkBinding(entry, record, opts = {}) {
  const contract = opts.contract;
  if (!contract) return { bound: false, failures: [{ field: 'contract', detail: opts.contractError || 'liveRunIntentContract unavailable' }] };
  if (!entry || typeof entry !== 'object') return { bound: false, failures: [{ field: 'not found', detail: 'no ledger entry for the claimed receipt' }] };
  const O = contract.doorReceiptShape.openReceipt;
  const rel = contract.intentDocumentPath;
  const failures = [];
  if (entry.kind !== O.kind) failures.push({ field: 'kind', detail: `kind ${JSON.stringify(entry.kind)} is not ${JSON.stringify(O.kind)}` });
  if (entry.subject !== O.subject) failures.push({ field: 'subject', detail: 'subject is not the launcher intent title' });
  const refs = (Array.isArray(entry.refs) ? entry.refs : []).filter((r) => typeof r === 'string' && r);
  const repoRoot = opts.repoRoot || (opts.ledgerPath ? findRepoRoot(dirname(opts.ledgerPath)) : null);
  const candidates = [];
  for (const ref of refs) {
    if (isAbsolute(ref)) candidates.push(ref);
    else if (O.refsAreAbsolute !== true && repoRoot) candidates.push(resolve(repoRoot, ref));
  }
  const existing = candidates
    .filter((p) => p === rel || p.endsWith('/' + rel))
    .filter((p) => { try { return statSync(p).isFile(); } catch { return false; } });
  if (!existing.length) {
    failures.push({ field: 'refs', detail: 'no absolute ref targets the intent document path' });
    return { bound: false, failures };
  }
  const docAbs = existing[0];
  let bytes = null;
  try { bytes = readFileSync(docAbs); } catch { bytes = null; }
  if (!bytes) {
    failures.push({ field: 'sha', detail: 'intent document unreadable' });
    return { bound: false, failures };
  }
  const sha = sha256Bytes(bytes);
  if (O.contentSha256IsNotFileSha === true) {
    failures.push(...doorChain(entry, docAbs, sha, contract, opts));
  } else if (entry.content_sha256 !== sha && entry.sha256 !== sha) {
    failures.push({ field: 'sha', detail: 'receipt sha256 does not match the document on disk' });
  }
  let doc = null;
  try { doc = JSON.parse(bytes.toString('utf8')); } catch { doc = null; }
  const B = contract.recordBinding;
  const runId = fieldAt(record, B.recordRunIdField);
  const nested = fieldAt(record, B.nestedRunRecordRunIdField);
  if (typeof runId !== 'string' || !RUNID_RE.test(runId)) {
    failures.push({ field: 'runId', detail: 'record carries no well-formed runId' });
  } else if (!doc || typeof doc.runId !== 'string' || !RUNID_RE.test(doc.runId)) {
    failures.push({ field: 'runId', detail: 'intent document carries no well-formed runId' });
  } else if (doc.runId !== runId) {
    failures.push({ field: 'runId', detail: 'document runId does not equal the record runId' });
  } else if (nested !== undefined && nested !== runId) {
    failures.push({ field: 'runId', detail: 'nested runRecord runId does not equal the record runId' });
  }
  return failures.length ? { bound: false, failures } : { bound: true, failures: [] };
}

function resolveContract(opts) {
  if (Object.prototype.hasOwnProperty.call(opts, 'contract')) {
    return opts.contract ? contractFrom(opts.contract) : { error: 'liveRunIntentContract not supplied' };
  }
  return loadContract(opts.packetPath || defaultPacketPath());
}

export function validateRecord(input, opts = {}) {
  const violations = [];
  const warnings = [];
  if (!input || typeof input !== 'object') throw new Error('record must be an object or array');
  const nodes = collectNodes(input, '$', []);
  if (nodes.length <= 1) warnings.push('empty record: nothing to validate');
  const cres = resolveContract(opts);
  const contract = cres.contract || null;
  const stems = mechanismStems(contract);
  const intentKeys = new Set(contract
    ? [contract.recordBinding.recordIntentReceiptField, String(contract.recordBinding.nestedRunRecordIntentReceiptField || '').split('.').pop()].filter(Boolean).map(normalise)
    : ['liverunintent', 'liverunintentreceipt']);

  let realResponseId = null;
  let intentReceipt = null;
  for (const { path, node } of nodes) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    for (const k of Object.keys(node)) {
      const fk = normalise(k);
      if (fk === 'providerresponseid' && typeof node[k] === 'string') {
        const v = node[k].trim();
        if (v && !SYNTHETIC_ID_RE.test(v)) realResponseId = { path: path + '.' + k, value: v };
      }
      if (intentKeys.has(fk) && typeof node[k] === 'string' && RCPT_RE.test(node[k].trim())) {
        intentReceipt = { path: path + '.' + k, value: node[k].trim() };
      }
    }
  }
  let genuine = false;
  if (realResponseId && intentReceipt) {
    const ledgerPath = opts.ledgerPath || defaultLedgerPath();
    const eventsPath = opts.eventsPath || join(dirname(ledgerPath), 'events.jsonl');
    let entry = null;
    let entryError = null;
    if (opts.ledgerEntries) {
      const map = opts.ledgerEntries instanceof Map ? opts.ledgerEntries : new Map((opts.ledgerEntries || []).map((e) => [e && e.id, e]));
      entry = map.get(intentReceipt.value) || null;
      if (!entry) entryError = 'not found: ' + intentReceipt.value;
    } else if (contract) {
      const found = findLedgerEntry(ledgerPath, intentReceipt.value);
      if (found.entry) entry = found.entry;
      else entryError = found.error;
    }
    if (!contract) warnings.push('intent contract ' + cres.error + '; genuine claim unverified');
    if (entryError && entryError !== 'not found: ' + intentReceipt.value) {
      warnings.push('intent ledger ' + entryError + '; genuine claim unverified');
    }
    const check = !contract
      ? checkBinding(null, input, { contract: null, contractError: cres.error })
      : entry
        ? checkBinding(entry, input, { contract, ledgerPath, eventsPath, repoRoot: opts.repoRoot, ledgerEntries: opts.ledgerEntries, eventEntries: opts.eventEntries })
        : { bound: false, failures: [{ field: 'not found', detail: entryError || 'no ledger entry for the claimed receipt' }] };
    genuine = check.bound;
    if (!genuine) {
      for (const f of check.failures) {
        violations.push({ path: intentReceipt.path, rule: 'intent-unresolved', found: f.field + ': ' + f.detail });
      }
    }
  }

  for (const { path, node } of nodes) {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const k of Object.keys(node)) {
        const v = node[k];
        const p = path + '.' + k;
        const fk = normalise(k);
        const kwords = wordsOf(k);
        const kj = joinedOf(k);
        if (kwords.some((w) => SUB_TOKENS.some((t) => w.includes(t))) || SUB_TOKENS.some((t) => kj.includes(t))) {
          violations.push({ path: p, rule: 'live-key', found: k });
        } else if (kwords.some((w) => LIVE_WORDS.has(w))) {
          violations.push({ path: p, rule: 'live-key', found: k });
        } else if ((fk.includes('live') || fk.includes('confirmed')) && !keyExempt(fk) && attemptTruthy(v)) {
          const rule = fk === 'liveattemptsused' ? 'liveAttemptsUsed' : fk === 'modelidentityconfirmed' ? 'modelIdentityConfirmed' : 'live-key-value';
          violations.push({ path: p, rule, found: v });
        }
        if (fk === 'fixturemode' && str(v).toUpperCase() === 'LIVE_META_API') {
          violations.push({ path: p, rule: 'fixtureMode', found: v });
        }
        if (/status$/.test(fk) && typeof v === 'string' && REFUSED_STATUSES.has(v.trim().toUpperCase())) {
          violations.push({ path: p, rule: 'status', found: v });
        }
        if (fk === 'keystate' && str(v).toLowerCase() === 'ready') {
          violations.push({ path: p, rule: 'keyState', found: v });
        }
        if (typeof v === 'string' && REFUSED_STATUSES.has(v.trim().toUpperCase()) && !/status$/.test(fk)) {
          violations.push({ path: p, rule: 'confirmed-value', found: v });
        }
      }
    }
    if (typeof node === 'string') {
      for (const mark of genericMarks(node, stems)) violations.push({ path, rule: 'mark-scan', found: mark + ' in ' + JSON.stringify(node.slice(0, 80)) });
    }
  }

  if (!contract && violations.length && !warnings.some((w) => w.startsWith('intent contract'))) {
    warnings.push('intent contract ' + cres.error + '; the intent mechanism name is not exempt');
  }
  if (genuine) return { pass: true, genuine: true, violations: [], warnings, waived: violations, realResponseId, intentReceipt };
  return { pass: violations.length === 0, genuine: false, violations, warnings };
}

function main() {
  const argv = process.argv.slice(2);
  const file = argv[0];
  const flag = (f) => { const i = argv.indexOf(f); return i < 0 ? undefined : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null); };
  const ledgerPath = flag('--ledger');
  const eventsPath = flag('--events');
  const packetPath = flag('--packet');
  if (!file || file.startsWith('--') || ledgerPath === null || eventsPath === null || packetPath === null) {
    console.error('usage: honesty-validator.mjs <record.json> [--ledger <receipts.jsonl>] [--events <events.jsonl>] [--packet <packet.json>]');
    process.exit(2);
  }
  let rec;
  try {
    rec = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('HONESTY ERROR: cannot parse ' + file + ': ' + e.message);
    process.exit(2);
  }
  const opts = {};
  if (ledgerPath) opts.ledgerPath = ledgerPath;
  if (eventsPath) opts.eventsPath = eventsPath;
  if (packetPath) opts.packetPath = packetPath;
  let r;
  try {
    r = validateRecord(rec, opts);
  } catch (e) {
    console.error('HONESTY ERROR: ' + e.message);
    process.exit(2);
  }
  for (const w of r.warnings) console.log('WARNING: ' + w);
  if (r.genuine) {
    console.log('HONESTY PASS (genuine: ' + r.realResponseId.value + ' + ' + r.intentReceipt.value + ')');
    process.exit(0);
  }
  if (!r.pass) {
    for (const v of r.violations) console.log('VIOLATION ' + v.path + ' [' + v.rule + '] ' + JSON.stringify(v.found));
    console.log('HONESTY FAIL: ' + r.violations.length + ' violation(s)');
    process.exit(1);
  }
  console.log('HONESTY PASS');
}

const invokedDirectly = (() => {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return false; }
})();
if (invokedDirectly) main();

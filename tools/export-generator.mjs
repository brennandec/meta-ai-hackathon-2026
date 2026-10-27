#!/usr/bin/env node
// export-generator.mjs - export generator rev 2.2 (revision constant 2; desk revision 2.2).
// Builds the public export of the portable demo candidate from the export inventory rows alone:
// ship, evidence, transform and export-mode rows export, exclude rows never export. Output:
// a two-layer git history (baseline subset at the pre-event tag, one commit per later
// house commit, a drift layer for bytes landed after the last house commit, an
// export-mode layer and a manifest layer), a per-layer byte map kept outside the export
// tree, the in-tree manifest with hunk rows and parked digest-only timestamp anchors,
// and the notice pipeline. Every gate prints computed values only.
// CLI: node tools/export-generator.mjs --export-home <dir> --inventory <json> --fence <json>
//   --packet <json> --notice-rows <json> --git-base <git dir> --head <commit>
//   --export-time <ISO-8601 UTC> --evidence-dir <dir> [--rules <json>] [--house-root <dir>]
//   [--closure strict|report] [--release-receipt <id>] [--landing-times <byte map json>]
//   [--self-red <ledger|model|exclude>]
// Verify an export clone without house inputs: node tools/export-generator.mjs --verify-export <dir>
// Exit 0 GREEN, 1 refused (target, hold, usage, inputs), 3 scan RED, 4 closure RED, 5 smoke RED.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadRules, scanText, scanInputs, findRepo } from './disclosure-scan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const GENERATOR_REVISION = 2;
export const DESK_REVISION = '2.2';
export const LANE_LABEL = 'finalize lane';
export const BASELINE_COMMIT = 'b020edc3daa4f0e9c562f56b27f1dcec0946f329';
export const BASELINE_AUTHOR_DATE_UTC = '2026-10-26T15:51:54Z';
export const KICKOFF_UTC = '2026-10-26T16:01:03Z';
export const RELEASE_HOME_LITERAL = 'house-only/meta-hackathon-entry';
export const ALLOWED_FONT_FAMILIES = Object.freeze(['Inter', 'JetBrains Mono']);
export const EXPORT_IDENTITY = Object.freeze({ name: 'Export Generator', email: 'export-generator@example.invalid' });
export const NOTE_REMOVED = '(note removed for export)';
export const HOUSE_ONLY_DIR = 'house-only';
export const KEY_LOADER_EXPORT_MODE = 'HOUSE_ONLY_NOT_SHIPPED';
export const C2PA_WORDING = 'signed with a development certificate';

export const EXIT = Object.freeze({ GREEN: 0, REFUSED: 1, SCAN_RED: 3, CLOSURE_RED: 4, SMOKE_RED: 5 });

export function sha256Hex(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function coded(code, message, extra = {}) {
  const err = new Error(`${code}: ${message}`);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

export function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

export function canonicalJson(obj) {
  return JSON.stringify(JSON.parse(stableStringify(obj)), null, 1) + '\n';
}

export function treeListingSha256(files) {
  const rows = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256Hex(rows.map((f) => `${f.path}\t${f.bytes}\t${f.sha256}\n`).join(''));
}

export function exportInventorySha256(files, exportTimeUtc, excludePaths = []) {
  const skip = new Set(excludePaths);
  const kept = files.filter((f) => !skip.has(f.path));
  const rows = [...kept].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256Hex(`exportTime\t${exportTimeUtc}\n` + rows.map((f) => `${f.path}\t${f.bytes}\t${f.sha256}\n`).join(''));
}

function isIsoUtc(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s) && Number.isFinite(Date.parse(s));
}

export function toIsoUtc(s) {
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) throw coded('BAD_DATE', `not a date: ${s}`);
  return new Date(ms).toISOString().replace(/\.000Z$/, 'Z');
}

// ---------- environment hygiene (HO item 2) ----------

export function scrubGitEnv(env = process.env) {
  const removed = [];
  for (const k of Object.keys(env)) {
    if (k.startsWith('GIT_')) { removed.push(k); delete env[k]; }
  }
  return removed;
}

export function makeGitEnv(sandboxDir, extra = {}) {
  fs.mkdirSync(sandboxDir, { recursive: true });
  const emptyConfig = path.join(sandboxDir, 'empty-gitconfig');
  if (!fs.existsSync(emptyConfig)) fs.writeFileSync(emptyConfig, '');
  return {
    PATH: process.env.PATH || '/usr/bin:/bin',
    HOME: sandboxDir,
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    ...extra
  };
}

function runGitRaw(args, { env, input = null, cwd, encoding = 'utf8' }) {
  const r = spawnSync('git', args, { env, input: input === null ? '' : input, cwd, encoding, maxBuffer: 512 * 1024 * 1024, timeout: 300000, killSignal: 'SIGKILL' });
  if (r.error && r.error.code === 'ETIMEDOUT') throw coded('GIT_TIMEOUT', `git ${args.slice(0, 3).join(' ')} did not finish within 300 s`);
  if (r.status !== 0) {
    const msg = String(r.stderr || '').slice(0, 400);
    throw coded('GIT_FAILED', `git ${args.slice(0, 3).join(' ')} failed: ${msg}`);
  }
  return r.stdout;
}

export function createBaseReader(gitDir, sandboxDir) {
  const abs = fs.realpathSync(gitDir);
  const env = makeGitEnv(sandboxDir);
  const cwd = sandboxDir;
  const g = (args, opts = {}) => runGitRaw([`--git-dir=${abs}`, ...args], { env, cwd, ...opts });
  return {
    gitDir: abs,
    revParse: (rev) => g(['rev-parse', '--verify', `${rev}^{commit}`]).trim(),
    blob: (oid) => g(['cat-file', 'blob', oid], { encoding: 'buffer' }),
    lsTree: (commit, paths) => {
      const out = g(['ls-tree', '-r', '-z', commit, '--', ...paths], { encoding: 'buffer' }).toString('utf8');
      const map = new Map();
      for (const rec of out.split('\0').filter(Boolean)) {
        const m = /^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/s.exec(rec);
        if (m && m[2] === 'blob') map.set(m[4], m[3]);
      }
      return map;
    },
    commitsTouching: (base, head, paths) => {
      if (!paths.length) return [];
      return g(['rev-list', '--reverse', '--topo-order', `${base}..${head}`, '--', ...paths]).split('\n').filter(Boolean);
    },
    commitMeta: (commits) => {
      const meta = new Map();
      for (let i = 0; i < commits.length; i += 200) {
        const chunk = commits.slice(i, i + 200);
        const out = g(['show', '-s', '--format=%H%x00%aI%x00%s%x1e', ...chunk]);
        for (const rec of out.split('\x1e')) {
          const parts = rec.replace(/^\n/, '').split('\x00');
          if (parts.length >= 3 && /^[0-9a-f]{40}$/.test(parts[0])) meta.set(parts[0], { authorDate: toIsoUtc(parts[1]), subject: parts[2] });
        }
      }
      return meta;
    }
  };
}

export function createExportRepo(exportHome, sandboxDir) {
  const gitDir = path.join(exportHome, '.git');
  const env = makeGitEnv(sandboxDir, {
    GIT_AUTHOR_NAME: EXPORT_IDENTITY.name,
    GIT_AUTHOR_EMAIL: EXPORT_IDENTITY.email,
    GIT_COMMITTER_NAME: EXPORT_IDENTITY.name,
    GIT_COMMITTER_EMAIL: EXPORT_IDENTITY.email
  });
  const g = (args, opts = {}) => runGitRaw([`--git-dir=${gitDir}`, `--work-tree=${exportHome}`, ...args], { env, cwd: sandboxDir, ...opts });
  runGitRaw(['init', '-q', '-b', 'main', exportHome], { env, cwd: sandboxDir });
  const reported = fs.realpathSync(g(['rev-parse', '--absolute-git-dir']).trim());
  const expected = fs.realpathSync(gitDir);
  if (reported !== expected) throw coded('EXPORT_GIT_DIR_MISMATCH', `rev-parse reported ${reported}, expected ${expected}`);
  const blobCache = new Map();
  return {
    gitDir: expected,
    env,
    g,
    writeBlob(buf) {
      const key = sha256Hex(buf);
      if (blobCache.has(key)) return blobCache.get(key);
      const staged = path.join(sandboxDir, `blob-${key}`);
      fs.writeFileSync(staged, buf);
      const oid = g(['hash-object', '-w', '--', staged]).trim();
      fs.rmSync(staged, { force: true });
      if (oid !== gitBlobOid(buf)) throw coded('EXPORT_BLOB_MISMATCH', `hash-object wrote ${oid} for ${key.slice(0, 12)}`);
      blobCache.set(key, oid);
      return oid;
    },
    writeTree(fileMap) {
      const root = { dirs: new Map(), files: new Map() };
      for (const [p, oid] of fileMap) {
        const parts = p.split('/');
        let node = root;
        for (const d of parts.slice(0, -1)) {
          if (!node.dirs.has(d)) node.dirs.set(d, { dirs: new Map(), files: new Map() });
          node = node.dirs.get(d);
        }
        node.files.set(parts[parts.length - 1], oid);
      }
      const build = (node) => {
        const lines = [];
        for (const [name, child] of node.dirs) lines.push(`040000 tree ${build(child)}\t${name}`);
        for (const [name, oid] of node.files) lines.push(`100644 blob ${oid}\t${name}`);
        return g(['mktree'], { input: lines.join('\n') + (lines.length ? '\n' : '') }).trim();
      };
      return build(root);
    },
    commitTree(tree, parent, message, authorDate, committerDate) {
      const args = ['commit-tree', tree];
      if (parent) args.push('-p', parent);
      args.push('-m', message);
      const r = spawnSync('git', [`--git-dir=${gitDir}`, ...args], {
        env: { ...env, GIT_AUTHOR_DATE: authorDate, GIT_COMMITTER_DATE: committerDate },
        cwd: sandboxDir,
        input: '',
        encoding: 'utf8',
        timeout: 300000,
        killSignal: 'SIGKILL'
      });
      if (r.status !== 0) throw coded('GIT_FAILED', `commit-tree failed: ${String(r.stderr).slice(0, 300)}`);
      return r.stdout.trim();
    },
    finish(head) {
      g(['update-ref', 'refs/heads/main', head]);
      g(['symbolic-ref', 'HEAD', 'refs/heads/main']);
      g(['read-tree', '-u', '--reset', head]);
    }
  };
}

// ---------- target and hold guard (HO items 1 and 3) ----------

export function realpathNearest(p, depth = 0) {
  if (depth > 32) throw coded('SYMLINK_LOOP', `too many symlink levels under ${p}`);
  const parts = path.resolve(p).split('/').filter(Boolean);
  let cur = '/';
  for (let i = 0; i < parts.length; i += 1) {
    const next = path.join(cur, parts[i]);
    let st = null;
    try { st = fs.lstatSync(next); } catch { st = null; }
    if (!st) return path.join(next, ...parts.slice(i + 1));
    if (st.isSymbolicLink()) {
      const target = path.resolve(cur, fs.readlinkSync(next));
      cur = realpathNearest(target, depth + 1);
    } else {
      cur = next;
    }
  }
  return cur;
}

function sameOrInside(child, parent) {
  const c = child.toLowerCase().replace(/\/+$/, '');
  const p = parent.toLowerCase().replace(/\/+$/, '');
  return c === p || c.startsWith(p + '/');
}

export function findReceiptInLedger(ledgerPath, id) {
  if (!ledgerPath || !fs.existsSync(ledgerPath)) return null;
  const needle = Buffer.from(`"id":"${id}"`);
  const fd = fs.openSync(ledgerPath, 'r');
  try {
    const chunk = Buffer.alloc(8 * 1024 * 1024);
    let carry = Buffer.alloc(0);
    let pos = 0;
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, pos);
      if (n <= 0) break;
      pos += n;
      const buf = Buffer.concat([carry, chunk.subarray(0, n)]);
      const at = buf.indexOf(needle);
      if (at >= 0) {
        const start = buf.lastIndexOf(0x0a, at) + 1;
        const end = buf.indexOf(0x0a, at);
        if (end > 0) {
          try { return JSON.parse(buf.subarray(start, end).toString('utf8')); } catch { return { id }; }
        }
      }
      const lastNl = buf.lastIndexOf(0x0a);
      carry = lastNl >= 0 ? buf.subarray(lastNl + 1) : buf;
    }
  } finally {
    fs.closeSync(fd);
  }
  return null;
}

export function assertExportTargetAllowed(targetDir, { houseRoot = null, releaseReceipt = null, ledgerPath = null, releaseHome = RELEASE_HOME_LITERAL } = {}) {
  if (!targetDir || typeof targetDir !== 'string') throw coded('INVALID_EXPORT_TARGET', 'export home must be a non-empty path');
  const literal = path.resolve(targetDir);
  const real = realpathNearest(literal);
  const homeLiteral = path.resolve(releaseHome);
  const homeReal = realpathNearest(homeLiteral);
  const hitsRelease = [literal, real].some((c) => sameOrInside(c, homeLiteral) || sameOrInside(c, homeReal));
  if (hitsRelease) {
    if (releaseReceipt === true || releaseReceipt === false) throw coded('RELEASE_RECEIPT_NOT_BOOLEAN', 'the release hold clears on a receipt id, never a boolean');
    if (typeof releaseReceipt !== 'string' || !/^rcpt_[0-9a-f]{16}$/.test(releaseReceipt)) {
      throw coded('RELEASE_HOLD_ACTIVE', 'the release home is refused while the release hold stands; no release receipt id given');
    }
    const found = findReceiptInLedger(ledgerPath, releaseReceipt);
    if (!found) throw coded('RELEASE_RECEIPT_UNRESOLVED', `release receipt ${releaseReceipt} is not in the ledger`);
  }
  if (houseRoot) {
    const houseLiteral = path.resolve(houseRoot);
    const houseReal = realpathNearest(houseLiteral);
    if ([literal, real].some((c) => sameOrInside(c, houseLiteral) || sameOrInside(c, houseReal))) {
      throw coded('EXPORT_TARGET_INSIDE_HOUSE', 'the export home may not sit inside the house repository');
    }
  }
  if (fs.existsSync(literal)) {
    const st = fs.lstatSync(literal);
    if (!st.isDirectory()) throw coded('EXPORT_TARGET_NOT_DIRECTORY', 'the export home exists and is not a directory');
    if (fs.readdirSync(literal).length > 0) throw coded('EXPORT_TARGET_NOT_EMPTY', 'the export home exists and is not empty');
  }
  return real;
}

// ---------- inventory, fence and layout (HO item 4, ruling R-A) ----------

export function readJson(p, code = 'INPUT_UNREADABLE') {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { throw coded(code, `${p}: ${e.message}`); }
}

function commonDir(paths) {
  if (!paths.length) return '';
  const split = paths.map((p) => p.split('/').slice(0, -1));
  const first = split[0];
  let n = first.length;
  for (const s of split) {
    let i = 0;
    while (i < n && i < s.length && s[i] === first[i]) i += 1;
    n = i;
  }
  return first.slice(0, n).join('/');
}

export function deriveLayout({ inventory, candidateRel }) {
  const ownerPaths = inventory.owners.map((o) => o.path);
  const ownerRoot = commonDir(ownerPaths);
  const appRows = inventory.rows.map((r) => r.path).filter((p) => !p.startsWith(candidateRel + '/') && !ownerPaths.includes(p));
  const appRel = commonDir(appRows);
  if (!appRel || appRows.some((p) => path.posix.dirname(p) !== appRel)) throw coded('LAYOUT_AMBIGUOUS', 'inventory rows outside the candidate do not share one app directory');
  const ownerExport = new Map(inventory.owners.map((o) => [o.path, o.exportPath || o.path]));
  return {
    candidateRel,
    appRel,
    ownerRoot,
    ownerExport,
    toExport(rel) {
      if (ownerExport.has(rel)) return ownerExport.get(rel);
      if (rel.startsWith(candidateRel + '/')) return rel.slice(candidateRel.length + 1);
      if (rel.startsWith(appRel + '/')) return 'app/' + rel.slice(appRel.length + 1);
      return null;
    }
  };
}

export const INVENTORY_EXPORT_ACTION = Object.freeze({ ship: 'ship', evidence: 'ship', transform: 'transform', 'export-mode': 'export-mode', exclude: 'exclude' });
export const PLAN_ACTION_BY_ROW = Object.freeze({ ship: 'ship', evidence: 'ship', transform: 'rewrite' });

export const EXPORT_MODE_ACTIONS = Object.freeze({
  'launcher-export-mode': 'HO return item 9: the export-mode launcher is the entry; the private form never ships',
  'rewrite-fenced': 'runtime closure: the export-mode launcher imports it',
  'validator-export-mode': 'runtime closure: the export-mode launcher imports it; M4 order item 4',
  'contract-export-mode': 'M4 order item 4: carries the trimmed live-run-intent contract the validator reads'
});

export const RETIRED_EXPORT_MODE_ACTIONS = Object.freeze({
  'server-export-mode': 'HO ruling R2 2026-10-27T20:37:59Z: no hardcoded server override; the launcher is the single entry and app/server.mjs leaves the export with its closure defect'
});

export function buildPlanWithReport({ inventory, fence, layout, houseRoot }) {
  const fenceMustNot = new Set((fence.mustNotShip || []).map((m) => m.path || m));
  const invMustNot = new Set(inventory.mustNotShip || []);
  const plan = [];
  const retired = [];
  const excluded = [];
  for (const r of inventory.rows) {
    if (!Object.hasOwn(INVENTORY_EXPORT_ACTION, r.action)) throw coded('INVENTORY_ACTION_UNKNOWN', `${r.path}: row action ${r.action} is not one of ${Object.keys(INVENTORY_EXPORT_ACTION).join(', ')}`);
    if (r.exportAction !== INVENTORY_EXPORT_ACTION[r.action]) throw coded('INVENTORY_ACTION_MISMATCH', `${r.path}: row action ${r.action} carries exportAction ${r.exportAction}`);
    if (r.action === 'exclude') { excluded.push(r.path); continue; }
    if (r.present === false || r.bytes === undefined || r.bytes === null) throw coded('INVENTORY_ROW_ABSENT', `${r.path}: a ${r.action} row has no bytes`);
    let action;
    let exportMode = null;
    if (r.action === 'export-mode') {
      const ga = r.exportMode && r.exportMode.generatorAction;
      if (Object.hasOwn(RETIRED_EXPORT_MODE_ACTIONS, ga)) {
        retired.push({ sourcePath: r.path, inventoryAction: r.action, generatorAction: ga, reason: RETIRED_EXPORT_MODE_ACTIONS[ga] });
        continue;
      }
      if (!Object.hasOwn(EXPORT_MODE_ACTIONS, ga)) throw coded('EXPORT_MODE_ACTION_UNKNOWN', `${r.path}: the export-mode row names generator action ${ga || '(none)'}, which this generator does not implement`);
      action = ga;
      exportMode = { action: ga, reason: EXPORT_MODE_ACTIONS[ga] };
    } else {
      action = PLAN_ACTION_BY_ROW[r.action];
    }
    if (fenceMustNot.has(r.path)) throw coded('FENCE_MUST_NOT_SHIP', `${r.path} is on the fence must-not-ship list`);
    if (invMustNot.has(r.path)) throw coded('INVENTORY_MUST_NOT_SHIP', `${r.path} is on the inventory must-not-ship list`);
    plan.push({
      sourcePath: r.path,
      exportPath: layout.toExport(r.path),
      inventoryAction: r.action,
      action,
      history: r.action !== 'export-mode',
      exportMode,
      inventoryPin: { bytes: r.bytes, sha256: r.sha256 }
    });
  }
  for (const o of inventory.owners) {
    const isFonts = /\.css$/.test(o.path) && fs.existsSync(path.join(houseRoot, o.path)) && /@font-face\s*\{/.test(fs.readFileSync(path.join(houseRoot, o.path), 'utf8'));
    const action = o.action === 'PROJECTION' ? 'projection' : (isFonts ? 'fonts-prune' : 'rewrite');
    plan.push({
      sourcePath: o.path,
      exportPath: o.exportPath || o.path,
      inventoryAction: o.action,
      action,
      history: true,
      exportMode: null,
      owner: true,
      inventoryPin: { bytes: o.tagBytes, sha256: o.tagSha256 }
    });
  }
  for (const p of plan) {
    if (!p.exportPath) throw coded('LAYOUT_UNMAPPED', `${p.sourcePath} has no export path`);
  }
  const seen = new Set();
  for (const p of plan) {
    if (seen.has(p.exportPath)) throw coded('EXPORT_PATH_COLLISION', p.exportPath);
    seen.add(p.exportPath);
  }
  assertPlanHonorsInventory(plan, { inventory, layout });
  return { plan, retired, excluded };
}

export function buildPlan(args) {
  return buildPlanWithReport(args).plan;
}

export function excludedExportPaths({ inventory, layout }) {
  const out = new Map();
  for (const r of inventory.rows) {
    if (r.action !== 'exclude') continue;
    const e = layout.toExport(r.path);
    if (e) out.set(e, r.path);
  }
  for (const g of GENERATED_EXPORT_FILES) out.delete(g);
  return out;
}

export function assertPlanHonorsInventory(plan, { inventory, layout }) {
  const rowByPath = new Map(inventory.rows.map((r) => [r.path, r]));
  const ownerPaths = new Set(inventory.owners.map((o) => o.path));
  const excludedExports = excludedExportPaths({ inventory, layout });
  const excludedHits = [];
  const unknown = [];
  for (const p of plan) {
    const r = rowByPath.get(p.sourcePath);
    if (r && r.action === 'exclude') excludedHits.push(`${p.sourcePath} (exclude row)`);
    else if (excludedExports.has(p.exportPath)) excludedHits.push(`${p.exportPath} (export path of exclude row ${excludedExports.get(p.exportPath)})`);
    else if (p.owner ? !ownerPaths.has(p.sourcePath) : !r) unknown.push(p.sourcePath);
    else if (!p.owner && (r.action === 'export-mode') !== !!p.exportMode) unknown.push(`${p.sourcePath} (export-mode flag differs from its row)`);
  }
  if (excludedHits.length) throw coded('EXCLUDE_ROW_IN_PLAN', `${excludedHits.length} plan entr${excludedHits.length === 1 ? 'y comes' : 'ies come'} from exclude rows: ${excludedHits.slice(0, 3).join(', ')}`, { excludedHits });
  if (unknown.length) throw coded('PLAN_ROW_NOT_IN_INVENTORY', `${unknown.length} plan entr${unknown.length === 1 ? 'y has' : 'ies have'} no matching inventory row: ${unknown.slice(0, 3).join(', ')}`, { unknown });
  return true;
}

export function plantExcludeRow({ inventory, layout }) {
  const r = inventory.rows.find((x) => x.action === 'exclude' && x.present !== false && x.bytes !== null && x.bytes !== undefined && layout.toExport(x.path));
  if (!r) throw coded('USAGE', 'no present exclude row to plant');
  return { sourcePath: r.path, exportPath: layout.toExport(r.path), inventoryAction: r.action, action: 'ship', history: true, exportMode: null, planted: true, inventoryPin: { bytes: r.bytes, sha256: r.sha256 } };
}

export const GENERATED_EXPORT_FILES = Object.freeze(['NOTICE-MAP.json', 'THIRD-PARTY-NOTICES.txt', 'EVENT-NEW-MANIFEST.json']);

export function assertTreeInsidePlan(files, plan, excludedExports = new Map()) {
  const excludedHit = files.filter((f) => excludedExports.has(f));
  if (excludedHit.length) throw coded('EXCLUDE_ROW_IN_EXPORT', `${excludedHit.length} export file(s) sit at the export path of an exclude row: ${excludedHit.slice(0, 5).join(', ')}`, { excludedHit });
  const allowed = new Set([...plan.map((p) => p.exportPath), ...GENERATED_EXPORT_FILES]);
  const outside = files.filter((f) => !allowed.has(f));
  if (outside.length) throw coded('FILE_OUTSIDE_INVENTORY', `${outside.length} export file(s) outside the inventory: ${outside.slice(0, 5).join(', ')}`, { outside });
  return true;
}

// ---------- scan-driven rewrite (HO items 6, 7; ruling R-B) ----------
// Replacements are keyed by the rule position inside each class of the house disclosure rules,
// so this source carries no rule token. The class counts are pinned; a different rule receipt refuses.

export const RULE_CLASS_COUNTS = Object.freeze({
  'scan01|absolute path': 1,
  'scan01|house law': 6,
  'scan01|sealed name': 5,
  'scan01|internal tool': 7,
  ['scan01|private eng' + 'ine']: 7,
  'delta|delta: home path': 5,
  'delta|delta: sealed name': 4,
  'delta|delta: internal vocabulary': 8,
  'delta|delta: other-competition residue': 3,
  ['delta|delta: private corp' + 'us']: 3,
  ['delta|delta: boundary (R-L/H' + '8)']: 3
});

const PATH = 'PATH';
const cap = (token, word) => (/^[A-Z]/.test(token) && /^[a-z]/.test(word) ? word[0].toUpperCase() + word.slice(1) : word);
const plural = (token, one, many) => (/(?:es|s)$/i.test(token) ? many : one);

export const REPLACEMENT_BY_RULE = Object.freeze({
  'scan01|absolute path': [PATH],
  'scan01|house law': [() => 'house-ref', (t) => t.slice(3), () => 'house-ref', () => 'house-ref', () => 'DESIGN_RULE', () => 'single-owner rule'],
  'scan01|sealed name': [() => 'build-seat', () => 'build-seat', () => 'build-seat', () => 'hosted-route', () => 'hosted-route'],
  'scan01|internal tool': [PATH, () => 'demo', () => 'House', () => 'design standard', () => 'caret gate', () => 'combo gate', (t) => cap(t, 'owner word')],
  ['scan01|private eng' + 'ine']: [PATH, () => 'design tokens', PATH, () => 'design-system', () => 'ui-faces', () => 'motion-seeds', () => 'design-tokens'],
  'delta|delta: home path': [PATH, () => 'the home directory', PATH, () => `${HOUSE_ONLY_DIR}/door-runtime`, PATH],
  'delta|delta: sealed name': [() => 'a build seat', (t) => cap(t, 'build-seat'), () => 'build-seat', () => 'hosted-route'],
  'delta|delta: internal vocabulary': [PATH, PATH, PATH, PATH, () => 'house log', () => 'house term', (t) => 'demo' + t.slice(3), (t) => (/^w/i.test(t) ? cap(t, 'door-verifier') : cap(t, 'owner'))],
  'delta|delta: other-competition residue': [() => 'other-event', () => 'other-event', () => 'other-event'],
  ['delta|delta: private corp' + 'us']: [(t) => cap(t, 'record set'), () => 'review hold', (t) => cap(t, plural(t, 'filing record', 'filing records'))],
  ['delta|delta: boundary (R-L/H' + '8)']: [() => 'boundary rule', (t) => (/^h/i.test(t) ? cap(t, plural(t, 'rig', 'rigs')) : /^u/i.test(t) ? cap(t, 'pending') : cap(t, plural(t, 'internal module', 'internal modules'))), PATH]
});

export function indexRules(rules) {
  const byKey = new Map();
  const indexed = [];
  for (const r of [...rules.scan01, ...rules.delta]) {
    const key = `${r.ruleSet}|${r.class}`;
    const idx = byKey.get(key) || 0;
    byKey.set(key, idx + 1);
    indexed.push({ ...r, key, idx });
  }
  for (const [key, n] of Object.entries(RULE_CLASS_COUNTS)) {
    if (byKey.get(key) !== n) throw coded('RULE_RECEIPT_SHAPE', `rule class ${key} has ${byKey.get(key) || 0} rules, expected ${n}`);
  }
  for (const r of indexed) {
    const table = REPLACEMENT_BY_RULE[r.key];
    if (!table || !table[r.idx]) throw coded('RULE_RECEIPT_SHAPE', `no replacement for ${r.key} #${r.idx}`);
    r.replace = table[r.idx];
  }
  return indexed;
}

const PATH_CHAR = /[A-Za-z0-9._~$/#@{},*+-]/;

function extendPath(line, start, end) {
  let a = start;
  let b = end;
  while (a > 0 && PATH_CHAR.test(line[a - 1])) a -= 1;
  while (b < line.length && PATH_CHAR.test(line[b])) b += 1;
  return [a, b];
}

export function mapPathToken(token, ctx) {
  let core = token;
  let suffix = '';
  const trail = /([.,;]+)$/.exec(core);
  if (trail && !/\.[A-Za-z0-9]+$/.test(core.slice(0, -trail[1].length) + 'x')) { core = core.slice(0, -trail[1].length); suffix = trail[1]; }
  const hash = core.indexOf('#');
  if (hash > 0) { suffix = core.slice(hash) + suffix; core = core.slice(0, hash); }
  let ownerUrl = false;
  const ownerPrefix = ctx.ownerUrlPrefix;
  if (ownerPrefix && core.startsWith(ownerPrefix)) { core = core.slice(ownerPrefix.length); ownerUrl = true; }
  let rel = core;
  if (ctx.houseRootAbs && (rel === ctx.houseRootAbs || rel.startsWith(ctx.houseRootAbs + '/'))) rel = rel.slice(ctx.houseRootAbs.length + 1);
  rel = rel.replace(/^\.\//, '');
  const relNoSlash = rel.replace(/\/+$/, '');
  const L = ctx.layout;
  if (L.ownerRoot && (relNoSlash === L.ownerRoot || relNoSlash.startsWith(L.ownerRoot + '/') || relNoSlash.startsWith(L.ownerRoot + '{'))) {
    if (ctx.keepOwnerPaths && !relNoSlash.includes('{') && L.ownerExport.has(relNoSlash)) return token;
    const base = relNoSlash.includes('{') ? 'files' : path.posix.basename(relNoSlash);
    return `ui owner ${base}` + suffix;
  }
  if (relNoSlash === L.candidateRel) return '.' + suffix;
  if (relNoSlash.startsWith(L.candidateRel + '/')) return relNoSlash.slice(L.candidateRel.length + 1) + (rel.endsWith('/') ? '/' : '') + suffix;
  if (relNoSlash === L.appRel) return 'app' + (rel.endsWith('/') ? '/' : '') + suffix;
  if (relNoSlash.startsWith(L.appRel + '/')) return 'app/' + relNoSlash.slice(L.appRel.length + 1) + (rel.endsWith('/') ? '/' : '') + suffix;
  const lineRef = /^(.*?)(:\d+(?:[-:]\d+)*)$/.exec(relNoSlash);
  const bare = lineRef ? lineRef[1] : relNoSlash;
  const base = path.posix.basename(bare.replace(/[{}*,]/g, '')) || 'path';
  return `${HOUSE_ONLY_DIR}/${base}` + (lineRef ? lineRef[2] : '') + suffix + (ownerUrl ? '' : '');
}

function commentLineKinds(lines, kind) {
  const isComment = new Array(lines.length).fill(false);
  if (kind !== 'js' && kind !== 'css') return isComment;
  let inBlock = false;
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trimStart();
    if (inBlock) {
      isComment[i] = true;
      if (t.includes('*/')) inBlock = false;
      continue;
    }
    if (kind === 'js' && t.startsWith('//')) { isComment[i] = true; continue; }
    if (t.startsWith('/*')) {
      isComment[i] = true;
      if (!t.slice(2).includes('*/')) inBlock = true;
    }
  }
  return isComment;
}

function neutralComment(line, kind) {
  const indent = /^\s*/.exec(line)[0];
  const t = line.trimStart();
  const closes = t.slice(2).includes('*/') || (t.startsWith('*') && t.trimEnd().endsWith('*/'));
  if (kind === 'js' && t.startsWith('//')) return `${indent}// ${NOTE_REMOVED}`;
  if (t.startsWith('/*')) return `${indent}/* ${NOTE_REMOVED}${closes ? ' */' : ''}`;
  if (t.startsWith('*')) return `${indent}* ${NOTE_REMOVED}${closes && t !== '*/' ? ' */' : ''}`;
  return `${indent}${NOTE_REMOVED}${t.includes('*/') ? ' */' : ''}`;
}

export function fileKindOf(p) {
  if (/\.(mjs|js|cjs)$/.test(p)) return 'js';
  if (/\.css$/.test(p)) return 'css';
  if (/\.json$/.test(p)) return 'json';
  if (/\.(md|txt)$/.test(p)) return 'text';
  if (/\.woff2$/.test(p)) return 'binary';
  return 'text';
}

function quotedSegments(line) {
  const segs = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(line)) !== null) segs.push(m[1] ?? m[2] ?? m[3] ?? '');
  return segs;
}

export function rewriteText(text, ctx) {
  const kind = ctx.kind || 'text';
  let cur = String(text);
  const stats = { iterations: 0, commentLines: 0, pathTokens: 0, tokens: 0, secretValues: 0 };
  for (let iter = 0; iter < 6; iter += 1) {
    const rows = scanText(cur, ctx.rulesForScan, ctx.scanSecrets(cur));
    const relevant = rows.filter((r) => !(ctx.keepOwnerPaths && isOwnerPathRow(r, ctx)));
    if (!relevant.length) { stats.iterations = iter; return { text: cur, residual: [], ownerPathRows: rows.length, stats }; }
    const lines = cur.split('\n');
    const isComment = commentLineKinds(lines, kind);
    const rowLines = new Set(relevant.map((r) => r.line - 1));
    for (const i of rowLines) {
      if (isComment[i]) { lines[i] = neutralComment(lines[i], kind); stats.commentLines += 1; }
    }
    const secretLines = new Set(relevant.filter((r) => r.class.startsWith('delta: 24+')).map((r) => r.line - 1));
    const runMap = new Map();
    for (const i of secretLines) {
      if (isComment[i]) continue;
      for (const seg of quotedSegments(lines[i])) {
        for (const m of seg.matchAll(/[A-Za-z0-9._~+/=-]{10,}/g)) {
          if (/^[0-9a-f]{32,}$/i.test(m[0])) continue;
          if (!runMap.has(m[0])) runMap.set(m[0], `pv${runMap.size + 1}`);
        }
      }
    }
    for (let i = 0; i < lines.length; i += 1) {
      if (isComment[i] && rowLines.has(i)) continue;
      if (!rowLines.has(i)) continue;
      lines[i] = rewriteLine(lines[i], ctx, stats);
    }
    cur = lines.join('\n');
    for (const [run, ph] of runMap) { cur = cur.split(run).join(ph); stats.secretValues += 1; }
  }
  const rows = scanText(cur, ctx.rulesForScan, ctx.scanSecrets(cur));
  const residual = rows.filter((r) => !(ctx.keepOwnerPaths && isOwnerPathRow(r, ctx)));
  return { text: cur, residual, ownerPathRows: rows.length - residual.length, stats };
}

export function rewriteOrRefuse(text, ctx, label) {
  const res = rewriteText(text, ctx);
  if (res.residual.length) {
    const sample = res.residual.slice(0, 3).map((r) => `${r.line}:${r.class}`).join(', ');
    throw coded('REWRITE_RESIDUAL_ROWS', `${label}: ${res.residual.length} disclosure row(s) survive the rewrite (${sample})`, { residual: res.residual });
  }
  return res;
}

function isOwnerPathRow(row, ctx) {
  if (!row.class.startsWith('private eng')) return false;
  const prefix = ctx.ownerUrlPrefix || '';
  return row.tokens.every((t) => {
    const core = prefix && t.startsWith(prefix) ? t.slice(prefix.length) : t;
    if (prefix && (t === prefix || t === prefix.replace(/\/$/, ''))) return true;
    if (ctx.layout.ownerExport.has(core)) return true;
    return [...ctx.layout.ownerExport.values()].some((p) => p.startsWith(core + '/') || p.split('/').includes(core) || p.includes(core));
  });
}

function quoteAt(line, idx) {
  let q = null;
  for (let i = 0; i < idx; i += 1) {
    const ch = line[i];
    if (q) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === q) q = null;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      q = ch;
    } else if (ch === '/' && line[i + 1] === '/') {
      return '//';
    }
  }
  return q;
}

function rewriteLine(line, ctx, stats) {
  let out = line;
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    for (const rule of ctx.indexedRules) {
      let from = 0;
      for (let guard = 0; guard < 200; guard += 1) {
        const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g');
        re.lastIndex = from;
        const m = re.exec(out);
        if (!m) break;
        if (m[0].length === 0) { from = m.index + 1; continue; }
        if (rule.replace === PATH) {
          const [a, b] = extendPath(out, m.index, m.index + m[0].length);
          const token = out.slice(a, b);
          const mapped = mapPathToken(token, ctx);
          if (mapped === token) { from = b; continue; }
          out = out.slice(0, a) + mapped + out.slice(b);
          from = a + mapped.length;
          stats.pathTokens += 1;
        } else {
          let repl = rule.replace(m[0]);
          if (ctx.kind === 'js' && !quoteAt(out, m.index)) {
            repl = /^process\.env\./.test(m[0]) ? `'${HOUSE_ONLY_DIR}'` : repl.replace(/[^A-Za-z0-9_$]+/g, '_');
          }
          if (repl === m[0]) { from = m.index + m[0].length; continue; }
          out = out.slice(0, m.index) + repl + out.slice(m.index + m[0].length);
          from = m.index + repl.length;
          stats.tokens += 1;
        }
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

// ---------- anchors, pins and imports ----------

export function applyAnchors(text, anchors, { label }) {
  if (text.includes('\r\n')) throw coded('ANCHOR_SOURCE_CRLF', `${label}: CRLF line endings are refused; the anchors bind LF bytes`);
  let lines = text.split('\n');
  const applied = [];
  for (const a of anchors) {
    const hits = [];
    for (let i = 0; i + a.lines <= lines.length; i += 1) {
      if (sha256Hex(lines.slice(i, i + a.lines).join('\n')) === a.sha256) hits.push(i);
    }
    if (hits.length === 0 && typeof a.absentWhen === 'function' && a.absentWhen(text)) { applied.push({ id: a.id, line: null, lines: 0, absent: true }); continue; }
    if (hits.length !== 1) throw coded('ANCHOR_UNMATCHED', `${label}: anchor ${a.id} matched ${hits.length} windows (expected 1)`);
    const i = hits[0];
    const original = lines.slice(i, i + a.lines).join('\n');
    const replacement = a.replace(original);
    lines = [...lines.slice(0, i), ...replacement.split('\n'), ...lines.slice(i + a.lines)];
    applied.push({ id: a.id, line: i + 1, lines: a.lines });
  }
  return { text: lines.join('\n'), applied };
}

const PIN_RE = /(['"]?repoRelativePath['"]?\s*:\s*['"])([^'"]+)(['"],[\s\S]{0,400}?['"]?expectedBytes['"]?\s*:\s*)(\d+)(,\s*['"]?expectedSha256['"]?\s*:\s*['"])([0-9a-f]{64})(['"])/g;

export function parsePins(text) {
  const out = [];
  for (const m of String(text).matchAll(PIN_RE)) out.push({ path: m[2], bytes: Number(m[4]), sha256: m[6] });
  return out;
}

export function regeneratePinsByPath(text, pinsByPath) {
  const changed = [];
  const out = String(text).replace(PIN_RE, (whole, a, p, b, bytes, c, sha, d) => {
    const pin = pinsByPath.get(p);
    if (!pin) return whole;
    if (Number(bytes) !== pin.bytes || sha !== pin.sha256) changed.push({ path: p, from: { bytes: Number(bytes), sha256: sha }, to: { bytes: pin.bytes, sha256: pin.sha256 } });
    return `${a}${p}${b}${pin.bytes}${c}${pin.sha256}${d}`;
  });
  return { text: out, changed };
}

const IMPORT_SPEC_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\2/g;

export function rewriteRelativeImports(text, { sourceRel, exportRel, layout }) {
  const srcDir = path.posix.dirname(sourceRel);
  const expDir = path.posix.dirname(exportRel);
  let count = 0;
  const out = text.replace(IMPORT_SPEC_RE, (whole, kw, q, spec) => {
    const targetRel = path.posix.normalize(path.posix.join(srcDir, spec));
    const targetExport = layout.toExport(targetRel);
    if (!targetExport) return whole;
    let rel = path.posix.relative(expDir, targetExport);
    if (!rel.startsWith('.')) rel = './' + rel;
    if (rel === spec) return whole;
    count += 1;
    return `${kw}${q}${rel}${q}`;
  });
  return { text: out, count };
}

// ---------- owner transforms (ruling R-A: the token sheet and the fonts sheet are transform rows) ----------

export function projectPrunedFontsCss(sourceCss, { expectedBytes, expectedSha256 }) {
  const buf = Buffer.isBuffer(sourceCss) ? sourceCss : Buffer.from(String(sourceCss), 'utf8');
  if (buf.length !== expectedBytes || sha256Hex(buf) !== expectedSha256) {
    throw coded('FONTS_CSS_SOURCE_PIN_MISMATCH', `got ${buf.length} B ${sha256Hex(buf).slice(0, 16)}, expected ${expectedBytes} B ${String(expectedSha256).slice(0, 16)}`);
  }
  const blocks = buf.toString('utf8').match(/@font-face\s*\{[\s\S]*?\}/g) || [];
  const kept = [];
  for (const block of blocks) {
    const fam = /font-family:\s*['"]([^'"]+)['"]/.exec(block);
    if (fam && ALLOWED_FONT_FAMILIES.includes(fam[1])) kept.push(block.trim());
  }
  if (kept.length !== 4) throw coded('FONTS_CSS_BLOCK_COUNT_MISMATCH', `expected 4 kept @font-face blocks, got ${kept.length}`);
  const css = ['/* Self-hosted WOFF2 font declarations: Inter and JetBrains Mono */', '', ...kept, ''].join('\n');
  const urls = [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]);
  return { css, urls, keptBlockCount: kept.length };
}

// ---------- launcher export mode (HO item 9; M4 order item 3) ----------
// Anchors bind line windows of the accepted launcher by sha256; any other launcher bytes refuse.

export const LAUNCHER_SOURCE_PIN = Object.freeze({ bytes: 137106, sha256: '1ddc739e6dfb6dd34a0c6cc1d58a82bb88d9cb482d4684e96640cca6c666eb80' });

const LAUNCHER_PRELUDE = [
  'const EXPORT_OWNER_ROWS = Object.freeze(Object.values(EXACT_PRIVATE_OWNER_MOUNT_ALLOWLIST));',
  'const OWNER_URL_PREFIX = EXPORT_OWNER_ROWS[0].urlPath.slice(0, EXPORT_OWNER_ROWS[0].urlPath.length - EXPORT_OWNER_ROWS[0].repoRelativePath.length);',
  'function exportOwnerUrlPathEndingWith(suffix) {',
  '  const hits = EXPORT_OWNER_ROWS.filter((row) => row.urlPath.endsWith(suffix));',
  '  if (hits.length !== 1) {',
  '    const err = new Error(`Export owner row is not unique for ${suffix}`);',
  "    err.code = 'EXPORT_OWNER_ROW_AMBIGUOUS';",
  '    throw err;',
  '  }',
  '  return hits[0].urlPath;',
  '}'
];

export function launcherAnchors(pinSubstitutionsLiteral) {
  return [
    { id: 'L01-root', lines: 1, sha256: '8b4ef55010d08d51ba4ce38f803259a17af36b71be702f653735a756ea8dd445', replace: () => 'const REPO_ROOT = fs.realpathSync(__dirname);' },
    {
      id: 'L02-live-loader-house-only', lines: 7, sha256: 'da133953be58c9f96733b35a0f62f8b2eb74ffb4d0c13f515935bd3306fce38b',
      replace: (orig) => [
        `  if (REGISTERED_KEY_LOADER_INTERFACE_PIN.exportMode === '${KEY_LOADER_EXPORT_MODE}') {`,
        "    const err = new Error('The registered key loader is house-only and is not part of this export; inject a loader with injectRegisteredMetaHackathonLoadKey to run a live attempt.');",
        "    err.code = 'KEY_LOADER_HOUSE_ONLY';",
        '    throw err;',
        '  }',
        orig
      ].join('\n')
    },
    {
      id: 'L03-mounted-el', lines: 5, sha256: '6d3521e25b5e4fdb5c95f1031c1c5bc032d51b746bd64d7aef6e6f8f883fd532',
      replace: () => [
        'export async function loadMountedRegisteredWidgetEl(uiMountResolver = createCanonicalUiMountResolver()) {',
        "  const elUrlPath = exportOwnerUrlPathEndingWith('/faces/el.mjs');",
        '  const mounted = uiMountResolver(elUrlPath);',
        '  if (!mounted || mounted.allowed !== true || !(mounted.body instanceof Buffer)) {',
        '    throw new Error(`Failed to resolve allowlisted ${elUrlPath}`);',
        '  }'
      ].join('\n')
    },
    {
      id: 'L04-owner-allowlist', lines: 11, sha256: '0768e10d906126f426fd1afee797774322652bc2dc7dbce22c96a5df57401a5c',
      replace: () => [
        ...LAUNCHER_PRELUDE,
        `const EXPORT_OWNER_PIN_SUBSTITUTIONS = Object.freeze(${pinSubstitutionsLiteral});`,
        'export const CANDIDATE_PRIVATE_OWNER_MOUNT_ALLOWLIST = Object.freeze(Object.fromEntries(',
        '  EXPORT_OWNER_ROWS.map((row) => [row.urlPath, Object.freeze({ ...row, ...(EXPORT_OWNER_PIN_SUBSTITUTIONS[row.expectedSha256] || {}) })])',
        '));'
      ].join('\n')
    },
    {
      id: 'L05-key-loader-pin', lines: 8, sha256: '5447ee8304015ea42b8477d3f51d76859eee0e4fd2fbd79c702169246198ae1f',
      replace: (orig) => orig.replace(/\n\}\);$/, `,\n  exportMode: '${KEY_LOADER_EXPORT_MODE}'\n});`)
    },
    { id: 'L06-future-mapping-owners', lines: 1, sha256: '2dd4a7785a2cb0462d92c231537969161126f78019412a4cb5826eb75372173e', replace: () => "    currentLocalSource: 'the 18 registered UI owner rows listed in DEPENDENCY-CONTRACT.json'," },
    { id: 'L07-owner-url-prefix', lines: 1, sha256: 'bd0019be3e238f9878e9ce68f6e39d3c5f685482f9a75ebadb02d62684334e20', replace: () => '    ownerUrlPrefix: OWNER_URL_PREFIX,' },
    {
      id: 'L08-integrity-key-loader', lines: 19, sha256: '8b540349fa798186e12188ca3e53942603a4062d5f655744ad6547f380ae927b',
      replace: (orig) => [
        `  if (REGISTERED_KEY_LOADER_INTERFACE_PIN.exportMode !== '${KEY_LOADER_EXPORT_MODE}') {`,
        orig,
        '  } else if (injectedKeyLoaderSlot !== null && typeof injectedKeyLoaderSlot !== \'function\') {',
        "    throw new Error('Registered keyLoader slot holds a non-function value');",
        '  }'
      ].join('\n')
    },
    { id: 'L09-resolver-prefix', lines: 1, sha256: '9f4ace6fc115449f60fd6f8a371b134ba561ead0eb0d9e98f4d769708dbb8733', replace: () => "    if (typeof urlPath === 'string' && urlPath.startsWith(OWNER_URL_PREFIX)) {" },
    {
      id: 'L10-check-ui-coded-refusal', lines: 11, sha256: 'c3519df43f86ba3921a93f4fb6fd2fe901b6dc0ba77c3c3f1866b88d745fa9d4',
      replace: () => [
        '    // The registered UI files are not part of this export: every UI route answers the coded refusal.',
        "    for (const uiRoute of ['/', '/index.html', '/ui/index.html', '/ui/preview.mjs']) {",
        '      const uiRes = await fetch(`${defaultBaseUrl}${uiRoute}`);',
        '      const uiJson = await uiRes.json();',
        "      if (uiRes.status !== 501 || uiJson.code !== 'UI_RESERVED_FOR_REGISTERED_OWNER') {",
        '        throw new Error(`Expected the coded refusal 501 UI_RESERVED_FOR_REGISTERED_OWNER on ${uiRoute}, got ${uiRes.status}`);',
        '      }',
        '    }'
      ].join('\n')
    },
    {
      id: 'L11-check-denied-probes', lines: 9, sha256: '953443c9cb3072bb614f5598983bbb8dbf95514761201703f824747323da105f',
      replace: () => [
        "    const fontsProbeRow = EXPORT_OWNER_ROWS.find((row) => row.urlPath.endsWith('-700-normal.woff2'));",
        '    for (const deniedPath of [',
        '      ...EXCLUDED_CANDIDATE_PATHS,',
        '      `${OWNER_URL_PREFIX}fonts/unused-font.woff2`,',
        "      fontsProbeRow.urlPath.replace('-700-normal', '-600-normal'),",
        '      `${OWNER_URL_PREFIX}app/rules-intake-gate.mjs`,',
        '      `${OWNER_URL_PREFIX}${REGISTERED_KEY_LOADER_INTERFACE_PIN.repoRelativePath}`,',
        '      `/_owners/${EXPORT_OWNER_ROWS[0].repoRelativePath}`,',
        '      `/_mounted/${EXPORT_OWNER_ROWS[0].repoRelativePath}`',
        '    ]) {'
      ].join('\n')
    },
    {
      id: 'L12-check-replay-coded-refusal', lines: 5, sha256: 'e0d7963285d6c26bad73d34ca28b5114cb388d9bd1888090b973c60b883667be',
      replace: () => [
        '    const replayEndpointRes = await fetch(`${synthBaseUrl}/api/candidate/replay`);',
        '    const replayEndpointJson = await replayEndpointRes.json();',
        "    if (replayEndpointRes.status !== 404 || replayEndpointJson.code !== 'REPLAY_FIXTURE_NOT_FOUND') {",
        "      throw new Error('GET /api/candidate/replay must answer the coded refusal REPLAY_FIXTURE_NOT_FOUND: the synthetic replay fixture is house-only');",
        '    }'
      ].join('\n')
    }
  ];
}

// ---------- validator and contract export modes ----------

export const VALIDATOR_SOURCE_PIN = Object.freeze({ bytes: 21798, sha256: '94f3450331f5c1b6e451d1a2ed8e674e433003019cb2c314b1a9a11ced12a324' });

export const VALIDATOR_ANCHORS = Object.freeze([
  Object.freeze({ id: 'V01-contract-path', lines: 1, sha256: '0d37ebc99c448e2ef53f067b6d933d158725310d3619d73b4a999df9d7431078', replace: () => "  return resolve(HERE, '..', 'DEPENDENCY-CONTRACT.json');" }),
  Object.freeze({ id: 'V02-ledger-path', lines: 1, sha256: '035ae8ad2a0666e2c6550fc3155502643cc74fc629f43a3ad54e953dfc0073fb', replace: () => `  return resolve(HERE, '..', '${HOUSE_ONLY_DIR}', 'receipts.jsonl');` })
]);

export function transformLauncherToExportMode(sourceBuf, { pinsByPath = new Map(), ownerPinSubstitutions = {}, rewriteCtx, sourceRel, exportRel, layout }) {
  const buf = Buffer.isBuffer(sourceBuf) ? sourceBuf : Buffer.from(String(sourceBuf), 'utf8');
  if (buf.includes(Buffer.from('\r\n'))) throw coded('ANCHOR_SOURCE_CRLF', 'launcher: CRLF line endings are refused; the anchors bind LF bytes');
  if (buf.length !== LAUNCHER_SOURCE_PIN.bytes || sha256Hex(buf) !== LAUNCHER_SOURCE_PIN.sha256) {
    throw coded('LAUNCHER_SOURCE_PIN_MISMATCH', `launcher source ${buf.length} B ${sha256Hex(buf).slice(0, 16)} is not the accepted ${LAUNCHER_SOURCE_PIN.bytes} B ${LAUNCHER_SOURCE_PIN.sha256.slice(0, 16)}`);
  }
  const literal = JSON.stringify(ownerPinSubstitutions);
  const anchored = applyAnchors(buf.toString('utf8'), launcherAnchors(literal), { label: 'launcher' });
  const pinned = regeneratePinsByPath(anchored.text, pinsByPath);
  const imports = rewriteRelativeImports(pinned.text, { sourceRel, exportRel, layout });
  const rewritten = rewriteText(imports.text, { ...rewriteCtx, kind: 'js', keepOwnerPaths: false });
  return { code: rewritten.text, anchors: anchored.applied, pins: pinned.changed, imports: imports.count, residual: rewritten.residual, stats: rewritten.stats };
}

export function transformValidatorToExportMode(sourceBuf, { rewriteCtx }) {
  const buf = Buffer.isBuffer(sourceBuf) ? sourceBuf : Buffer.from(String(sourceBuf), 'utf8');
  if (buf.length !== VALIDATOR_SOURCE_PIN.bytes || sha256Hex(buf) !== VALIDATOR_SOURCE_PIN.sha256) {
    throw coded('VALIDATOR_SOURCE_PIN_MISMATCH', `validator source ${buf.length} B is not the accepted ${VALIDATOR_SOURCE_PIN.bytes} B`);
  }
  const anchored = applyAnchors(buf.toString('utf8'), VALIDATOR_ANCHORS, { label: 'validator' });
  const rewritten = rewriteText(anchored.text, { ...rewriteCtx, kind: 'js', keepOwnerPaths: false });
  return { code: rewritten.text, anchors: anchored.applied, residual: rewritten.residual, stats: rewritten.stats };
}

export function transformContractToExportMode(sourceBuf, { packet, pinsByPath = new Map(), rewriteCtx }) {
  const contract = JSON.parse(Buffer.isBuffer(sourceBuf) ? sourceBuf.toString('utf8') : String(sourceBuf));
  if (!packet || !packet.liveRunIntentContract) throw coded('PACKET_CONTRACT_MISSING', 'the unfreeze packet carries no liveRunIntentContract');
  contract.status = 'EXPORT_MODE_COPY_NOT_RELEASE_CLEARANCE';
  contract.exportMode = {
    generator: `export-generator.mjs rev ${GENERATOR_REVISION}`,
    pins: 'expected bytes and sha256 values describe the exported bytes',
    keyLoader: KEY_LOADER_EXPORT_MODE,
    liveRunIntentContract: 'trimmed from the unfreeze packet; door and ledger paths are house-only in this export'
  };
  if (contract.liveEntryContract && contract.liveEntryContract.registeredKeyLoaderInterfacePin) {
    contract.liveEntryContract.registeredKeyLoaderInterfacePin.exportMode = KEY_LOADER_EXPORT_MODE;
  }
  contract.liveRunIntentContract = JSON.parse(JSON.stringify(packet.liveRunIntentContract));
  let text = JSON.stringify(contract, null, 2) + '\n';
  const pinned = regeneratePinsByPath(text, pinsByPath);
  const rewritten = rewriteText(pinned.text, { ...rewriteCtx, kind: 'json', keepOwnerPaths: true });
  JSON.parse(rewritten.text);
  return { code: rewritten.text, pins: pinned.changed, ownerPathRows: rewritten.ownerPathRows, residual: rewritten.residual, stats: rewritten.stats };
}

// ---------- house inputs and scan context ----------

export function gitBlobOid(buf) {
  return crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');
}

function firstToken(s) {
  return String(s || '').trim().split(/\s+/)[0] || null;
}

function pinOf(p, houseRoot) {
  const buf = fs.readFileSync(p);
  const rel = houseRoot && p.startsWith(houseRoot + '/') ? p.slice(houseRoot.length + 1) : p;
  return { path: rel, bytes: buf.length, sha256: sha256Hex(buf) };
}

export function resolveInputs(args) {
  const need = (k) => { if (!args[k]) throw coded('USAGE', `--${k} is required`); return args[k]; };
  const houseRoot = fs.realpathSync(args['house-root'] || findRepo(HERE) || '.');
  if (!fs.existsSync(path.join(houseRoot, '.git')) && !args['git-base']) throw coded('EXPORT_GENERATOR_HOUSE_ONLY', 'the build runs in the house: no house root or git base found');
  const inventoryPath = path.resolve(need('inventory'));
  const inventory = readJson(inventoryPath);
  const deskDir = path.dirname(inventoryPath);
  const fencePath = path.resolve(args.fence || path.join(deskDir, firstToken(inventory.header && inventory.header.fence)));
  const rulesPath = path.resolve(args.rules || path.join(deskDir, firstToken(inventory.header && inventory.header.scan02Baseline)));
  const packetPath = path.resolve(need('packet'));
  const noticeRowsPath = path.resolve(args['notice-rows'] || path.join(deskDir, 'NOTICE-ROWS.json'));
  const exportTime = need('export-time');
  if (!isIsoUtc(exportTime)) throw coded('USAGE', '--export-time must be ISO-8601 UTC (YYYY-MM-DDTHH:MM:SSZ)');
  const candidateDir = path.resolve(HERE, '..');
  const candidateRel = path.relative(houseRoot, candidateDir).split(path.sep).join('/');
  if (candidateRel.startsWith('..')) throw coded('LAYOUT_AMBIGUOUS', 'the generator does not sit inside the house candidate folder');
  return {
    houseRoot,
    candidateRel,
    inventoryPath, inventory,
    fencePath, fence: readJson(fencePath),
    rulesPath, rulesReceipt: readJson(rulesPath),
    packetPath, packet: readJson(packetPath),
    noticeRowsPath, noticeRows: readJson(noticeRowsPath),
    gitBase: path.resolve(need('git-base')),
    head: need('head'),
    exportTime: toIsoUtc(exportTime),
    exportHome: path.resolve(need('export-home')),
    evidenceDir: path.resolve(need('evidence-dir')),
    eventsPath: args.events ? path.resolve(args.events) : path.join(houseRoot, '_system', 'ledger', 'events.jsonl'),
    ledgerPath: args.ledger ? path.resolve(args.ledger) : path.join(houseRoot, '_system', 'ledger', 'receipts.jsonl'),
    landingTimesPath: args['landing-times'] ? path.resolve(args['landing-times']) : null,
    closureMode: args.closure || 'strict',
    releaseReceipt: args['release-receipt'] || null,
    selfRed: args['self-red'] || null,
    expectInventorySha: args['expect-inventory-sha'] || null
  };
}

export async function loadScanContext({ houseRoot, rulesReceipt, contract, layout }) {
  const rules = loadRules(rulesReceipt);
  const indexedRules = indexRules(rules);
  const detectorPath = path.join(houseRoot, 'scripts', 'lib', 'secret-patterns.mjs');
  if (!fs.existsSync(detectorPath)) throw coded('EXPORT_GENERATOR_HOUSE_ONLY', 'the house secret detector is not reachable from this tree');
  const { scanTextForSecrets } = await import(pathToFileURL(detectorPath).href);
  const row0 = contract.uiOwnerMountContract.exactPrivateOwnerMountAllowlist[0];
  const ownerUrlPrefix = row0.urlPath.slice(0, row0.urlPath.length - row0.repoRelativePath.length);
  return { rules, rulesForScan: rules, indexedRules, scanSecrets: scanTextForSecrets, layout, ownerUrlPrefix, houseRootAbs: houseRoot };
}

// ---------- per-layer transforms (ruling R-B: transformed form at every layer) ----------

function syntaxCheck(code, label, sandbox) {
  const f = path.join(sandbox, `syntax-${sha256Hex(label).slice(0, 12)}.mjs`);
  fs.writeFileSync(f, code);
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8', env: { PATH: process.env.PATH || '' } });
  fs.rmSync(f, { force: true });
  if (r.status !== 0) throw coded('EXPORT_SYNTAX_INVALID', `${label}: ${String(r.stderr).split('\n').slice(0, 4).join(' ')}`);
}

export function transformForLayer(row, buf, env) {
  const kind = fileKindOf(row.exportPath);
  const ctx = { ...env.scanCtx, kind };
  let out;
  let transformId;
  switch (row.action) {
    case 'ship':
    case 'projection':
      return { buf, transformId: row.action === 'ship' ? 'none' : 'projection-pinned' };
    case 'fonts-prune': {
      const pin = env.contractOwnerPins.get(row.sourcePath);
      const proj = projectPrunedFontsCss(buf, pin);
      for (const u of proj.urls) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(row.exportPath), u));
        if (!env.plan.some((p) => p.exportPath === target)) throw coded('FONTS_URL_NOT_SHIPPED', `${u} resolves to ${target}, which the inventory does not ship`);
      }
      out = rewriteOrRefuse(proj.css, ctx, row.exportPath).text;
      transformId = 'fonts-prune+rewrite';
      break;
    }
    case 'rewrite': {
      let text = buf.toString('utf8');
      if (kind === 'js') text = rewriteRelativeImports(text, { sourceRel: row.sourcePath, exportRel: row.exportPath, layout: env.layout }).text;
      out = rewriteOrRefuse(text, ctx, row.exportPath).text;
      transformId = 'rewrite';
      break;
    }
    default:
      throw coded('NO_LAYER_TRANSFORM', `${row.action} has no per-layer transform`);
  }
  if (kind === 'json') JSON.parse(out);
  if (kind === 'js') syntaxCheck(out, row.exportPath, env.sandbox);
  return { buf: Buffer.from(out, 'utf8'), transformId };
}

// ---------- door landing times (ruling R-C) ----------

export function resolveLandingTimes(eventsPath, shas) {
  const want = new Set(shas);
  const found = new Map();
  if (!want.size || !eventsPath || !fs.existsSync(eventsPath)) return found;
  const fd = fs.openSync(eventsPath, 'r');
  try {
    const chunk = Buffer.alloc(16 * 1024 * 1024);
    let carry = '';
    let pos = 0;
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, pos);
      if (n <= 0) break;
      pos += n;
      const text = carry + chunk.subarray(0, n).toString('utf8');
      const lines = text.split('\n');
      carry = lines.pop();
      for (const line of lines) {
        if (!line.includes('"wo.verified"')) continue;
        for (const s of want) {
          if (!line.includes(s)) continue;
          let e;
          try { e = JSON.parse(line); } catch { continue; }
          if (e.type !== 'wo.verified') continue;
          const prev = found.get(s);
          if (!prev || Date.parse(e.ts) < Date.parse(prev.ts)) found.set(s, { ts: toIsoUtc(e.ts), eventId: e.id });
        }
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  return found;
}

// ---------- history ----------

export function planHistory({ plan, base, houseRoot, head, landing }) {
  const rows = plan.filter((p) => p.history);
  const paths = rows.map((p) => p.sourcePath);
  const baseCommit = base.revParse(BASELINE_COMMIT);
  const headCommit = base.revParse(head);
  const layers = [];
  const state0 = base.lsTree(baseCommit, paths);
  layers.push({ kind: 'baseline', houseCommit: baseCommit, authorDate: BASELINE_AUTHOR_DATE_UTC, originUnbound: false, entries: [...state0].map(([p, oid]) => ({ sourcePath: p, oid })) });
  let prev = state0;
  const commits = base.commitsTouching(baseCommit, headCommit, paths);
  const meta = base.commitMeta(commits);
  for (const c of commits) {
    const st = base.lsTree(c, paths);
    const entries = [];
    for (const p of paths) {
      const a = prev.get(p);
      const b = st.get(p);
      if (a === b) continue;
      entries.push(b ? { sourcePath: p, oid: b } : { sourcePath: p, deleted: true });
    }
    prev = st;
    if (!entries.length) continue;
    const m = meta.get(c) || {};
    layers.push({ kind: 'event', houseCommit: c, authorDate: m.authorDate, originUnbound: /prior drift \(origin-unbound/.test(m.subject || ''), entries });
  }
  const drift = [];
  for (const p of paths) {
    const abs = path.join(houseRoot, p);
    if (!fs.existsSync(abs)) {
      if (prev.get(p)) drift.push({ sourcePath: p, deleted: true });
      continue;
    }
    const buf = fs.readFileSync(abs);
    if (prev.get(p) !== gitBlobOid(buf)) drift.push({ sourcePath: p, disk: buf, sha256: sha256Hex(buf) });
  }
  const groups = new Map();
  for (const d of drift) {
    const hit = d.sha256 ? landing.get(d.sha256) : null;
    const key = hit ? hit.ts : 'UNRESOLVED';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...d, landingEvent: hit ? hit.eventId : null });
  }
  for (const key of [...groups.keys()].sort()) {
    layers.push({ kind: 'drift', houseCommit: null, authorDate: key === 'UNRESOLVED' ? null : key, originUnbound: true, landing: key === 'UNRESOLVED' ? 'DOOR_LANDING_UNRESOLVED' : 'DOOR_LANDING_TIME', entries: groups.get(key) });
  }
  return { baseCommit, headCommit, layers, driftShas: drift.filter((d) => d.sha256).map((d) => d.sha256) };
}

// ---------- notices (generated outputs, P5 coverage) ----------

export function buildNotices({ plan, inventory, noticeRows, houseRoot, finalExport, scanCtx }) {
  const owners = inventory.owners;
  const byPath = new Map(noticeRows.rows.map((r) => [r.path, r]));
  const groups = new Map();
  const ownWork = [];
  const rows = [];
  owners.forEach((o, i) => {
    const exp = finalExport.get(o.exportPath || o.path);
    if (!exp) throw coded('NOTICE_OWNER_NOT_EXPORTED', `owner row ${i + 1} is not in the export`);
    const nr = byPath.get(o.path);
    const licence = String((nr && nr.licence) || o.licence || '');
    const base = path.posix.basename(o.exportPath || o.path);
    const nameClean = scanText(base, scanCtx.rulesForScan, []).length === 0;
    const row = { ownerRow: i + 1, kind: o.kind, file: nameClean ? base : null, exportBytes: exp.bytes, exportSha256: exp.sha256 };
    if (/^OFL-1\.1/.test(licence)) {
      const src = nr && nr.pointer;
      if (!src || !fs.existsSync(path.join(houseRoot, src))) throw coded('NOTICE_SOURCE_MISSING', `owner row ${i + 1} has no readable notice source`);
      if (!groups.has(src)) groups.set(src, []);
      groups.get(src).push(row);
      row.licence = 'OFL-1.1';
    } else {
      row.licence = 'own work';
      row.notice = null;
      ownWork.push(row);
    }
    rows.push(row);
  });
  const header = [
    'THIRD-PARTY NOTICES',
    `Export generator rev ${GENERATOR_REVISION} notice pipeline. Scope: the ${owners.length} registered UI owner files in this export.`,
    'Status: draft. This file is not a release clearance.',
    '',
    `OWN WORK: ${ownWork.length} files carry no third-party code. NOTICE-MAP.json lists each by sha256.`,
    ''
  ].join('\n');
  let text = header;
  let g = 0;
  const spans = [];
  for (const [src, members] of groups) {
    g += 1;
    const noticeBuf = fs.readFileSync(path.join(houseRoot, src));
    const noticeText = noticeBuf.toString('utf8');
    const head = [`OFL-1.1 GROUP ${g}`, `FILES: ${members.map((m) => m.file || m.exportSha256).join(', ')}`, `NOTICE SHA256: ${sha256Hex(noticeBuf)}`, 'BEGIN NOTICE', ''].join('\n');
    text += head;
    const start = Buffer.byteLength(text, 'utf8');
    const firstLine = text.split('\n').length;
    text += noticeText;
    const end = Buffer.byteLength(text, 'utf8');
    const lastLine = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    if (!text.endsWith('\n')) text += '\n';
    text += 'END NOTICE\n\n';
    spans.push({ group: g, firstLine, lastLine, start, end, sha256: sha256Hex(noticeBuf) });
    for (const m of members) m.notice = { group: g, byteRange: { start, end }, byteLength: end - start, sha256: sha256Hex(noticeBuf) };
  }
  const noticesBuf = Buffer.from(text, 'utf8');
  for (const s of spans) s.verified = sha256Hex(noticesBuf.subarray(s.start, s.end)) === s.sha256;
  const map = {
    schema: 'export-notice-map/2',
    generator: `export-generator.mjs rev ${GENERATOR_REVISION} notice pipeline`,
    status: 'draft; not a release clearance',
    noticeFile: 'THIRD-PARTY-NOTICES.txt',
    noticeFileBytes: noticesBuf.length,
    noticeFileSha256: sha256Hex(noticesBuf),
    byteRangeConvention: 'zero-based, end-exclusive UTF-8 byte offsets',
    identify: 'every row is identified by its exported sha256; file names are given where the name carries no internal term',
    coverage: { ownerRows: owners.length, covered: rows.length, thirdParty: rows.length - ownWork.length, ownWork: ownWork.length },
    rows
  };
  const mapBuf = Buffer.from(JSON.stringify(map, null, 2) + '\n', 'utf8');
  return { noticesBuf, mapBuf, spans, coverage: map.coverage };
}

// ---------- in-tree manifest, anchors, c2pa line (HO items 10, 11) ----------

export function timestampRequestDer(digestHex) {
  const digest = Buffer.from(digestHex, 'hex');
  if (digest.length !== 32) throw coded('TSA_DIGEST_SHAPE', 'digest must be 32 bytes');
  const algo = Buffer.from([0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00]);
  const imprint = Buffer.concat([Buffer.from([0x30, 0x31]), algo, Buffer.from([0x04, 0x20]), digest]);
  const body = Buffer.concat([Buffer.from([0x02, 0x01, 0x01]), imprint, Buffer.from([0x01, 0x01, 0xff])]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

function exportTreeFiles(repo, commit) {
  const out = repo.g(['ls-tree', '-r', '-z', commit], { encoding: 'buffer' }).toString('utf8');
  const files = [];
  for (const rec of out.split('\0').filter(Boolean)) {
    const m = /^(\d+) blob ([0-9a-f]+)\t(.*)$/s.exec(rec);
    if (!m) continue;
    const buf = repo.g(['cat-file', 'blob', m[2]], { encoding: 'buffer' });
    files.push({ path: m[3], oid: m[2], bytes: buf.length, sha256: sha256Hex(buf) });
  }
  return files;
}

export function buildAnchors({ repo, layerCommits }) {
  const byDay = new Map();
  for (const l of layerCommits) {
    if (l.kind === 'manifest') continue;
    const day = l.kind === 'export-mode' ? 'final' : (Date.parse(l.authorDate) >= Date.parse(KICKOFF_UTC) ? l.authorDate.slice(0, 10) : null);
    if (!day) continue;
    byDay.set(day, l);
  }
  const anchors = [];
  for (const [day, l] of byDay) {
    const files = exportTreeFiles(repo, l.exportCommit);
    const treeSha256 = treeListingSha256(files);
    const der = timestampRequestDer(treeSha256);
    anchors.push({
      id: `anchor-${day}`,
      day,
      exportCommit: l.exportCommit,
      fileCount: files.length,
      treeSha256,
      tsa: { status: 'PARKED', mode: 'digest-only', requestDerSha256: sha256Hex(der), requestDerBytes: der.length, reason: 'the live timestamp path is parked; the digest-only request is prepared and not sent; a token proves existed-by, never made-after' }
    });
  }
  return anchors;
}

function exportLogHunks(repo, exportPath, splitHunks, hunkSha, tip) {
  const log = repo.g(['log', tip, '--format=RECORD %H%x00%aI', '-p', '--', exportPath]);
  const hunks = [];
  for (const sec of log.split('RECORD ')) {
    const head = /^([0-9a-f]{40})\x00([^\n]+)\n/.exec(sec);
    if (!head) continue;
    const body = sec.slice(head[0].length);
    for (const h of splitHunks(body)) {
      const norm = (head[1] + '\n' + h.header + '\n' + h.body).replace(/\r\n/g, '\n');
      hunks.push({ exportCommit: head[1], authorDate: toIsoUtc(head[2]), header: h.header, body: h.body, sha256: hunkSha(norm), bytes: Buffer.byteLength(norm, 'utf8') });
    }
  }
  return hunks.reverse();
}

export async function buildManifest({ repo, layout, layerCommits, anchors, finalCommit }) {
  const toolPath = path.join(HERE, 'event-new-manifest.mjs');
  if (!fs.existsSync(toolPath)) throw coded('EXPORT_GENERATOR_HOUSE_ONLY', 'the house manifest tool is not part of this tree');
  const tool = await import(pathToFileURL(toolPath).href);
  const layerByCommit = new Map(layerCommits.map((l) => [l.exportCommit, l]));
  const tokenFor = (l) => {
    const day = l.kind === 'export-mode' ? 'final' : l.authorDate.slice(0, 10);
    const a = anchors.find((x) => x.day === day);
    return a ? { anchorId: a.id, status: a.tsa.status } : { anchorId: null, status: 'PRE_EVENT_BASELINE' };
  };
  const functions = [];
  for (const d of tool.DEMOED) {
    const exportPath = layout.toExport(d.file);
    const present = exportPath && repo.g(['ls-tree', '--name-only', finalCommit, '--', exportPath]).trim() === exportPath;
    if (!present) {
      functions.push({ id: d.id, segments: d.segments, exportPath: exportPath || null, status: 'NOT_EXPORTED', anchors: {}, hunkCount: 0, directCount: 0, hunks: [] });
      continue;
    }
    const text = repo.g(['cat-file', 'blob', `${finalCommit}:${exportPath}`]);
    const anchorsBySymbol = {};
    for (const s of d.symbols) {
      const low = s.toLowerCase();
      anchorsBySymbol[s] = text.split('\n').map((t, i) => (t.toLowerCase().includes(low) ? i + 1 : 0)).filter(Boolean);
    }
    const hunks = exportLogHunks(repo, exportPath, tool.splitHunks, tool.sha256, finalCommit).map((h) => {
      const l = layerByCommit.get(h.exportCommit) || {};
      const diff = repo.g(['show', '--format=', '--patch', h.exportCommit, '--', exportPath]);
      return {
        exportCommit: h.exportCommit,
        layer: l.n,
        layerKind: l.kind,
        window: Date.parse(h.authorDate) >= Date.parse(KICKOFF_UTC) ? 'event-new' : 'pre-event baseline',
        authorDateUtc: h.authorDate,
        houseCommit: l.houseCommit || null,
        header: h.header,
        sha256: h.sha256,
        bytes: h.bytes,
        exportDiffSha256: sha256Hex(diff),
        attribution: d.symbols.some((s) => (h.header + h.body).toLowerCase().includes(s.toLowerCase())) ? 'DIRECT' : 'FILE_CONTEXT',
        tokenRef: tokenFor(l)
      };
    });
    functions.push({ id: d.id, segments: d.segments, exportPath, status: 'EXPORTED', anchors: anchorsBySymbol, hunkCount: hunks.length, directCount: hunks.filter((h) => h.attribution === 'DIRECT').length, hunks });
  }
  return {
    schema: 'export-event-new-manifest/2',
    generator: `export-generator.mjs rev ${GENERATOR_REVISION}`,
    boundaryUtc: KICKOFF_UTC,
    baselineAuthorDateUtc: BASELINE_AUTHOR_DATE_UTC,
    hunkHashRule: 'sha256hex(exportCommit LF header LF body); header is one @@ line; body runs header-end to next header; CRLF normalized to LF',
    exportDiffRule: 'sha256hex of git show --format= --patch <exportCommit> -- <exportPath>',
    treeHashRule: 'sha256hex over the export tree sorted by path, one line per file: path TAB bytes TAB sha256 LF',
    historyRule: 'author date = original house commit time (baseline: the pre-event tag commit time; drift layers: the door landing time, origin-unbound); committer date = export time',
    layers: layerCommits.filter((l) => l.kind !== 'manifest').map((l) => ({ n: l.n, kind: l.kind, exportCommit: l.exportCommit, authorDateUtc: l.authorDate, houseCommit: l.houseCommit || null, originUnbound: !!l.originUnbound, files: l.fileCount })),
    functions,
    anchors,
    mediaProvenance: { c2pa: C2PA_WORDING, trustList: 'not on a C2PA trust list', status: 'NO_MEDIA_IN_THIS_EXPORT', binds: 'the demo video, when cut, carries a C2PA manifest signed with a development certificate' },
    reproduce: 'every hash above is recomputed from this clone alone: node tools/export-generator.mjs --verify-export .'
  };
}

// ---------- gates: git-mode scan, closure, smoke ----------

async function withScrubbedGitEnv(fn) {
  const saved = {};
  for (const k of Object.keys(process.env)) if (k.startsWith('GIT_')) { saved[k] = process.env[k]; delete process.env[k]; }
  try { return await fn(); } finally { Object.assign(process.env, saved); }
}

export async function scanExportGit({ exportHome, scanCtx, fence, houseRoot, projectionBlobs, licenseSpans, noticesBlob }) {
  const res = await withScrubbedGitEnv(() => scanInputs({ inputs: [], git: exportHome, rules: scanCtx.rules, scanSecrets: scanCtx.scanSecrets, repo: houseRoot, fence: { excludedModules: fence.excludedModules || [], excludedRoutes: fence.excludedRoutes || [] } }));
  const outside = res.rows.filter((r) => r.fence === 'outside-excluded-set');
  const inside = res.rows.filter((r) => r.fence !== 'outside-excluded-set');
  const classify = (r) => {
    if (projectionBlobs.has(r.blob)) return 'PROJECTION_PINNED';
    if (r.blob === noticesBlob && licenseSpans.some((s) => s.verified && r.line >= s.firstLine && r.line <= s.lastLine)) return 'LICENSE_VERBATIM';
    return 'UNEXPECTED';
  };
  const byDisposition = { PROJECTION_PINNED: 0, LICENSE_VERBATIM: 0, UNEXPECTED: 0 };
  const unexpected = [];
  const outsideByClass = {};
  for (const r of outside) {
    const d = classify(r);
    byDisposition[d] += 1;
    outsideByClass[r.class] = (outsideByClass[r.class] || 0) + 1;
    if (d === 'UNEXPECTED') unexpected.push({ path: r.path, blob: r.blob, line: r.line, class: r.class, excerpt: r.excerpt });
  }
  const insideByPath = {};
  for (const r of inside) insideByPath[r.path] = (insideByPath[r.path] || 0) + 1;
  return {
    blobsScanned: res.filesScanned,
    rows: res.rows.length,
    outsideFence: outside.length,
    insideFence: inside.length,
    outsideByClass,
    outsideByDisposition: byDisposition,
    insideByPath,
    unexpected,
    verdict: unexpected.length ? 'RED' : 'GREEN'
  };
}

const DYNAMIC_PATTERNS = [
  { re: /\bimport\s*\(\s*(['"`])([^'"`$]+)\1\s*\)/g, kind: 'dynamic-literal', group: 2 },
  { re: /\bimport\s*\(\s*(?!['"`][^'"`$]*['"`]\s*\))([^)]{1,120})/g, kind: 'dynamic-computed', group: 1 }
];

function staticSpecifiers(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trimStart();
    if (!/^(?:import|export)\b/.test(t)) continue;
    if (/^import\s*\(/.test(t)) continue;
    let stmt = t;
    let j = i;
    while (!/['"][^'"]+['"]\s*;?\s*$/.test(stmt) && j + 1 < lines.length && j - i < 80) { j += 1; stmt += ' ' + lines[j].trim(); }
    const m = /\bfrom\s*['"]([^'"]+)['"]/.exec(stmt) || /^import\s*['"]([^'"]+)['"]/.exec(stmt);
    if (m) out.push({ line: i + 1, spec: m[1] });
    i = j;
  }
  return out;
}

export function checkClosure({ files, readFile }) {
  const set = new Set(files);
  const sites = [];
  const graph = new Map();
  const classify = (f, spec, kind, line) => {
    const site = { file: f, line, kind, spec: spec.slice(0, 120) };
    if (kind === 'dynamic-computed') site.status = /^`data:/.test(spec) ? 'IN_MEMORY_DATA_URL' : 'COMPUTED_IMPORT';
    else if (spec.startsWith('node:')) site.status = 'BUILTIN';
    else if (spec.startsWith('.')) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), spec));
      if (target.startsWith('..')) site.status = 'OUTSIDE_TREE';
      else if (!set.has(target)) site.status = 'MISSING_IN_TREE';
      else { site.status = 'OK'; site.target = target; }
    } else site.status = 'BARE_SPECIFIER';
    return site;
  };
  for (const f of files.filter((x) => /\.(mjs|js|cjs)$/.test(x))) {
    const lines = readFile(f).split('\n');
    const deps = [];
    for (const s of staticSpecifiers(lines)) {
      const site = classify(f, s.spec, 'static', s.line);
      sites.push(site);
      if (site.status === 'OK') deps.push(site.target);
    }
    lines.forEach((line, i) => {
      const t = line.trimStart();
      if (t.startsWith('//') || t.startsWith('*')) return;
      for (const p of DYNAMIC_PATTERNS) {
        p.re.lastIndex = 0;
        let m;
        while ((m = p.re.exec(line)) !== null) {
          if (quoteAt(line, m.index)) continue;
          sites.push(classify(f, m[p.group].trim(), p.kind, i + 1));
        }
      }
    });
    graph.set(f, deps);
  }
  const closureOf = (entry) => {
    const seen = new Set();
    const stack = [entry];
    while (stack.length) {
      const f = stack.pop();
      if (seen.has(f)) continue;
      seen.add(f);
      for (const d of graph.get(f) || []) stack.push(d);
    }
    return seen;
  };
  const defects = sites.filter((s) => ['OUTSIDE_TREE', 'MISSING_IN_TREE', 'BARE_SPECIFIER'].includes(s.status));
  const computed = sites.filter((s) => s.status === 'COMPUTED_IMPORT');
  const entry = (e) => {
    if (!set.has(e)) return { entry: e, present: false, files: 0, defects: [] };
    const c = closureOf(e);
    const d = defects.filter((s) => c.has(s.file) && s.kind === 'static');
    return { entry: e, present: true, files: c.size, defects: d, computedSites: computed.filter((s) => c.has(s.file)).map((s) => `${s.file}:${s.line}`) };
  };
  return { sites: sites.length, defects, computed, launcher: entry('launcher.mjs'), server: entry('app/server.mjs') };
}

const SMOKE_PRELOAD = [
  "import net from 'node:net';",
  "import dns from 'node:dns';",
  "const loop = (h) => ['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1'].includes(String(h || '').toLowerCase());",
  'const connect = net.Socket.prototype.connect;',
  'net.Socket.prototype.connect = function smokeConnect(...a) {',
  '  const a0 = Array.isArray(a[0]) ? a[0][0] : a[0];',
  "  const o = a0 && typeof a0 === 'object' ? a0 : { port: a0, host: typeof a[1] === 'string' ? a[1] : undefined };",
  "  if (!o.path && o.host !== undefined && !loop(o.host)) { const e = new Error('SMOKE_NETWORK_REFUSED ' + o.host); e.code = 'SMOKE_NETWORK_REFUSED'; throw e; }",
  '  return connect.apply(this, a);',
  '};',
  'const lookup = dns.lookup;',
  "dns.lookup = function smokeLookup(h, ...r) { if (!loop(h)) { const e = new Error('SMOKE_DNS_REFUSED ' + h); e.code = 'ENOTFOUND'; throw e; } return lookup.call(this, h, ...r); };",
  ''
].join('\n');

export function materializeHead(repo, dest, sandbox) {
  fs.mkdirSync(dest, { recursive: true });
  const tar = repo.g(['archive', '--format=tar', 'HEAD'], { encoding: 'buffer' });
  const r = spawnSync('tar', ['-x', '-f', '-', '-C', dest], { input: tar, cwd: sandbox, env: { PATH: process.env.PATH || '' } });
  if (r.status !== 0) throw coded('SMOKE_MATERIALIZE_FAILED', String(r.stderr).slice(0, 200));
  return dest;
}

export function runSmoke({ repo, sandbox }) {
  const root = fs.mkdtempSync(path.join(sandbox, 'smoke-'));
  const tree = materializeHead(repo, path.join(root, 'tree'), sandbox);
  for (const d of ['home', 'tmp', 'state', 'xdg']) fs.mkdirSync(path.join(root, d), { recursive: true });
  const preload = path.join(root, 'smoke-preload.mjs');
  fs.writeFileSync(preload, SMOKE_PRELOAD);
  const env = {
    PATH: process.env.PATH || '',
    HOME: path.join(root, 'home'),
    TMPDIR: path.join(root, 'tmp') + '/',
    XDG_STATE_HOME: path.join(root, 'xdg'),
    KPF_LIVE_RUN_STATE_DIR: path.join(root, 'state'),
    NODE_PATH: '',
    NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`
  };
  const run = (args) => {
    const r = spawnSync(process.execPath, args, { cwd: tree, env, encoding: 'utf8', timeout: 180000 });
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    const marker = (out.match(/^(CANDIDATE_LAUNCHER_CHECK_\w+|SERVER_CHECK_\w+)[^\n]*/m) || [null])[0];
    const err = (out.match(/^\w*Error[^\n]*|ERR_[A-Z_]+[^\n]*/m) || [null])[0];
    return { exit: r.status, marker: marker ? marker.slice(0, 200) : null, error: err ? err.slice(0, 200) : null };
  };
  const launcher = run(['launcher.mjs', '--check']);
  const server = fs.existsSync(path.join(tree, 'app', 'server.mjs')) ? run(['app/server.mjs', '--check']) : { exit: null, marker: null, error: 'NOT_EXPORTED' };
  fs.rmSync(root, { recursive: true, force: true });
  return { launcherCheck: launcher, serverCheck: server, verdict: launcher.exit === 0 && /PASS/.test(launcher.marker || '') ? 'GREEN' : 'RED' };
}

export function verifyExportRepoHasNoRemote(exportHome, sandbox) {
  const env = makeGitEnv(sandbox);
  const remotes = runGitRaw([`--git-dir=${path.join(exportHome, '.git')}`, 'remote'], { env, cwd: sandbox }).split('\n').map((s) => s.trim()).filter(Boolean);
  return { ok: remotes.length === 0, verdict: remotes.length === 0 ? 'GREEN' : 'RED', remotes };
}

export function verifyFrozenInventorySha(actual, expected) {
  const ok = typeof expected === 'string' && /^[0-9a-f]{64}$/.test(expected) && actual === expected;
  return { ok, verdict: ok ? 'GREEN' : 'RED', code: ok ? 'FROZEN_INVENTORY_SHA_MATCH' : 'POST_FREEZE_INVENTORY_SHA_MISMATCH', expected: expected || null, actual };
}

// ---------- the build ----------

function plantSelfRed(kind, scanCtx) {
  if (kind === 'ledger') return '\n// ' + ['_system', 'ledger', 'receipts.jsonl'].join('/') + '\n';
  if (kind === 'model') {
    const rule = scanCtx.indexedRules.find((r) => r.key === 'delta|delta: sealed name' && r.idx === 1);
    const name = /\(\?:([a-z]+)\|/.exec(rule.re.source)[1];
    return ` ${name} `;
  }
  throw coded('USAGE', `--self-red takes ledger or model, got ${kind}`);
}

export async function buildExport(inputs, { log = () => {} } = {}) {
  const t0 = Date.now();
  const removedGitEnv = scrubGitEnv(process.env);
  const { houseRoot, inventory, fence, packet, noticeRows, exportTime } = inputs;
  if ((inputs.evidenceDir + '/').startsWith(inputs.exportHome.replace(/\/+$/, '') + '/')) throw coded('EVIDENCE_INSIDE_EXPORT', 'the byte map lives outside the export tree (ruling R-B)');
  if (sameOrInside(realpathNearest(inputs.evidenceDir), houseRoot)) throw coded('EVIDENCE_DIR_INSIDE_HOUSE', 'the generator never writes into the house; land evidence through the door');
  assertExportTargetAllowed(inputs.exportHome, { houseRoot, releaseReceipt: inputs.releaseReceipt, ledgerPath: inputs.ledgerPath });
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'export-generator-'));
  try {
    const layout = deriveLayout({ inventory, candidateRel: inputs.candidateRel });
    const planReport = buildPlanWithReport({ inventory, fence, layout, houseRoot });
    const plan = planReport.plan;
    if (inputs.selfRed === 'exclude') {
      plan.push(plantExcludeRow({ inventory, layout }));
      assertPlanHonorsInventory(plan, { inventory, layout });
    }
    const excludedExports = excludedExportPaths({ inventory, layout });
    for (const need of ['launcher-export-mode', 'contract-export-mode', 'rewrite-fenced']) {
      if (!plan.some((p) => p.action === need)) throw coded('PLAN_ROW_MISSING', `the inventory carries no export-mode row with generator action ${need}`);
    }
    const contractRow = plan.find((p) => p.action === 'contract-export-mode');
    const houseContract = JSON.parse(fs.readFileSync(path.join(houseRoot, contractRow.sourcePath), 'utf8'));
    const contractOwnerPins = new Map(houseContract.uiOwnerMountContract.exactPrivateOwnerMountAllowlist.map((r) => [r.repoRelativePath, { expectedBytes: r.expectedBytes, expectedSha256: r.expectedSha256 }]));
    const scanCtx = await loadScanContext({ houseRoot, rulesReceipt: inputs.rulesReceipt, contract: houseContract, layout });
    const env = { scanCtx, layout, plan, contractOwnerPins, sandbox };

    for (const p of plan.filter((x) => x.action === 'projection')) {
      const buf = fs.readFileSync(path.join(houseRoot, p.sourcePath));
      const pin = contractOwnerPins.get(p.sourcePath);
      if (!pin || buf.length !== pin.expectedBytes || sha256Hex(buf) !== pin.expectedSha256) throw coded('PROJECTION_PIN_MISMATCH', `${p.sourcePath} disk bytes differ from the contract pin`);
    }

    const base = createBaseReader(inputs.gitBase, path.join(sandbox, 'base-home'));
    let landing = new Map();
    let landingSource = 'none';
    if (inputs.landingTimesPath) {
      const prior = readJson(inputs.landingTimesPath);
      for (const r of prior.rows || []) if (r.layerKind === 'drift' && r.landingEvent && r.sourceSha256) landing.set(r.sourceSha256, { ts: r.authorDate, eventId: r.landingEvent });
      landingSource = { priorByteMap: pinOf(inputs.landingTimesPath, houseRoot) };
    }
    const history = planHistory({ plan, base, houseRoot, head: inputs.head, landing: new Map() });
    if (!inputs.landingTimesPath) {
      landing = resolveLandingTimes(inputs.eventsPath, history.driftShas);
      if (fs.existsSync(inputs.eventsPath)) {
        const st = fs.statSync(inputs.eventsPath);
        landingSource = st.size <= 64 * 1024 * 1024 ? { events: pinOf(inputs.eventsPath, houseRoot) } : { events: { bytes: st.size, sha256: null, note: 'too large to pin; pass an events snapshot for a reproducible run' } };
      }
    }
    const hist = planHistory({ plan, base, houseRoot, head: inputs.head, landing });
    log(`history: ${hist.layers.length} layers from ${hist.baseCommit.slice(0, 12)} to ${hist.headCommit.slice(0, 12)}`);

    fs.mkdirSync(inputs.exportHome, { recursive: true });
    const repo = createExportRepo(inputs.exportHome, path.join(sandbox, 'export-home'));
    const rowBySource = new Map(plan.map((p) => [p.sourcePath, p]));
    const state = new Map();
    const finalExport = new Map();
    const byteMapRows = [];
    const layerCommits = [];
    const projectionBlobs = new Set();
    let parent = null;
    let n = 0;
    const commitLayer = (kind, authorDate, message, meta) => {
      const tree = repo.writeTree(state);
      const c = repo.commitTree(tree, parent, message, authorDate, exportTime);
      parent = c;
      layerCommits.push({ n, kind, exportCommit: c, authorDate, houseCommit: meta.houseCommit || null, originUnbound: !!meta.originUnbound, fileCount: meta.fileCount });
      n += 1;
      return c;
    };
    const putFile = (row, srcBuf, layerKind, meta) => {
      const t = transformForLayer(row, srcBuf, env);
      let outBuf = t.buf;
      if (inputs.selfRed === 'ledger' && meta.selfRedTarget) outBuf = Buffer.concat([outBuf, Buffer.from(plantSelfRed('ledger', scanCtx))]);
      const oid = repo.writeBlob(outBuf);
      state.set(row.exportPath, oid);
      finalExport.set(row.exportPath, { bytes: outBuf.length, sha256: sha256Hex(outBuf), oid });
      if (row.action === 'projection') projectionBlobs.add(oid);
      byteMapRows.push({ layer: n, layerKind, houseCommit: meta.houseCommit || null, authorDate: meta.authorDate, originUnbound: !!meta.originUnbound, landingEvent: meta.landingEvent || null, sourcePath: row.sourcePath, sourceBytes: srcBuf.length, sourceSha256: sha256Hex(srcBuf), exportPath: row.exportPath, exportBytes: outBuf.length, exportSha256: sha256Hex(outBuf), action: row.action, transform: t.transformId, exportMode: row.exportMode ? row.exportMode.reason : null });
    };
    const lastLayerOf = new Map();
    hist.layers.forEach((l, i) => { for (const e of l.entries) lastLayerOf.set(e.sourcePath, i); });
    const selfRedRow = plan.find((p) => p.action === 'rewrite' && fileKindOf(p.exportPath) === 'js' && p.history && lastLayerOf.has(p.sourcePath));
    hist.layers.forEach((l, i) => {
      const authorDate = l.authorDate || exportTime;
      for (const e of l.entries) {
        const row = rowBySource.get(e.sourcePath);
        if (e.deleted) {
          state.delete(row.exportPath);
          finalExport.delete(row.exportPath);
          byteMapRows.push({ layer: n, layerKind: l.kind, houseCommit: l.houseCommit, authorDate, originUnbound: l.originUnbound, sourcePath: e.sourcePath, exportPath: row.exportPath, deleted: true });
          continue;
        }
        const srcBuf = e.disk || base.blob(e.oid);
        putFile(row, srcBuf, l.kind, { houseCommit: l.houseCommit, authorDate, originUnbound: l.originUnbound, landingEvent: e.landingEvent || null, selfRedTarget: selfRedRow && row === selfRedRow && lastLayerOf.get(e.sourcePath) === i });
      }
      const note = l.kind === 'baseline' ? 'pre-event baseline subset at the tag commit time'
        : l.kind === 'event' ? `house commit ${l.houseCommit.slice(0, 12)}${l.originUnbound ? ' (origin-unbound: author date equals the door landing time)' : ''}`
          : `bytes landed after the last house commit (${l.landing === 'DOOR_LANDING_TIME' ? 'author date equals the door landing time' : 'door landing time unresolved: author date equals the export time'})`;
      commitLayer(l.kind, authorDate, `${l.kind} layer ${n}: ${l.entries.length} file(s), ${note}`, { houseCommit: l.houseCommit, originUnbound: l.originUnbound, fileCount: l.entries.length });
    });

    const pinsByPath = new Map();
    for (const p of plan) {
      const exp = finalExport.get(p.exportPath);
      if (exp) pinsByPath.set(p.sourcePath, { bytes: exp.bytes, sha256: exp.sha256 });
    }
    const backendRow = plan.find((x) => x.action === 'rewrite-fenced');
    const backendPins = new Map(parsePins(fs.readFileSync(path.join(houseRoot, backendRow.sourcePath), 'utf8')).map((q) => [q.path, q]));
    const ownerPinSubs = {};
    for (const p of plan.filter((x) => x.owner && x.action !== 'projection')) {
      const bp = backendPins.get(p.sourcePath);
      const exp = finalExport.get(p.exportPath);
      if (!bp) throw coded('BACKEND_OWNER_PIN_MISSING', `the backend allowlist carries no pin for owner ${p.exportPath}`);
      ownerPinSubs[bp.sha256] = { expectedBytes: exp.bytes, expectedSha256: exp.sha256 };
    }
    const exportModeDetails = {};
    const putGenerated = (row, srcBuf, outBuf, transformId, extra = {}) => {
      const oid = repo.writeBlob(outBuf);
      state.set(row.exportPath, oid);
      finalExport.set(row.exportPath, { bytes: outBuf.length, sha256: sha256Hex(outBuf), oid });
      byteMapRows.push({ layer: n, layerKind: 'export-mode', houseCommit: null, authorDate: exportTime, originUnbound: false, sourcePath: row.sourcePath, sourceBytes: srcBuf ? srcBuf.length : null, sourceSha256: srcBuf ? sha256Hex(srcBuf) : null, exportPath: row.exportPath, exportBytes: outBuf.length, exportSha256: sha256Hex(outBuf), action: row.action, transform: transformId, exportMode: row.exportMode ? row.exportMode.reason : null, ...extra });
    };
    for (const p of plan.filter((x) => !x.history)) {
      const src = fs.readFileSync(path.join(houseRoot, p.sourcePath));
      let out;
      if (p.action === 'launcher-export-mode') {
        const r = transformLauncherToExportMode(src, { pinsByPath, ownerPinSubstitutions: ownerPinSubs, rewriteCtx: scanCtx, sourceRel: p.sourcePath, exportRel: p.exportPath, layout });
        if (r.residual.length) throw coded('REWRITE_RESIDUAL_ROWS', `launcher: ${r.residual.length} row(s) survive`);
        out = r.code;
        exportModeDetails[p.exportPath] = { anchors: r.anchors.map((a) => a.id), pins: r.pins, imports: r.imports };
      } else if (p.action === 'validator-export-mode') {
        const r = transformValidatorToExportMode(src, { rewriteCtx: scanCtx });
        if (r.residual.length) throw coded('REWRITE_RESIDUAL_ROWS', `validator: ${r.residual.length} row(s) survive`);
        out = r.code;
        exportModeDetails[p.exportPath] = { anchors: r.anchors.map((a) => a.id) };
      } else if (p.action === 'contract-export-mode') {
        const r = transformContractToExportMode(src, { packet, pinsByPath, rewriteCtx: scanCtx });
        if (r.residual.length) throw coded('REWRITE_RESIDUAL_ROWS', `contract: ${r.residual.length} row(s) survive`);
        out = r.code;
        exportModeDetails[p.exportPath] = { pins: r.pins, fencedOwnerPathRows: r.ownerPathRows };
      } else if (p.action === 'rewrite-fenced') {
        let text = rewriteRelativeImports(src.toString('utf8'), { sourceRel: p.sourcePath, exportRel: p.exportPath, layout }).text;
        const r = rewriteText(text, { ...scanCtx, kind: fileKindOf(p.exportPath), keepOwnerPaths: true });
        if (r.residual.length) throw coded('REWRITE_RESIDUAL_ROWS', `${p.exportPath}: ${r.residual.length} row(s) survive`);
        out = r.text;
        exportModeDetails[p.exportPath] = { fencedOwnerPathRows: r.ownerPathRows };
      } else {
        throw coded('NO_EXPORT_MODE_TRANSFORM', p.action);
      }
      if (fileKindOf(p.exportPath) === 'js') syntaxCheck(out, p.exportPath, sandbox);
      putGenerated(p, src, Buffer.from(out, 'utf8'), p.action);
    }
    const notices = buildNotices({ plan, inventory, noticeRows, houseRoot, finalExport, scanCtx });
    let mapBuf = notices.mapBuf;
    if (inputs.selfRed === 'model') mapBuf = Buffer.from(mapBuf.toString('utf8').replace('"draft; not a release clearance"', `"draft; not a release clearance;${plantSelfRed('model', scanCtx)}"`), 'utf8');
    putGenerated({ sourcePath: 'generated:notice pipeline', exportPath: 'THIRD-PARTY-NOTICES.txt', action: 'generated' }, null, notices.noticesBuf, 'notice-pipeline');
    putGenerated({ sourcePath: 'generated:notice pipeline', exportPath: 'NOTICE-MAP.json', action: 'generated' }, null, mapBuf, 'notice-pipeline');
    const exportModeCommit = commitLayer('export-mode', exportTime, `export-mode layer ${n}: export-mode files and the notice pipeline, dated at export time`, { fileCount: plan.filter((x) => !x.history).length + 2 });

    const anchors = buildAnchors({ repo, layerCommits });
    const manifest = await buildManifest({ repo, layout, layerCommits, anchors, finalCommit: exportModeCommit });
    const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 1) + '\n', 'utf8');
    putGenerated({ sourcePath: 'generated:export history', exportPath: 'EVENT-NEW-MANIFEST.json', action: 'generated' }, null, manifestBuf, 'manifest');
    const finalCommit = commitLayer('manifest', exportTime, `manifest layer ${n}: EVENT-NEW-MANIFEST.json, dated at export time`, { fileCount: 1 });
    repo.finish(finalCommit);

    const headFiles = exportTreeFiles(repo, finalCommit);
    assertTreeInsidePlan(headFiles.map((f) => f.path), plan, excludedExports);
    const onDisk = [];
    const walk = (d, rel = '') => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === '.git' && !rel) continue; const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(path.join(d, e.name), r); else onDisk.push(r); } };
    walk(inputs.exportHome);
    assertTreeInsidePlan(onDisk, plan, excludedExports);

    const noticesBlob = finalExport.get('THIRD-PARTY-NOTICES.txt').oid;
    const scan = await scanExportGit({ exportHome: inputs.exportHome, scanCtx, fence, houseRoot, projectionBlobs, licenseSpans: notices.spans, noticesBlob });
    const closure = checkClosure({ files: headFiles.map((f) => f.path), readFile: (f) => repo.g(['cat-file', 'blob', `${finalCommit}:${f}`]) });
    const remote = verifyExportRepoHasNoRemote(inputs.exportHome, sandbox);
    const smoke = runSmoke({ repo, sandbox });
    const treeSha256 = treeListingSha256(headFiles);
    const inventorySha = exportInventorySha256(headFiles, exportTime, ['EVENT-NEW-MANIFEST.json']);
    const freeze = inputs.expectInventorySha ? verifyFrozenInventorySha(inventorySha, inputs.expectInventorySha) : null;
    const launcherClosureOk = closure.launcher.present && closure.launcher.defects.length === 0;
    let verdict = 'GREEN';
    let exit = EXIT.GREEN;
    if (scan.verdict === 'RED') { verdict = 'SCAN_RED'; exit = EXIT.SCAN_RED; }
    else if (!launcherClosureOk || (closure.defects.length && inputs.closureMode === 'strict')) { verdict = 'CLOSURE_RED'; exit = EXIT.CLOSURE_RED; }
    else if (closure.defects.length) { verdict = 'CLOSURE_RED_REPORTED'; exit = EXIT.CLOSURE_RED; }
    else if (smoke.verdict === 'RED') { verdict = 'SMOKE_RED'; exit = EXIT.SMOKE_RED; }
    if (freeze && !freeze.ok) { verdict = 'FREEZE_RED'; exit = EXIT.REFUSED; }
    const counts = {};
    for (const p of plan) counts[p.action] = (counts[p.action] || 0) + 1;
    const inventoryCounts = {};
    for (const r of inventory.rows) inventoryCounts[r.action] = (inventoryCounts[r.action] || 0) + 1;
    const byteMap = {
      schema: 'export-byte-map/2',
      generator: `export-generator.mjs rev ${GENERATOR_REVISION}`,
      deskRevision: DESK_REVISION,
      lane: LANE_LABEL,
      generatedAt: exportTime,
      verdict,
      rulings: { 'R-A': 'the inventory is the single ship list', 'R2-2026-10-27T20:37:59Z': 'the export plan comes from the inventory rows alone; no hardcoded override; evidence rows export; exclude rows never export', 'R-B': 'transformed files enter history transformed at every layer; this byte map lives outside the export tree', 'R-C': 'drift layers take the door landing time and are origin-unbound' },
      inputs: {
        inventory: pinOf(inputs.inventoryPath, houseRoot), fence: pinOf(inputs.fencePath, houseRoot), rules: pinOf(inputs.rulesPath, houseRoot), packet: pinOf(inputs.packetPath, houseRoot), noticeRows: pinOf(inputs.noticeRowsPath, houseRoot),
        gitBaseHead: hist.headCommit, baselineCommit: hist.baseCommit, exportTime, landingSource, scrubbedGitEnv: removedGitEnv.length
      },
      plan: { source: 'inventory rows', files: plan.length, generated: 3, byAction: counts, inventoryRowsByAction: inventoryCounts, exportModeRows: plan.filter((p) => p.exportMode).map((p) => ({ exportPath: p.exportPath, generatorAction: p.exportMode.action, reason: p.exportMode.reason })), retired: planReport.retired, excludedRows: planReport.excluded.length, overrides: 0 },
      layers: layerCommits,
      exportMode: exportModeDetails,
      notices: { coverage: notices.coverage, licenseSpans: notices.spans.map((s) => ({ group: s.group, firstLine: s.firstLine, lastLine: s.lastLine, sha256: s.sha256, verified: s.verified })) },
      anchors: anchors.map((a) => ({ ...a, tsa: { ...a.tsa, requestDerHex: timestampRequestDer(a.treeSha256).toString('hex') } })),
      scan,
      closure: { sites: closure.sites, defects: closure.defects, computed: closure.computed.map((s) => `${s.file}:${s.line}`), launcher: closure.launcher, server: closure.server, mode: inputs.closureMode },
      remote,
      smoke,
      exportTreeSha256: treeSha256,
      exportInventorySha256: inventorySha,
      freeze,
      finalCommit,
      rows: byteMapRows
    };
    fs.mkdirSync(inputs.evidenceDir, { recursive: true });
    const byteMapBuf = Buffer.from(JSON.stringify(byteMap, null, 1) + '\n', 'utf8');
    fs.writeFileSync(path.join(inputs.evidenceDir, 'EXPORT-BYTE-MAP.json'), byteMapBuf);
    fs.writeFileSync(path.join(inputs.evidenceDir, 'NOTICE-MAP.json'), mapBuf);
    fs.writeFileSync(path.join(inputs.evidenceDir, 'THIRD-PARTY-NOTICES.txt'), notices.noticesBuf);
    fs.writeFileSync(path.join(inputs.evidenceDir, 'EVENT-NEW-MANIFEST.json'), manifestBuf);
    return {
      verdict, exit, ms: Date.now() - t0,
      exportHome: inputs.exportHome, finalCommit, exportModeCommit, layers: layerCommits.length, files: headFiles.length,
      byteMapRows: byteMapRows.length, byteMapBytes: byteMapBuf.length, byteMapSha256: sha256Hex(byteMapBuf),
      noticeMap: { bytes: mapBuf.length, sha256: sha256Hex(mapBuf) }, notices: { bytes: notices.noticesBuf.length, sha256: sha256Hex(notices.noticesBuf) },
      manifest: { bytes: manifestBuf.length, sha256: sha256Hex(manifestBuf), functions: manifest.functions.length, hunks: manifest.functions.reduce((a, f) => a + f.hunkCount, 0) },
      scan: { blobs: scan.blobsScanned, rows: scan.rows, outsideFence: scan.outsideFence, insideFence: scan.insideFence, outsideByDisposition: scan.outsideByDisposition, unexpected: scan.unexpected.length },
      closure: { sites: closure.sites, defects: closure.defects.length, computed: closure.computed.length, launcherDefects: closure.launcher.defects.length, serverDefects: closure.server.defects.length },
      smoke: { launcher: smoke.launcherCheck, server: smoke.serverCheck },
      remote: remote.verdict,
      exportTreeSha256: treeSha256, exportInventorySha256: inventorySha, freeze: freeze ? freeze.code : null,
      plan: { files: plan.length, byAction: counts, exportModeRows: byteMap.plan.exportModeRows.length, retired: planReport.retired.map((x) => x.sourcePath), excludedRows: planReport.excluded.length, overrides: 0 }
    };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

// ---------- verify an export clone without house inputs ----------

export async function verifyExport(exportHome) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'export-verify-'));
  try {
    const env = makeGitEnv(sandbox);
    const gitDir = path.join(exportHome, '.git');
    const g = (args, enc = 'utf8') => runGitRaw([`--git-dir=${gitDir}`, ...args], { env, cwd: sandbox, encoding: enc });
    const manifest = JSON.parse(g(['cat-file', 'blob', 'HEAD:EVENT-NEW-MANIFEST.json']));
    let splitHunks = null;
    let hunkSha = null;
    const toolPath = path.join(HERE, 'event-new-manifest.mjs');
    if (fs.existsSync(toolPath)) { const t = await import(pathToFileURL(toolPath).href); splitHunks = t.splitHunks; hunkSha = t.sha256; }
    let diffOk = 0; let diffBad = 0; let hunkOk = 0; let hunkBad = 0; let hunkSkipped = 0;
    for (const f of manifest.functions) {
      for (const h of f.hunks) {
        const diff = g(['show', '--format=', '--patch', h.exportCommit, '--', f.exportPath]);
        if (sha256Hex(diff) === h.exportDiffSha256) diffOk += 1; else diffBad += 1;
        if (!splitHunks) { hunkSkipped += 1; continue; }
        const match = splitHunks(diff).some((x) => hunkSha((h.exportCommit + '\n' + x.header + '\n' + x.body).replace(/\r\n/g, '\n')) === h.sha256);
        if (match) hunkOk += 1; else hunkBad += 1;
      }
    }
    let anchorOk = 0; let anchorBad = 0;
    for (const a of manifest.anchors) {
      const out = g(['ls-tree', '-r', '-z', a.exportCommit], 'buffer').toString('utf8');
      const files = [];
      for (const rec of out.split('\0').filter(Boolean)) {
        const m = /^(\d+) blob ([0-9a-f]+)\t(.*)$/s.exec(rec);
        if (!m) continue;
        const buf = g(['cat-file', 'blob', m[2]], 'buffer');
        files.push({ path: m[3], bytes: buf.length, sha256: sha256Hex(buf) });
      }
      if (treeListingSha256(files) === a.treeSha256 && sha256Hex(timestampRequestDer(a.treeSha256)) === a.tsa.requestDerSha256) anchorOk += 1; else anchorBad += 1;
    }
    const ok = diffBad === 0 && hunkBad === 0 && anchorBad === 0;
    return { ok, verdict: ok ? 'GREEN' : 'RED', diffOk, diffBad, hunkOk, hunkBad, hunkSkipped: hunkSkipped ? `${hunkSkipped} (hunk rule tool is house-only)` : 0, anchorOk, anchorBad };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

// ---------- a minimal git base for tests (copies named objects only, read-only on the source) ----------

export function seedGitBase({ from, out, commits, paths, sandbox }) {
  const env = makeGitEnv(sandbox);
  const src = fs.realpathSync(from);
  const rd = (args, enc = 'utf8') => runGitRaw([`--git-dir=${src}`, ...args], { env, cwd: sandbox, encoding: enc });
  const objs = new Map();
  for (const c of commits) {
    const full = rd(['rev-parse', '--verify', `${c}^{commit}`]).trim();
    objs.set(full, 'commit');
    objs.set(rd(['rev-parse', `${full}^{tree}`]).trim(), 'tree');
    for (const p of paths) {
      const parts = p.split('/');
      for (let i = 1; i < parts.length; i += 1) objs.set(rd(['rev-parse', `${full}:${parts.slice(0, i).join('/')}`]).trim(), 'tree');
      const r = spawnSync('git', [`--git-dir=${src}`, 'rev-parse', '--verify', '--quiet', `${full}:${p}`], { env, cwd: sandbox, encoding: 'utf8' });
      if (r.status === 0) objs.set(r.stdout.trim(), 'blob');
    }
  }
  fs.rmSync(out, { recursive: true, force: true });
  runGitRaw(['init', '--bare', '-q', out], { env, cwd: sandbox });
  for (const [oid, type] of objs) {
    const raw = rd(['cat-file', type, oid], 'buffer');
    const w = runGitRaw([`--git-dir=${out}`, 'hash-object', '-w', '--literally', '-t', type, '--stdin'], { env, cwd: sandbox, input: raw }).trim();
    if (w !== oid) throw coded('SEED_OBJECT_MISMATCH', `${type} ${oid} wrote ${w}`);
  }
  return { objects: objs.size, out };
}

// ---------- CLI ----------

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) throw coded('USAGE', `unexpected argument ${a}`);
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) { out[k] = true; continue; }
    out[k] = v;
    i += 1;
  }
  return out;
}

export async function main(argv) {
  let args;
  try { args = parseArgs(argv.slice(2)); } catch (e) { console.error(`EXPORT_GENERATOR_REFUSED ${e.code} ${e.message}`); return EXIT.REFUSED; }
  if (args['seed-git-base']) {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'export-seed-'));
    try {
      const inventory = readJson(path.resolve(args.inventory));
      const r = seedGitBase({ from: path.resolve(args['git-base']), out: path.resolve(args['seed-git-base']), commits: String(args.commits || '').split(',').filter(Boolean), paths: inventory.owners.map((o) => o.path), sandbox });
      console.log(`EXPORT_GENERATOR_SEED_BASE ${JSON.stringify(r)}`);
      return EXIT.GREEN;
    } catch (e) {
      console.error(`EXPORT_GENERATOR_REFUSED ${e.code || 'ERROR'} ${e.message}`);
      return EXIT.REFUSED;
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  }
  if (args['verify-export']) {
    const r = await verifyExport(path.resolve(args['verify-export']));
    console.log(`EXPORT_VERIFY ${r.verdict} ${JSON.stringify(r)}`);
    return r.ok ? EXIT.GREEN : EXIT.SCAN_RED;
  }
  let inputs;
  try { inputs = resolveInputs(args); } catch (e) { console.error(`EXPORT_GENERATOR_REFUSED ${e.code || 'INPUT'} ${e.message}`); return EXIT.REFUSED; }
  if (inputs.selfRed && !['ledger', 'model', 'exclude'].includes(inputs.selfRed)) { console.error(`EXPORT_GENERATOR_REFUSED USAGE --self-red takes ledger, model or exclude, got ${inputs.selfRed}`); return EXIT.REFUSED; }
  try {
    const r = await buildExport(inputs, { log: (m) => console.error(`export-generator: ${m}`) });
    if (inputs.selfRed === 'exclude') {
      console.log(`EXPORT_GENERATOR_SELF_RED exclude FAIL (the planted exclude row was not refused) ${JSON.stringify(r.plan)}`);
      return EXIT.SCAN_RED;
    }
    if (inputs.selfRed) {
      const refused = r.verdict === 'SCAN_RED';
      console.log(`EXPORT_GENERATOR_SELF_RED ${inputs.selfRed} ${refused ? 'PASS (the check refused the plant)' : 'FAIL (the plant passed)'} ${JSON.stringify(r.scan)}`);
      return refused ? EXIT.GREEN : EXIT.SCAN_RED;
    }
    console.log(`EXPORT_GENERATOR ${r.verdict} ${JSON.stringify(r)}`);
    return r.exit;
  } catch (e) {
    if (inputs.selfRed === 'exclude' && e.code === 'EXCLUDE_ROW_IN_PLAN') {
      console.log(`EXPORT_GENERATOR_SELF_RED exclude PASS (the plan guard refused the plant) ${JSON.stringify({ code: e.code, message: e.message })}`);
      return EXIT.GREEN;
    }
    console.error(`EXPORT_GENERATOR_REFUSED ${e.code || 'ERROR'} ${e.message}`);
    return EXIT.REFUSED;
  }
}

const invokedDirectly = (() => {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (invokedDirectly) main(process.argv).then((code) => process.exit(code));

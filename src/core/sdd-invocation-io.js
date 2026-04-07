/**
 * SDD Invocation IO — CRUD for cross-SDD invocation records
 *
 * Storage layout:
 *   .gsr/invocations/{id}.json
 *
 * Record format:
 *   { id, status, caller, callee, payload, result, created_at, updated_at, completed_at }
 *
 * GSR boundary: this module is pure data persistence — non-executing.
 * Records declare intent; no evaluation or execution happens here.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_COMPLETE_STATUSES = new Set(['completed', 'failed']);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return the file path for an invocation record.
 * @param {string} id
 * @param {string} invDir
 * @returns {string}
 */
function recordPath(id, invDir) {
  return join(invDir, `${id}.json`);
}

/**
 * Ensure the invocations directory exists.
 * @param {string} invDir
 */
function ensureDir(invDir) {
  if (!existsSync(invDir)) {
    mkdirSync(invDir, { recursive: true });
  }
}

/**
 * Write a record atomically using a temp file + rename.
 * @param {string} id
 * @param {object} record
 * @param {string} invDir
 */
function writeRecord(id, record, invDir) {
  const filePath = recordPath(id, invDir);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, JSON.stringify(record, null, 2), 'utf8');
  renameSync(tempPath, filePath);
}

// ─── createInvocation ────────────────────────────────────────────────────────

/**
 * Create a new invocation record with status "pending".
 *
 * @param {string} callerSddGroup - Caller's SDD group slug
 * @param {string} callerSdd - Caller's SDD slug
 * @param {string} callerPhase - Calling phase name
 * @param {string} calleeSddGroup - Target SDD group slug
 * @param {string} calleeSdd - Target SDD slug
 * @param {string} payload - Data to pass (may be empty string)
 * @param {string} invDir - Path to invocations directory (e.g. .gsr/invocations/)
 * @returns {InvocationRecord} The created record
 */
export function createInvocation(
  callerSddGroup,
  callerSdd,
  callerPhase,
  calleeSddGroup,
  calleeSdd,
  payload,
  invDir
) {
  ensureDir(invDir);

  const now = new Date().toISOString();
  const id = `inv-${randomUUID()}`;

  const record = {
    id,
    status: 'pending',
    caller: {
      catalog: callerSddGroup,
      sdd: callerSdd,
      phase: callerPhase,
    },
    callee: {
      catalog: calleeSddGroup,
      sdd: calleeSdd,
    },
    payload: payload ?? '',
    result: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
  };

  writeRecord(id, record, invDir);
  return record;
}

// ─── readInvocation ──────────────────────────────────────────────────────────

/**
 * Read an existing invocation record from disk.
 *
 * @param {string} id - Invocation ID
 * @param {string} invDir - Path to invocations directory
 * @returns {InvocationRecord}
 * @throws {Error} if the record does not exist
 */
export function readInvocation(id, invDir) {
  const filePath = recordPath(id, invDir);
  if (!existsSync(filePath)) {
    throw new Error(`Invocation record not found: "${id}" in ${invDir}`);
  }
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

// ─── completeInvocation ──────────────────────────────────────────────────────

/**
 * Mark an invocation as completed or failed.
 *
 * @param {string} id - Invocation ID
 * @param {string|null} result - Result data (string or null)
 * @param {'completed'|'failed'} status - New status
 * @param {string} invDir - Path to invocations directory
 * @returns {InvocationRecord} Updated record
 * @throws {Error} if record does not exist
 * @throws {Error} if status is not 'completed' or 'failed'
 */
export function completeInvocation(id, result, status, invDir) {
  if (!VALID_COMPLETE_STATUSES.has(status)) {
    throw new Error(
      `Invalid status "${status}". Must be one of: completed, failed.`
    );
  }

  const record = readInvocation(id, invDir);

  const now = new Date().toISOString();
  const updated = {
    ...record,
    status,
    result: result ?? null,
    updated_at: now,
    completed_at: now,
  };

  writeRecord(id, updated, invDir);
  return updated;
}

// ─── listInvocations ─────────────────────────────────────────────────────────

/**
 * List all invocation records, optionally filtering by status.
 *
 * @param {string} invDir - Path to invocations directory
 * @param {string} [statusFilter] - If provided, only return records with this status
 * @returns {InvocationRecord[]}
 */
export function listInvocations(invDir, statusFilter) {
  if (!existsSync(invDir)) {
    return [];
  }

  let files;
  try {
    files = readdirSync(invDir).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }

  const records = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(invDir, file), 'utf8');
      const record = JSON.parse(raw);
      records.push(record);
    } catch {
      // Skip malformed records
    }
  }

  if (statusFilter) {
    return records.filter(r => r.status === statusFilter);
  }

  return records;
}

// ─── getInvocationsDir ───────────────────────────────────────────────────────

/**
 * Get the default invocations directory relative to a project root.
 * @param {string} projectRoot - Project root directory
 * @returns {string}
 */
export function getInvocationsDir(projectRoot) {
  return join(projectRoot, '.gsr', 'invocations');
}

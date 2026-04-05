/**
 * GSR Watchdog — filesystem heartbeat backend.
 *
 * Provides the filesystem side of the dual-backend watchdog protocol.
 * When the Engram ecosystem (gentle-ai) is not available, heartbeats are
 * written to `.gsr/watchdog/{taskId}.json` in the project root.
 *
 * This module is pure Node.js stdlib — no external dependencies.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Threshold: heartbeat older than this (ms) = timed out. */
export const DEFAULT_TIMEOUT_MS = 90_000;

/** Grace period for the initial heartbeat (ms). */
export const INITIAL_GRACE_MS = 45_000;

/** Recommended max interval between heartbeats (ms). */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** Subdirectory under project root where heartbeat files live. */
export const WATCHDOG_DIR_NAME = '.gsr/watchdog';

// ── Directory helpers ─────────────────────────────────────────────────────────

/**
 * Returns the absolute path to the watchdog directory.
 * @param {string} [projectRoot] - Defaults to process.cwd()
 * @returns {string}
 */
export function getWatchdogDir(projectRoot = process.cwd()) {
  return join(projectRoot, WATCHDOG_DIR_NAME);
}

/**
 * Returns the absolute path for a specific heartbeat file.
 * @param {string} taskId
 * @param {string} [projectRoot]
 * @returns {string}
 */
export function getHeartbeatPath(taskId, projectRoot = process.cwd()) {
  return join(getWatchdogDir(projectRoot), `${taskId}.json`);
}

/**
 * Ensures the watchdog directory exists. Creates it (recursively) if needed.
 * Safe to call multiple times — idempotent.
 * @param {string} [projectRoot]
 */
export function ensureWatchdogDir(projectRoot = process.cwd()) {
  const dir = getWatchdogDir(projectRoot);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ── Read / Write ──────────────────────────────────────────────────────────────

/**
 * Write a heartbeat atomically (temp file + rename) to the filesystem.
 *
 * @param {string} taskId
 * @param {object} data - Heartbeat payload. `ts` is added/overwritten automatically.
 * @param {string} [projectRoot]
 */
export function writeHeartbeat(taskId, data, projectRoot = process.cwd()) {
  ensureWatchdogDir(projectRoot);
  const target = getHeartbeatPath(taskId, projectRoot);
  const tmp = `${target}.tmp`;
  const payload = JSON.stringify({ ...data, ts: Date.now() });
  writeFileSync(tmp, payload, 'utf8');
  renameSync(tmp, target);
}

/**
 * Read and parse a heartbeat file.
 * Returns `null` if the file does not exist or cannot be parsed — never throws.
 *
 * @param {string} taskId
 * @param {string} [projectRoot]
 * @returns {{ ts: number, task_id: string, status: string, [key: string]: any } | null}
 */
export function readHeartbeat(taskId, projectRoot = process.cwd()) {
  const path = getHeartbeatPath(taskId, projectRoot);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Delete a heartbeat file. Safe to call even if the file does not exist.
 * @param {string} taskId
 * @param {string} [projectRoot]
 */
export function cleanHeartbeat(taskId, projectRoot = process.cwd()) {
  const path = getHeartbeatPath(taskId, projectRoot);
  try {
    unlinkSync(path);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// ── Liveness check ───────────────────────────────────────────────────────────

/**
 * Check whether a heartbeat is still "alive" (within the timeout threshold).
 *
 * @param {{ ts: number } | null} heartbeat - The parsed heartbeat object, or null.
 * @param {number} [thresholdMs] - Defaults to DEFAULT_TIMEOUT_MS (90s).
 * @returns {boolean} true if alive, false if timed out or heartbeat is null.
 */
export function isHeartbeatAlive(heartbeat, thresholdMs = DEFAULT_TIMEOUT_MS) {
  if (!heartbeat || typeof heartbeat.ts !== 'number') return false;
  return Date.now() - heartbeat.ts < thresholdMs;
}

/**
 * Check whether the initial heartbeat grace period has expired.
 * Use this when no heartbeat #0 has arrived yet.
 *
 * @param {number} delegateStartMs - Timestamp when mcp_delegate was called.
 * @param {number} [graceMs] - Defaults to INITIAL_GRACE_MS (45s).
 * @returns {boolean} true if grace period exceeded (timeout), false if still waiting.
 */
export function isInitialGraceExpired(delegateStartMs, graceMs = INITIAL_GRACE_MS) {
  return Date.now() - delegateStartMs > graceMs;
}

// ── Fallback selection ────────────────────────────────────────────────────────

/**
 * Select the best fallback model given an error type.
 *
 * Matching priority:
 *   1. First fallback whose `on` array includes exactly `errorType`
 *   2. First fallback whose `on` array includes `"any"`
 *   3. First fallback in the list (backward compat — CSV/simple case)
 *   4. null if fallbacks is empty
 *
 * @param {Array<{model: string, on: string[]}> | string[]} fallbacks
 *   Accepts both the new structured format and the legacy string[] format.
 * @param {string} [errorType] - e.g. "timeout", "quota_exceeded", "no_response", "any"
 * @returns {string | null} The selected model ID, or null if no fallbacks available.
 */
export function selectFallback(fallbacks, errorType = 'any') {
  if (!Array.isArray(fallbacks) || fallbacks.length === 0) return null;

  // Normalize: handle legacy string[] format
  const normalized = fallbacks.map((f) =>
    typeof f === 'string' ? { model: f, on: ['any'] } : f
  );

  // Pass 1: exact match on errorType
  const exact = normalized.find(
    (f) => Array.isArray(f.on) && f.on.includes(errorType)
  );
  if (exact) return exact.model;

  // Pass 2: match on "any"
  const anyMatch = normalized.find(
    (f) => Array.isArray(f.on) && f.on.includes('any')
  );
  if (anyMatch) return anyMatch.model;

  // Pass 3: first in list (backward compat)
  return normalized[0].model;
}

// ── Watchdog state helpers ────────────────────────────────────────────────────

/**
 * Determine the watchdog status for a given task.
 *
 * @param {string} taskId
 * @param {number} delegateStartMs - When mcp_delegate was called (Date.now()).
 * @param {string} [projectRoot]
 * @returns {{ alive: boolean, reason: string, heartbeat: object | null }}
 *   - alive: true if the sub-agent appears healthy
 *   - reason: "healthy" | "no_heartbeat" | "heartbeat_timeout" | "grace_exceeded"
 *   - heartbeat: the last parsed heartbeat, or null
 */
export function checkWatchdog(taskId, delegateStartMs, projectRoot = process.cwd()) {
  const heartbeat = readHeartbeat(taskId, projectRoot);

  if (!heartbeat) {
    if (isInitialGraceExpired(delegateStartMs)) {
      return { alive: false, reason: 'no_heartbeat', heartbeat: null };
    }
    return { alive: true, reason: 'grace_period', heartbeat: null };
  }

  if (!isHeartbeatAlive(heartbeat)) {
    return { alive: false, reason: 'heartbeat_timeout', heartbeat };
  }

  return { alive: true, reason: 'healthy', heartbeat };
}

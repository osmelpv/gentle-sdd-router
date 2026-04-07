/**
 * TribunalFileIO — File-based backend for TribunalChannel.
 *
 * Directory structure:
 *   router/.tribunal/{sddName}/{phaseName}/
 *     metadata.json
 *     round-{N}-{sender}.json
 *     final-decision.json
 *     compression.json
 *     heartbeat-{sender}.json
 *
 * All writes use atomic temp+rename pattern (same as router-v4-io.js).
 *
 * This module is NON-EXECUTING — it only reads/writes data.
 */
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  renameSync,
} from 'node:fs';
import { join } from 'node:path';

/**
 * Convert a tribunal heartbeat to watchdog-compatible format.
 *
 * This allows the judge to use watchdog.isHeartbeatAlive() and watchdog.selectFallback()
 * with tribunal heartbeat data, bridging the two heartbeat interfaces:
 *
 *   - Tribunal heartbeat: { sender, timestamp: ISO, round, status }
 *   - Watchdog heartbeat: { ts: number, task_id, status, ... }
 *
 * @param {object|null} tribunalHb - Tribunal heartbeat object
 * @returns {object|null} Watchdog-compatible heartbeat, or null if input is null/undefined
 */
export function toWatchdogFormat(tribunalHb) {
  if (!tribunalHb) return null;
  return {
    ts: new Date(tribunalHb.timestamp).getTime(),
    task_id: tribunalHb.sender,
    status: tribunalHb.status === 'alive' ? 'running' : 'completed',
    round: tribunalHb.round,
    sender: tribunalHb.sender,
  };
}

export class TribunalFileIO {
  /**
   * @param {string} sddName   - Name of the SDD change (e.g., 'tribunal-logic')
   * @param {string} phaseName - Name of the phase (e.g., 'apply')
   * @param {string} routerDir - Path to router/ or any base directory (e.g. tmp dir in tests)
   */
  constructor(sddName, phaseName, routerDir) {
    this.sddName = sddName;
    this.phaseName = phaseName;
    this.routerDir = routerDir;
    this.baseDir = join(routerDir, '.tribunal', sddName, phaseName);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  _ensureDir() {
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Atomic write: write to a temp file then rename to final path.
   * Prevents partial reads during concurrent access.
   *
   * @param {string} filePath - Destination path
   * @param {object} data     - JSON-serializable data
   */
  _atomicWrite(filePath, data) {
    this._ensureDir();
    const content = JSON.stringify(data, null, 2);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tempPath, content, 'utf8');
    renameSync(tempPath, filePath);
  }

  /**
   * Read and parse a JSON file. Returns null if file does not exist or is malformed.
   *
   * @param {string} filePath
   * @returns {object|null}
   */
  _readJson(filePath) {
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  // ─── Metadata ─────────────────────────────────────────────────────────────

  /**
   * Write the tribunal metadata file.
   * @param {object} metadata
   * @returns {Promise<void>}
   */
  async writeMetadata(metadata) {
    this._atomicWrite(join(this.baseDir, 'metadata.json'), metadata);
  }

  /**
   * Read the tribunal metadata file.
   * @returns {Promise<object|null>}
   */
  async readMetadata() {
    return this._readJson(join(this.baseDir, 'metadata.json'));
  }

  /**
   * Merge updates into existing metadata.
   * @param {object} updates - Partial metadata fields to merge
   * @returns {Promise<void>}
   */
  async updateMetadata(updates) {
    const current = (await this.readMetadata()) ?? {};
    const merged = { ...current, ...updates };
    await this.writeMetadata(merged);
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  /**
   * Write a message file.
   * Naming convention: round-{N}-{sender}.json
   *
   * @param {object} message - Full message object (must have .sender and .round)
   * @param {number} round   - Round number (1-based)
   * @returns {Promise<void>}
   */
  async writeMessage(message, round) {
    // Include target in filename when directed (not broadcast)
    // to avoid overwriting when same sender sends multiple messages in same round.
    // e.g., round-1-judge.json (broadcast) vs round-1-judge-to-minister-1.json (directed)
    const to = message.to && message.to !== 'all' ? `-to-${message.to}` : '';
    const fileName = `round-${round}-${message.sender}${to}.json`;
    this._atomicWrite(join(this.baseDir, fileName), message);

    // Keep rounds_run in metadata up to date
    const meta = await this.readMetadata();
    if (meta && round > (meta.rounds_run ?? 0)) {
      await this.updateMetadata({ rounds_run: round });
    }
  }

  /**
   * Read all messages, optionally filtered by round.
   * Returns an empty array if the directory does not exist.
   *
   * @param {number|null} [round=null] - Round number to filter by, or null for all
   * @returns {Promise<Array>}
   */
  async readMessages(round = null) {
    if (!existsSync(this.baseDir)) return [];

    let files;
    try {
      files = readdirSync(this.baseDir)
        .filter(f => f.startsWith('round-') && f.endsWith('.json'))
        .sort(); // Deterministic alphabetic order
    } catch {
      return [];
    }

    const messages = [];
    for (const file of files) {
      const msg = this._readJson(join(this.baseDir, file));
      if (!msg) continue;
      if (round !== null && msg.round !== round) continue;
      messages.push(msg);
    }
    return messages;
  }

  // ─── Decision ─────────────────────────────────────────────────────────────

  /**
   * Write the final decision file.
   * Accepts a string (wraps in {decision}) or a pre-formed object.
   *
   * @param {string|object} decision
   * @returns {Promise<void>}
   */
  async writeDecision(decision) {
    const data = typeof decision === 'string'
      ? { decision, rationale: '' }
      : decision;
    this._atomicWrite(join(this.baseDir, 'final-decision.json'), data);
  }

  /**
   * Read the final decision file.
   * @returns {Promise<object|null>}
   */
  async readDecision() {
    return this._readJson(join(this.baseDir, 'final-decision.json'));
  }

  // ─── Compression ──────────────────────────────────────────────────────────

  /**
   * Write the compression (lessons learned) file.
   * @param {object} compression
   * @returns {Promise<void>}
   */
  async writeCompression(compression) {
    this._atomicWrite(join(this.baseDir, 'compression.json'), compression);
  }

  /**
   * Read the compression file.
   * @returns {Promise<object|null>}
   */
  async readCompression() {
    return this._readJson(join(this.baseDir, 'compression.json'));
  }

  // ─── Heartbeats ───────────────────────────────────────────────────────────

  /**
   * Write a heartbeat file for the given sender.
   * File: heartbeat-{sender}.json = { sender, timestamp, round, status }
   *
   * @param {string} sender    - Agent identifier (e.g., 'judge', 'minister-1', 'radar')
   * @param {number} round     - Current round number
   * @param {'alive'|'done'} [status='alive'] - Agent liveness status
   * @returns {Promise<void>}
   */
  async writeHeartbeat(sender, round, status = 'alive') {
    const data = {
      sender,
      timestamp: new Date().toISOString(),
      round,
      status,
    };
    this._atomicWrite(join(this.baseDir, `heartbeat-${sender}.json`), data);
  }

  /**
   * Read a single heartbeat file for the given sender.
   * Returns null if the file does not exist or cannot be parsed.
   *
   * @param {string} sender - Agent identifier (e.g., 'judge', 'minister-1', 'radar')
   * @returns {Promise<object|null>}
   */
  async readHeartbeat(sender) {
    return this._readJson(join(this.baseDir, `heartbeat-${sender}.json`));
  }

  /**
   * Read all heartbeat files in the tribunal directory.
   * Returns an empty array if the directory does not exist.
   *
   * @returns {Promise<Array>}
   */
  async readHeartbeats() {
    if (!existsSync(this.baseDir)) return [];
    let files;
    try {
      files = readdirSync(this.baseDir)
        .filter(f => f.startsWith('heartbeat-') && f.endsWith('.json'));
    } catch {
      return [];
    }
    return files
      .map(f => this._readJson(join(this.baseDir, f)))
      .filter(Boolean);
  }

  /**
   * Check whether an agent is alive based on its heartbeat file.
   *
   * An agent is considered alive when:
   *   - Its heartbeat file exists
   *   - Its status is NOT 'done'
   *   - The heartbeat timestamp is within the last `maxStaleSec` seconds
   *
   * @param {string} sender       - Agent identifier
   * @param {number} [maxStaleSec=30] - Max age in seconds before considering stale
   * @returns {Promise<boolean>}
   */
  async isAgentAlive(sender, maxStaleSec = 30) {
    const hb = this._readJson(join(this.baseDir, `heartbeat-${sender}.json`));
    if (!hb) return false;
    if (hb.status === 'done') return false;
    const elapsed = (Date.now() - new Date(hb.timestamp).getTime()) / 1000;
    return elapsed < maxStaleSec;
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  /**
   * Remove round-*.json files from the tribunal directory.
   * Keeps metadata.json, final-decision.json, and compression.json.
   *
   * @returns {Promise<void>}
   */
  async cleanupRoundFiles() {
    if (!existsSync(this.baseDir)) return;

    let files;
    try {
      files = readdirSync(this.baseDir)
        .filter(f => f.startsWith('round-') && f.endsWith('.json'));
    } catch {
      return;
    }

    for (const file of files) {
      try {
        unlinkSync(join(this.baseDir, file));
      } catch {
        // Ignore — file may have already been removed
      }
    }
  }
}

/**
 * TribunalChannel — file-based communication channel for multi-agent debate.
 *
 * Writes and reads JSON files in .tribunal/{sdd}/{phase}/.
 *
 * NOTE: Engram MCP tools are not available to delegated sub-agents.
 * File-based I/O is the only viable communication layer for tribunal participants.
 * There is no Engram backend — only file I/O.
 *
 * This module is NON-EXECUTING — it only reads/writes data.
 * The host (OpenCode, gentle-ai) handles agent orchestration.
 *
 * Design decisions:
 * - D7: Deterministic message IDs: `{tribunalId}-r{round}-{sender}`
 */
import { join } from 'node:path';
import { TribunalFileIO, toWatchdogFormat } from './tribunal-io.js';

export class TribunalChannel {
  /**
   * @param {string} sddName   - Name of the SDD change (e.g., 'tribunal-logic')
   * @param {string} phaseName - Name of the phase (e.g., 'explore', 'apply')
   * @param {object} options
   * @param {boolean} [options.useEngram=true] - Accepted for backward compat but ignored.
   *   Engram MCP tools are not available to delegated sub-agents — files are always used.
   * @param {string}  options.routerDir        - Path to the base directory (.tribunal lives here)
   */
  constructor(sddName, phaseName, { useEngram = true, routerDir }) {
    // useEngram is accepted for backward compat but intentionally ignored.
    // Engram MCP tools are not available to delegated sub-agents.
    // File-based I/O is the only viable communication layer.
    void useEngram;
    this.sddName = sddName;
    this.phaseName = phaseName;
    this.routerDir = routerDir;
    this.tribunalId = `sdd/${sddName}/phases/${phaseName}/${Date.now()}`;
    this._fileIO = new TribunalFileIO(sddName, phaseName, routerDir);
  }

  // ─── Backend detection ────────────────────────────────────────────────────

  /**
   * Always returns 'files'.
   *
   * Engram MCP tools are not available to delegated sub-agents.
   * File-based I/O is the only viable communication layer for tribunal participants.
   * This method is kept for API compatibility but the result is always 'files'.
   *
   * @param {string} [baseDir=process.cwd()] - Ignored. Kept for backward compat.
   * @returns {'files'}
   */
  // eslint-disable-next-line no-unused-vars
  static detect(baseDir = process.cwd()) {
    // Engram MCP tools are not available to delegated sub-agents.
    // File-based I/O is the only viable communication layer.
    return 'files';
  }

  // ─── Write ────────────────────────────────────────────────────────────────

  /**
   * Write a message to the tribunal channel.
   *
   * @param {string} sender     - Agent identifier (e.g., 'minister-1', 'judge', 'radar')
   * @param {'minister'|'judge'|'radar'} role
   * @param {'response'|'question'|'synthesis'|'decision'|'compression'} type
   * @param {object} content    - Message content
   * @param {string} content.text           - Main text
   * @param {string[]} [content.code_examples] - Code snippets
   * @param {object}  [content.analysis]   - Analysis details
   * @param {'agree'|'disagree'|'neutral'} [content.position]
   * @param {number}  [content.confidence] - 0–1 confidence score
   * @param {object}  [content.dimensions] - Per-dimension analysis
   * @param {number}  round     - Round number (1-based)
   * @param {object}  [options]
   * @param {string}  [options.model]       - Model identifier (e.g., 'anthropic/claude-opus')
   * @param {string}  [options.in_reply_to] - Message ID being replied to
   * @param {string}  [options.to]          - Target agent ('all', 'judge', 'minister-1', etc.) — defaults to 'all'
   * @returns {Promise<{id: string, written: boolean}>}
   */
  async write(sender, role, type, content, round, options = {}) {
    const message = {
      id: `${this.tribunalId}-r${round}-${sender}`,
      tribunal_id: this.tribunalId,
      round,
      sender,
      from: sender,
      to: options.to ?? 'all',
      role,
      type,
      model: options.model ?? null,
      timestamp: new Date().toISOString(),
      content: {
        text: content.text ?? '',
        code_examples: content.code_examples ?? [],
        analysis: content.analysis ?? {},
        position: content.position ?? 'neutral',
        confidence: content.confidence ?? null,
        dimensions: content.dimensions ?? {},
      },
      in_reply_to: options.in_reply_to ?? null,
      session_open: true,
    };

    // Canonical storage for gsr is always the file backend
    await this._fileIO.writeMessage(message, round);
    return { id: message.id, written: true };
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  /**
   * Read all messages, optionally filtered by round.
   *
   * @param {number|null} [round=null] - Filter by round number, or null for all
   * @returns {Promise<Array>}
   */
  async readAll(round = null) {
    return this._fileIO.readMessages(round);
  }

  /**
   * Read messages from a specific role, optionally filtered by round.
   *
   * @param {'minister'|'judge'|'radar'} role
   * @param {number|null} [round=null]
   * @returns {Promise<Array>}
   */
  async readByRole(role, round = null) {
    const messages = await this.readAll(round);
    return messages.filter(m => m.role === role);
  }

  /**
   * Read messages addressed to a specific agent (or broadcast to 'all').
   * Useful for agents polling the channel for their own messages.
   *
   * Returns messages where `to === agentId` OR `to === 'all'`.
   *
   * @param {string} agentId   - Target agent identifier (e.g., 'minister-1', 'judge', 'radar')
   * @param {number|null} [round=null] - Filter by round, or null for all rounds
   * @returns {Promise<Array>}
   */
  async readFor(agentId, round = null) {
    const messages = await this.readAll(round);
    return messages.filter(m => m.to === agentId || m.to === 'all');
  }

  // ─── Heartbeats ───────────────────────────────────────────────────────────

  /**
   * Write a heartbeat for the given agent.
   *
   * @param {string} sender    - Agent identifier
   * @param {number} round     - Current round number
   * @param {'alive'|'done'} [status='alive']
   * @returns {Promise<void>}
   */
  async writeHeartbeat(sender, round, status = 'alive') {
    return this._fileIO.writeHeartbeat(sender, round, status);
  }

  /**
   * Read all heartbeat files from the tribunal directory.
   *
   * @returns {Promise<Array>}
   */
  async readHeartbeats() {
    return this._fileIO.readHeartbeats();
  }

  /**
   * Check if a given agent is alive based on its heartbeat.
   *
   * @param {string} sender        - Agent identifier
   * @param {number} [maxStaleSec=30] - Max age in seconds before considering stale
   * @returns {Promise<boolean>}
   */
  async isAgentAlive(sender, maxStaleSec = 30) {
    return this._fileIO.isAgentAlive(sender, maxStaleSec);
  }

  // ─── Decision & compression ───────────────────────────────────────────────

  /**
   * Write the final decision.
   * Creates final-decision.json and updates metadata to status 'decided'.
   *
   * @param {string} decision      - Decision text
   * @param {object} [compression] - Optional compression data
   * @returns {Promise<void>}
   */
  async writeDecision(decision, compression = null) {
    await this._fileIO.writeDecision(decision);
    if (compression) {
      await this._fileIO.writeCompression(compression);
    }
    await this._fileIO.updateMetadata({
      status: 'decided',
      decided_at: new Date().toISOString(),
      decision,
      consensus: compression?.consensus ?? true,
    });
  }

  /**
   * Compress the tribunal debate into lessons learned.
   *
   * @param {string[]} lessons       - Lessons learned
   * @param {string[]} badIdeas      - Ideas that were rejected and why
   * @param {string}   contextForNext - Context for the next phase
   * @returns {Promise<void>}
   */
  async compress(lessons, badIdeas, contextForNext) {
    const existingDecision = await this._fileIO.readDecision();
    const compression = {
      decision: existingDecision?.decision ?? '',
      rationale: existingDecision?.rationale ?? '',
      lessons_learned: lessons,
      bad_ideas: badIdeas,
      context_for_next_phase: contextForNext,
    };
    await this._fileIO.writeCompression(compression);
    await this._fileIO.updateMetadata({ status: 'compressed' });
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Initialize the tribunal session (creates metadata.json).
   *
   * @param {object} participants - { judge: 'model', ministers: ['model1', ...], radar: 'model'|null }
   * @returns {Promise<void>}
   */
  async initialize(participants) {
    await this._fileIO.writeMetadata({
      tribunal_id: this.tribunalId,
      sdd: this.sddName,
      phase: this.phaseName,
      status: 'open',
      started_at: new Date().toISOString(),
      decided_at: null,
      rounds_run: 0,
      participants,
      decision: null,
      consensus: null,
      escalated_to_user: false,
    });
  }

  /**
   * Clean up tribunal data after phase completes.
   * Removes round-*.json files; keeps compression.json, final-decision.json, metadata.json.
   *
   * @returns {Promise<void>}
   */
  async cleanup() {
    await this._fileIO.cleanupRoundFiles();
  }

  /**
   * Get current tribunal metadata.
   * @returns {Promise<object|null>}
   */
  async getMetadata() {
    return this._fileIO.readMetadata();
  }

  // ─── Health checks ────────────────────────────────────────────────────────

  /**
   * Check the health of a specific agent based on its heartbeat file.
   *
   * Returns a structured health report compatible with the watchdog system.
   * Uses toWatchdogFormat() from tribunal-io to bridge the two heartbeat formats.
   *
   * @param {string} sender - Agent identifier (e.g., 'minister-1', 'judge', 'radar')
   * @param {number} [maxStaleSec=30] - Max heartbeat age before considering stale
   * @returns {Promise<{alive: boolean, reason: string, heartbeat: object|null, watchdogCompatible: object|null}>}
   */
  async checkAgentHealth(sender, maxStaleSec = 30) {
    const hb = await this._fileIO.readHeartbeat(sender);
    if (!hb) return { alive: false, reason: 'no_heartbeat', heartbeat: null, watchdogCompatible: null };

    const watchdogHb = toWatchdogFormat(hb);
    if (hb.status === 'done') return { alive: false, reason: 'completed', heartbeat: hb, watchdogCompatible: watchdogHb };

    const alive = await this.isAgentAlive(sender, maxStaleSec);
    return {
      alive,
      reason: alive ? 'healthy' : 'heartbeat_timeout',
      heartbeat: hb,
      watchdogCompatible: watchdogHb,
    };
  }
}

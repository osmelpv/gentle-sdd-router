/**
 * Status Reporter
 *
 * Translates internal sync/config state into human-friendly status messages.
 * Two modes:
 *   - Simple (default): user-facing vocabulary only
 *   - Detailed (--verbose/--debug): full internal state exposed
 *
 * Status levels (in order of completeness):
 *   error          → something is wrong, needs attention
 *   configured     → router.yaml found, but no sync has been run
 *   synchronized   → sync completed, agents written to host
 *   visible        → agents confirmed visible in host
 *   ready          → all checks pass, ready to use
 *   requires_reopen → sync done but editor must be reopened to activate
 *
 * @module status-reporter
 */

// ── Status level definitions ──────────────────────────────────────────────

/**
 * @typedef {Object} StatusLevel
 * @property {string} emoji
 * @property {string} message
 */

/**
 * All valid status levels with their default emoji and human-friendly message.
 * @type {Record<string, StatusLevel>}
 */
export const STATUS_LEVELS = {
  error: {
    emoji: '❌',
    message: 'Something went wrong. Check your configuration and try again.',
  },
  configured: {
    emoji: '✅',
    message: 'Configured. Run `gsr sync` to activate.',
  },
  synchronized: {
    emoji: '🔄',
    message: 'Synchronized. Your routing is active.',
  },
  visible: {
    emoji: '👁️',
    message: 'Visible in host. Agents are available.',
  },
  ready: {
    emoji: '✅',
    message: 'Ready to use.',
  },
  requires_reopen: {
    emoji: '⚠️',
    message: 'Synchronized. Reopen your editor to activate the new agents.',
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Check if the sync result represents a completed, successful sync.
 * @param {object|null} syncResult
 * @returns {boolean}
 */
function isSyncSuccessful(syncResult) {
  if (!syncResult) return false;
  return syncResult.status === 'ok' || syncResult.status === 'partial';
}

/**
 * Check if the sync result has a fatal failure.
 * @param {object|null} syncResult
 * @returns {boolean}
 */
function isSyncFailed(syncResult) {
  if (!syncResult) return false;
  return syncResult.status === 'failed';
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SimpleStatusResult
 * @property {string} level - One of the STATUS_LEVELS keys
 * @property {string} emoji - Indicator emoji
 * @property {string} message - Human-friendly message (no internal terms)
 */

/**
 * Get a simplified, user-friendly status from config and sync result.
 *
 * Hides all internal details: overlay mechanics, boundary info, manifest paths,
 * _gsr_generated markers, execution mode internals.
 *
 * @param {object|null} config - Loaded router config (or null if not installed)
 * @param {object|null} syncResult - Result from unifiedSync() (or null if not run yet)
 * @returns {SimpleStatusResult}
 */
export function getSimpleStatus(config, syncResult) {
  // No config = not installed / error state
  if (!config) {
    return {
      level: 'error',
      emoji: STATUS_LEVELS.error.emoji,
      message: 'Not configured. Run `gsr install` to get started.',
    };
  }

  // Sync had a fatal error
  if (isSyncFailed(syncResult)) {
    return {
      level: 'error',
      emoji: STATUS_LEVELS.error.emoji,
      message: 'Setup failed. Run `gsr sync` again or check your configuration.',
    };
  }

  // Sync completed and requires editor reopen
  if (syncResult?.requiresReopen === true) {
    return {
      level: 'requires_reopen',
      emoji: STATUS_LEVELS.requires_reopen.emoji,
      message: STATUS_LEVELS.requires_reopen.message,
    };
  }

  // Sync completed successfully (ok or partial)
  if (isSyncSuccessful(syncResult)) {
    return {
      level: 'synchronized',
      emoji: STATUS_LEVELS.synchronized.emoji,
      message: STATUS_LEVELS.synchronized.message,
    };
  }

  // Config found, no sync yet
  return {
    level: 'configured',
    emoji: STATUS_LEVELS.configured.emoji,
    message: STATUS_LEVELS.configured.message,
  };
}

/**
 * @typedef {Object} DetailedStatusResult
 * @property {string} level - One of the STATUS_LEVELS keys
 * @property {string} emoji - Indicator emoji
 * @property {string} message - Human-friendly message
 * @property {object} details - Full internal state (for --verbose/--debug output)
 */

/**
 * Get detailed status including all internal state.
 * Used for `gsr status --verbose` and `gsr status --debug`.
 *
 * @param {object|null} config - Loaded router config
 * @param {object|null} syncResult - Result from unifiedSync()
 * @returns {DetailedStatusResult}
 */
export function getDetailedStatus(config, syncResult) {
  const simple = getSimpleStatus(config, syncResult);

  const details = {
    // Config info
    activeCatalog: config?.active_catalog ?? null,
    activePreset: config?.active_preset ?? null,
    activationState: config?.activation_state ?? null,
    schemaVersion: config?.version ?? null,

    // Sync result internals
    syncStatus: syncResult?.status ?? null,
    requiresReopen: syncResult?.requiresReopen ?? false,
    noop: syncResult?.noop ?? false,
    steps: syncResult?.steps ?? [],
    warnings: syncResult?.warnings ?? [],
  };

  return {
    ...simple,
    details,
  };
}

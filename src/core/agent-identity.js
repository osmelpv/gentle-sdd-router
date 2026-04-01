/**
 * Agent Identity Resolution — src/core/agent-identity.js
 *
 * Resolves agent context/prompt for a profile using a layered fallback chain:
 *   1. Explicit prompt (identity.prompt) — short-circuit, skip all below
 *   2. Explicit context (identity.context) — appended to inherited context
 *   3. AGENTS.md (identity.inherit_agents_md=true, default) — walk up from cwd
 *   4. gentle-ai ecosystem (PATH detection) — if installed
 *   5. Neutral fallback — minimal GSR-owned string
 *
 * All resolution is pure data transformation. No process execution.
 * Non-executing boundary: identity resolution never invokes commands.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { detectGentleAi } from './controller.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Neutral fallback prompt used when no identity sources are available.
 * Kept stable — changing this string is a breaking spec change.
 */
export const NEUTRAL_FALLBACK_PROMPT =
  'You are an AI agent configured by GSR. Follow the router contract.';

// ── Module-level cache ────────────────────────────────────────────────────────
// Keyed by resolved absolute directory path.
const cache = new Map();

// ── readAgentsMd ──────────────────────────────────────────────────────────────

/**
 * Walk up the directory tree from `startDir` looking for AGENTS.md.
 * Returns { content: string, path: string } for the first match, or null.
 *
 * @param {string} startDir - Directory to start the walk from (default: process.cwd())
 * @param {{ stopAt?: string }} [options]
 *   - stopAt: stop traversal at this directory (inclusive). Defaults to homedir().
 * @returns {{ content: string, path: string } | null}
 */
export function readAgentsMd(startDir = process.cwd(), options = {}) {
  const stopAt = options.stopAt ?? homedir();
  let current = startDir;

  while (true) {
    const cacheKey = current;

    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      // null means "not found at this level" (cached miss)
      if (cached !== null) return cached;
      // Fall through to check parent
    } else {
      const candidate = join(current, 'AGENTS.md');
      if (existsSync(candidate)) {
        const content = readFileSync(candidate, 'utf8');
        const result = { content, path: candidate };
        cache.set(cacheKey, result);
        return result;
      }
      // Cache the miss at this level
      cache.set(cacheKey, null);
    }

    // Stop condition: we've reached the stopAt directory
    if (current === stopAt) break;

    const parent = dirname(current);
    // Stop at filesystem root to avoid infinite loop
    if (parent === current) break;

    // Only continue walking up if we haven't passed stopAt
    // Check if current path starts with stopAt to know if we should stop
    current = parent;
  }

  return null;
}

// ── resolveIdentity ───────────────────────────────────────────────────────────

/**
 * Resolve the agent identity for a profile configuration.
 *
 * @param {object} profileConfig - Profile content (may have .identity section)
 * @param {object} [options]
 *   - cwd {string}: Directory to start AGENTS.md search (default: process.cwd())
 *   - _skipGentleAi {boolean}: Skip gentle-ai detection (for testing)
 * @returns {{
 *   prompt: string,
 *   context: string|null,
 *   persona: string,
 *   inherit_agents_md: boolean,
 *   sources: string[]
 * }}
 */
export function resolveIdentity(profileConfig, options = {}) {
  const identity = profileConfig?.identity ?? {};
  const cwd = options.cwd ?? process.cwd();
  const _skipGentleAi = options._skipGentleAi ?? false;

  const inheritAgentsMd = identity.inherit_agents_md !== false; // default true
  const persona = identity.persona ?? 'auto';
  const explicitContext = identity.context ?? null;
  const explicitPrompt = identity.prompt ?? null;

  // ── Layer 1: Explicit prompt — short-circuit ──────────────────────────────
  if (explicitPrompt) {
    return {
      prompt: explicitPrompt,
      context: explicitContext,
      persona,
      inherit_agents_md: inheritAgentsMd,
      sources: ['explicit-prompt'],
    };
  }

  // ── Layers 2–5: Build layered context ────────────────────────────────────
  const parts = [];
  const sources = [];

  // Layer 2: Explicit context
  if (explicitContext) {
    parts.push(explicitContext);
    sources.push('explicit-context');
  }

  // Layer 3: AGENTS.md (only if inherit_agents_md=true)
  if (inheritAgentsMd) {
    const agentsMd = readAgentsMd(cwd);
    if (agentsMd !== null) {
      parts.push(agentsMd.content);
      sources.push('agents-md');
    }
  }

  // Layer 4: gentle-ai ecosystem context
  if (!_skipGentleAi && inheritAgentsMd) {
    const hasGentleAi = detectGentleAi();
    if (hasGentleAi) {
      // gentle-ai is installed — resolve persona
      const resolvedPersona = persona === 'auto' ? 'gentleman' : persona;
      parts.push(`Persona: ${resolvedPersona} (via gentle-ai)`);
      sources.push('gentle-ai');
    }
  }

  // Layer 5: Neutral fallback
  if (parts.length === 0) {
    parts.push(NEUTRAL_FALLBACK_PROMPT);
    sources.push('neutral');
  }

  const prompt = parts.join('\n\n');

  return {
    prompt,
    context: explicitContext,
    persona,
    inherit_agents_md: inheritAgentsMd,
    sources,
  };
}

// ── resetIdentityCache ────────────────────────────────────────────────────────

/**
 * Clear the module-level AGENTS.md cache.
 * For testing — clears cached reads so tests can mutate files between calls.
 */
export function resetIdentityCache() {
  cache.clear();
}

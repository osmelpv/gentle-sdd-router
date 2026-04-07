import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { resolvePersona } from '../../core/controller.js';
import { resolveIdentity } from '../../core/agent-identity.js';
import { normalizeFallbacks } from '../../core/router-v4-io.js';

// ── Skill Content Loader ───────────────────────────────────────────────────────

/**
 * Load skill content from router/skills/{skillName}.md.
 * Returns a fallback instruction string when the file is not found.
 *
 * @param {string} skillName - Skill name without extension (e.g. 'tribunal-judge')
 * @returns {string}
 */
function loadSkillContent(skillName) {
  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const skillPath = resolve(moduleDir, '..', '..', '..', 'router', 'skills', `${skillName}.md`);
    if (existsSync(skillPath)) {
      return readFileSync(skillPath, 'utf8').trim();
    }
  } catch {
    // graceful degradation
  }
  return `Load the ${skillName} skill for instructions.`;
}

const OPENCODE_CONFIG_PATH = join(homedir(), '.config', 'opencode', 'opencode.json');

// ── Fallback Protocol ─────────────────────────────────────────────────────────

/**
 * Load the fallback protocol text from router/contracts/fallback-protocol.md.
 * Returns empty string if the file is not found (graceful degradation).
 */
function loadFallbackProtocolText() {
  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const contractPath = resolve(moduleDir, '..', '..', '..', 'router', 'contracts', 'fallback-protocol.md');
    if (existsSync(contractPath)) {
      return readFileSync(contractPath, 'utf8').trim();
    }
    console.warn('[gsr] fallback-protocol.md not found at expected path:', contractPath);
    return '';
  } catch (err) {
    console.warn('[gsr] Failed to load fallback-protocol.md:', err.message);
    return '';
  }
}

/** Fallback protocol text loaded once at module init. */
const FALLBACK_PROTOCOL_TEXT = loadFallbackProtocolText();

/**
 * Load the heartbeat protocol text from router/contracts/heartbeat-protocol.md.
 * Returns empty string if the file is not found (graceful degradation).
 */
function loadHeartbeatProtocolText() {
  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const contractPath = resolve(moduleDir, '..', '..', '..', 'router', 'contracts', 'heartbeat-protocol.md');
    if (existsSync(contractPath)) {
      return readFileSync(contractPath, 'utf8').trim();
    }
    console.warn('[gsr] heartbeat-protocol.md not found at expected path:', contractPath);
    return '';
  } catch (err) {
    console.warn('[gsr] Failed to load heartbeat-protocol.md:', err.message);
    return '';
  }
}

/** Heartbeat protocol text loaded once at module init. */
const HEARTBEAT_PROTOCOL_TEXT = loadHeartbeatProtocolText();
const GSR_AGENT_PREFIX = 'gsr-';

/**
 * Map a profile's permissions object to OpenCode tool flags.
 * Defaults all tools to true when permissions is absent.
 *
 * @param {object|undefined} permissions - { read?, write?, edit?, bash?, delegate? }
 * @returns {{ read: boolean, write: boolean, edit: boolean, bash: boolean, delegate: boolean, delegation_read: boolean, delegation_list: boolean }}
 */
export function mapPermissions(permissions) {
  const defaults = {
    read: true,
    write: true,
    edit: true,
    bash: true,
    delegate: true,
    delegation_read: true,
    delegation_list: true,
  };

  if (!permissions) return defaults;

  return {
    read: permissions.read ?? true,
    write: permissions.write ?? true,
    edit: permissions.edit ?? true,
    bash: permissions.bash ?? true,
    delegate: permissions.delegate ?? true,
    delegation_read: permissions.delegate ?? true,
    delegation_list: permissions.delegate ?? true,
  };
}

/**
 * Extract the orchestrator primary lane target model from a preset.
 * Returns null if no orchestrator phase is present.
 *
 * Handles both:
 *   - Simplified schema: phases.orchestrator = { model: 'anthropic/...', fallbacks?: [...] }
 *   - Lane array schema: phases.orchestrator = [{ target: 'anthropic/...', kind: 'lane', ... }]
 *
 * @param {object} preset - A preset from the assembled config (catalogs[name].presets[name])
 * @returns {string|null}
 */
function getOrchestratorTarget(preset) {
  const phases = preset.phases;
  if (!phases || typeof phases !== 'object' || Array.isArray(phases)) return null;

  const orchestrator = phases.orchestrator;
  if (!orchestrator) return null;

  // Simplified schema: { model: '...', fallbacks?: [...] }
  if (!Array.isArray(orchestrator) && typeof orchestrator === 'object' && typeof orchestrator.model === 'string') {
    return orchestrator.model;
  }

  // Lane array schema: [{ target: '...', kind: 'lane', ... }]
  if (Array.isArray(orchestrator) && orchestrator.length > 0) {
    return orchestrator[0].target ?? null;
  }

  return null;
}

/**
 * Generate OpenCode overlay from a loaded (assembled) router config.
 *
 * When `config.profilesMap` is present (v4-assembled config):
 *   Only profiles with `visible === true` in profilesMap generate a gsr-{name} agent entry.
 *   Profiles with visible: false (or absent) are silently skipped.
 *
 * When `config.profilesMap` is absent (v3 config or test fixtures):
 *   Falls back to old behavior — iterates over catalogs, skipping disabled catalogs.
 *
 * Presets without an orchestrator phase are skipped with a warning (both modes).
 *
 * Each generated entry includes:
 *   - prompt: resolved identity prompt (via resolveIdentity fallback chain)
 *   - _gsr_generated: true (merge marker for safe regeneration)
 *
 * @param {object} config - Loaded/assembled router config (v3-shaped, from loadRouterConfig)
 * @param {object} [options]
 *   - cwd {string}: Directory for AGENTS.md resolution (default: process.cwd())
 * @returns {{ agent: Record<string, object>, warnings: string[] }}
 */
export function generateOpenCodeOverlay(config, options = {}) {
  const agents = {};
  const warnings = [];
  const catalogs = config.catalogs ?? {};
  const persona = resolvePersona(config);
  const cwd = options.cwd ?? process.cwd();

  // Router-level identity overrides: config.identity.overrides.<agentName>
  const routerOverrides = config?.identity?.overrides ?? {};

  // ── Determine iteration mode ────────────────────────────────────────────────
  // v4-assembled config has profilesMap (Map<name, {visible, builtin, content}>).
  // When present, use visible flag as the gate. When absent, fall back to SDD-enabled gate.

  const hasProfilesMap = config.profilesMap instanceof Map;

  if (hasProfilesMap) {
    // v4 mode: iterate over profiles that have visible === true
    const profilesMap = config.profilesMap;

    for (const [profileName, profileEntry] of profilesMap.entries()) {
      if (profileEntry.visible !== true) continue; // skip non-visible profiles

      // Fetch preset data from SDD groups (where phase data lives after assembly)
      let preset = null;
      for (const sdd of Object.values(catalogs)) {
        if (sdd.presets?.[profileName]) {
          preset = sdd.presets[profileName];
          break;
        }
      }
      // Fallback: use profileEntry.content directly (simplified schema)
      if (!preset) {
        preset = profileEntry.content ?? {};
        // Strip the 'name' field if present (it's not part of the preset spec)
        if (preset.name) {
          const { name: _n, ...rest } = preset;
          preset = rest;
        }
      }

      const presetName = profileName;
      buildAgentEntry(presetName, preset, agents, warnings, persona, cwd, routerOverrides);
    }
  } else {
    // v3 / fallback mode: iterate over SDD groups with enabled-flag gate
    for (const [sddName, sdd] of Object.entries(catalogs)) {
      // Only include presets from enabled SDD groups in the overlay
      if (sdd.enabled === false) {
        continue;
      }
      const presets = sdd.presets ?? {};

      for (const [presetName, preset] of Object.entries(presets)) {
        buildAgentEntry(presetName, preset, agents, warnings, persona, cwd, routerOverrides);
      }
    }
  }

  return { agent: agents, warnings };
}

/**
 * Collect tribunal configuration from all phases of a preset.
 *
 * Iterates all phases looking for `tribunal.enabled === true`.
 * Returns a normalized tribunal config:
 *   - judge: { model } (from first enabled phase that has one)
 *   - ministers: Array<{ model }> — length = max across all enabled phases
 *   - radar: { model, enabled } | null (from first enabled phase with radar.enabled)
 *   - maxRounds: number (from first enabled phase, default 4)
 *   - hasAny: boolean
 *
 * Design D10: profile-scoped sub-agents (not per-phase).
 *
 * @param {object} preset
 * @returns {{ hasAny: boolean, judge: object|null, ministers: object[], radar: object|null, maxRounds: number }}
 */
function collectTribunalConfig(preset) {
  const phases = preset.phases ?? {};
  let judge = null;
  let ministers = [];
  let radar = null;
  let maxRounds = 4;
  let hasAny = false;

  for (const phaseValue of Object.values(phases)) {
    // Tribunal config lives in object-form phases: { lanes?, tribunal?, judge?, ministers?, radar? }
    if (!phaseValue || Array.isArray(phaseValue) || typeof phaseValue !== 'object') continue;

    const tribunal = phaseValue.tribunal;
    if (!tribunal || tribunal.enabled !== true) continue;

    hasAny = true;

    // judge: first occurrence wins
    if (!judge && phaseValue.judge && typeof phaseValue.judge.model === 'string' && phaseValue.judge.model.trim()) {
      judge = { model: phaseValue.judge.model.trim() };
    }

    // ministers: take max count across phases
    if (Array.isArray(phaseValue.ministers) && phaseValue.ministers.length > ministers.length) {
      ministers = phaseValue.ministers.slice();
    }

    // radar: first enabled occurrence wins
    if (!radar && phaseValue.radar && phaseValue.radar.enabled === true && typeof phaseValue.radar.model === 'string') {
      radar = { model: phaseValue.radar.model.trim(), enabled: true };
    }

    // maxRounds: first enabled occurrence wins
    if (maxRounds === 4 && tribunal.max_rounds && Number.isInteger(tribunal.max_rounds) && tribunal.max_rounds > 0) {
      maxRounds = tribunal.max_rounds;
    }
  }

  return { hasAny, judge, ministers, radar, maxRounds };
}

/**
 * Build tribunal sub-agent entries (judge, ministers, radar) for a profile.
 *
 * Design decisions (D10 from design.md):
 *   - Named `gsr-{profile}-judge`, `gsr-{profile}-minister-1`, `gsr-{profile}-radar`
 *   - hidden: true — advisory agents, not for sidebar display
 *   - tools: read-only — sub-agents are advisory, not executing
 *   - _gsr_generated: true — unified-sync can manage these
 *   - systemPrompt: skill content from router/skills/
 *
 * @param {string} profileName
 * @param {object} tribunalConfig - Output of collectTribunalConfig()
 * @param {object} agents - mutated in place
 */
function buildTribunalSubAgents(profileName, tribunalConfig, agents) {
  const { judge, ministers, radar } = tribunalConfig;

  // Per-role tool permissions:
  //   Judge:    needs edit (metadata files), write (channel), bash (sleep/polling), delegate (ministers)
  //   Minister: needs write (channel), bash (sleep/polling), read (channel) — no edit
  //   Radar:    needs write (findings), bash (grep/find investigation), read (channel) — no edit
  const TRIBUNAL_TOOLS = {
    judge:    { read: true, edit: true,  write: true,  bash: true,  delegate: true,  delegation_read: true,  delegation_list: true },
    minister: { read: true, edit: false, write: true,  bash: true,  delegate: false, delegation_read: false, delegation_list: false },
    radar:    { read: true, edit: false, write: true,  bash: true,  delegate: false, delegation_read: false, delegation_list: false },
  };

  // Heartbeat reference appended to all tribunal sub-agent prompts
  const HEARTBEAT_SKILL_REF = '\n\n## Heartbeat Protocol\nLoad the watchdog-heartbeat skill and follow the heartbeat protocol. Write heartbeats to .gsr/watchdog/ every 15-30 seconds.';

  // Judge agent
  if (judge) {
    const judgeKey = `${GSR_AGENT_PREFIX}${profileName}-judge`;
    agents[judgeKey] = {
      model: judge.model,
      description: `Tribunal judge for ${profileName}`,
      hidden: true,
      tools: { ...TRIBUNAL_TOOLS.judge },
      systemPrompt: loadSkillContent('tribunal-judge') + HEARTBEAT_SKILL_REF,
      _gsr_generated: true,
    };
  }

  // Minister agents
  for (let i = 0; i < ministers.length; i++) {
    const minister = ministers[i];
    const ministerKey = `${GSR_AGENT_PREFIX}${profileName}-minister-${i + 1}`;
    const model = (minister && typeof minister.model === 'string') ? minister.model : 'unknown/model';
    agents[ministerKey] = {
      model,
      description: `Tribunal minister ${i + 1} for ${profileName}`,
      hidden: true,
      tools: { ...TRIBUNAL_TOOLS.minister },
      systemPrompt: loadSkillContent('gsr-usage') + HEARTBEAT_SKILL_REF,
      _gsr_generated: true,
    };
  }

  // Radar agent (only when radar.enabled === true)
  if (radar && radar.enabled === true) {
    const radarKey = `${GSR_AGENT_PREFIX}${profileName}-radar`;
    agents[radarKey] = {
      model: radar.model,
      description: `Tribunal radar for ${profileName}`,
      hidden: true,
      tools: { ...TRIBUNAL_TOOLS.radar },
      systemPrompt: loadSkillContent('tribunal-radar') + HEARTBEAT_SKILL_REF,
      _gsr_generated: true,
    };
  }
}

/**
 * Build one agent entry for a given preset and push it into `agents` (or `warnings` if invalid).
 *
 * Handles both:
 *   - Simplified schema: phases[name] = { model: '...', fallbacks?: [...] }
 *   - Lane array schema: phases[name] = [{ target: '...', kind: 'lane', ... }]
 *
 * @param {string} presetName
 * @param {object} preset
 * @param {object} agents - mutated in place
 * @param {string[]} warnings - mutated in place
 * @param {string} persona
 * @param {string} cwd
 * @param {object} routerOverrides
 */
function buildAgentEntry(presetName, preset, agents, warnings, persona, cwd, routerOverrides) {
      const orchestratorTarget = getOrchestratorTarget(preset);

      if (!orchestratorTarget) {
        warnings.push(
          `Profile "${presetName}" has no orchestrator phase with a target — skipped from overlay.`
        );
        return;
      }

      const agentName = `${GSR_AGENT_PREFIX}${presetName}`;
      const availability = preset.availability ?? 'stable';

      // Resolve identity for this preset using the fallback chain
      const identity = resolveIdentity(preset, { cwd });

      // Apply router-level override for this agent (if present) — overrides win
      const agentOverride = routerOverrides[agentName] ?? {};
      let resolvedPrompt = agentOverride.prompt ?? identity.prompt;

      // Build _gsr_fallbacks map keyed by phase name (preliminary pass to check if any fallbacks exist)
      // We need this BEFORE the protocol injection to gate the injection
      const preCheckPhases = preset.phases ?? {};
      const presetHasFallbacks = Object.values(preCheckPhases).some((phaseValue) => {
        // Simplified schema: { model, fallbacks? }
        if (!Array.isArray(phaseValue) && typeof phaseValue === 'object' && phaseValue !== null) {
          const rawFallbacks = phaseValue.fallbacks;
          if (!rawFallbacks) return false;
          if (Array.isArray(rawFallbacks)) return rawFallbacks.length > 0;
          if (typeof rawFallbacks === 'string') return rawFallbacks.trim().length > 0;
          return false;
        }
        // Lane array schema: [{ target, fallbacks?, ... }]
        if (!Array.isArray(phaseValue) || phaseValue.length === 0) return false;
        const primaryLane = phaseValue[0];
        if (!primaryLane || typeof primaryLane !== 'object') return false;
        const rawFallbacks = primaryLane.fallbacks;
        if (!rawFallbacks) return false;
        if (Array.isArray(rawFallbacks)) return rawFallbacks.length > 0;
        if (typeof rawFallbacks === 'string') return rawFallbacks.trim().length > 0;
        return false;
      });

      // Inject fallback protocol into prompt ONLY when preset has fallbacks (design D2)
      if (FALLBACK_PROTOCOL_TEXT && presetHasFallbacks && !resolvedPrompt.includes('GSR Fallback Protocol')) {
        resolvedPrompt = resolvedPrompt + '\n\n' + FALLBACK_PROTOCOL_TEXT;
      }

      // Inject heartbeat protocol into prompt for long-running agents (any agent with phases)
      const hasPhases = Object.keys(preset.phases ?? {}).length > 0;
      if (HEARTBEAT_PROTOCOL_TEXT && hasPhases && !resolvedPrompt.includes('GSR Watchdog Heartbeat Protocol')) {
        resolvedPrompt = resolvedPrompt + '\n\n' + HEARTBEAT_PROTOCOL_TEXT;
      }

      // Build _gsr_fallbacks map keyed by phase name.
      // Each entry is Array<{model: string, on: string[]}> — preserves on-conditions
      // for error-type-aware fallback selection by the orchestrator.
      // Handles both simplified schema and lane array schema.
      const gsrFallbacks = {};
      const phases = preset.phases ?? {};
      for (const [phaseName, phaseValue] of Object.entries(phases)) {
        let rawFallbacks;

        if (!Array.isArray(phaseValue) && typeof phaseValue === 'object' && phaseValue !== null) {
          // Simplified schema: { model, fallbacks? }
          rawFallbacks = phaseValue.fallbacks;
        } else if (Array.isArray(phaseValue) && phaseValue.length > 0) {
          // Lane array schema: take primary lane
          const primaryLane = phaseValue[0];
          if (!primaryLane || typeof primaryLane !== 'object') continue;
          rawFallbacks = primaryLane.fallbacks;
        } else {
          continue;
        }

        if (rawFallbacks !== undefined) {
          // normalizeFallbacks always returns Array<{model, on}> — use it as the source of truth
          const normalized = normalizeFallbacks(rawFallbacks);
          gsrFallbacks[phaseName] = normalized.map((fb) => ({
            model: typeof fb === 'string' ? fb : fb.model,
            on: (typeof fb === 'object' && Array.isArray(fb.on)) ? fb.on : ['any'],
          }));
        } else {
          gsrFallbacks[phaseName] = [];
        }
      }

      const entry = {
        mode: 'primary',
        description: `gsr: ${presetName} — ${availability} [${persona}]`,
        model: orchestratorTarget,
        prompt: resolvedPrompt,
        tools: mapPermissions(preset.permissions),
        _gsr_generated: true,
        _gsr_fallbacks: gsrFallbacks,
        _gsr_orchestrator_fallbacks: gsrFallbacks.orchestrator ?? [],
      };

      if (preset.hidden === true) {
        entry.hidden = true;
      }

      agents[agentName] = entry;

      // Generate tribunal sub-agents (judge, ministers, radar) when profile has tribunal config.
      // Design D10: profile-scoped, not per-phase. Additive — orchestrator entry unchanged.
      const tribunalConfig = collectTribunalConfig(preset);
      if (tribunalConfig.hasAny) {
        buildTribunalSubAgents(presetName, tribunalConfig, agents);
      }
}

/**
 * Merge overlay into existing opencode.json, respecting the _gsr_generated marker.
 *
 * Rules:
 *   - Non-gsr-* keys are always preserved.
 *   - gsr-* entries with _gsr_generated === true in existing → safe to overwrite.
 *   - gsr-* entries without _gsr_generated (or _gsr_generated !== true) in existing → preserved + warning
 *     (unless force=true, in which case they are overwritten with a warning).
 *   - gsr-* entries in existing that are NOT in the new overlay → removed only if _gsr_generated === true;
 *     user-created entries (no marker) are preserved (unless force=true).
 *
 * @param {{ agent: Record<string, object>, warnings?: string[] }} overlay - Output from generateOpenCodeOverlay
 * @param {object} [existing] - Current opencode.json content (parsed JSON object)
 * @param {{ force?: boolean }} [options]
 *   - force {boolean}: When true, overwrites ALL gsr-* entries including user-modified ones. Default: false.
 * @returns {{ agent: Record<string, object>, warnings: string[] }} - Merged config with warnings
 */
export function mergeOverlayWithExisting(overlay, existing = {}, options = {}) {
  const force = options?.force === true;
  const result = JSON.parse(JSON.stringify(existing));
  const mergeWarnings = Array.isArray(overlay.warnings) ? [...overlay.warnings] : [];

  if (!result.agent) result.agent = {};

  // Separate gsr-* entries in existing into:
  //   - GSR-managed (has _gsr_generated === true) → safe to remove/replace
  //   - User-owned (no marker or _gsr_generated !== true) → preserve (unless force)
  const existingGsrKeys = Object.keys(result.agent).filter(k => k.startsWith(GSR_AGENT_PREFIX));
  const userOwnedKeys = new Set();

  if (!force) {
    for (const key of existingGsrKeys) {
      const entry = result.agent[key];
      if (entry?._gsr_generated !== true) {
        // User-owned entry — preserve it
        userOwnedKeys.add(key);
      }
    }
  }

  // Remove stale GSR-managed gsr-* entries (not user-owned)
  for (const key of existingGsrKeys) {
    if (!userOwnedKeys.has(key)) {
      delete result.agent[key];
    }
  }

  // Add/replace new gsr-* entries, respecting user ownership
  for (const [key, entry] of Object.entries(overlay.agent ?? {})) {
    if (userOwnedKeys.has(key)) {
      // User-owned entry: emit warning and skip
      mergeWarnings.push(
        `${key}: user prompt detected — skipped (entry preserved as-is)`
      );
      // Keep existing user entry (already in result.agent)
      continue;
    }

    if (force && existing?.agent?.[key] && existing.agent[key]._gsr_generated !== true) {
      // Force overwrite: emit warning indicating forced overwrite
      mergeWarnings.push(
        `${key}: force overwrite — user entry replaced by generated value`
      );
    }

    result.agent[key] = entry;
  }

  // Attach warnings as non-enumerable so they travel with the return value
  // but are NEVER serialized to opencode.json (JSON.stringify ignores non-enumerable).
  Object.defineProperty(result, 'warnings', {
    value: mergeWarnings,
    enumerable: false,
    configurable: true,
  });

  return result;
}

/**
 * Read existing opencode.json and merge overlay into it.
 * Falls back to an empty config if the file is absent or unparseable.
 *
 * @param {{ agent: Record<string, object> }} overlay
 * @param {string} [configPath] - Override the default opencode.json path (for testing)
 * @param {{ force?: boolean }} [options]
 * @returns {object} - Merged config ready to write
 */
export function mergeOverlayWithFile(overlay, configPath = OPENCODE_CONFIG_PATH, options = {}) {
  let existing = {};

  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch {
      existing = {};
    }
  }

  return mergeOverlayWithExisting(overlay, existing, options);
}

/**
 * Write a config object to the given path atomically (temp + rename).
 *
 * @param {object} config - Object to write as JSON
 * @param {string} [targetPath] - Override the default opencode.json path (for testing)
 * @returns {string} - The path that was written
 */
export function writeOpenCodeConfig(config, targetPath = OPENCODE_CONFIG_PATH) {
  const dir = dirname(targetPath);
  mkdirSync(dir, { recursive: true });

  const json = JSON.stringify(config, null, 2) + '\n';
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;

  writeFileSync(tempPath, json, 'utf8');
  renameSync(tempPath, targetPath);

  return targetPath;
}

/**
 * Remove all gsr-* agent entries from opencode.json.
 * @param {string} [configPath] - Override path for testing
 * @returns {{ removedCount: number, path: string }}
 */
export function removeOpenCodeOverlay(configPath = OPENCODE_CONFIG_PATH) {
  if (!existsSync(configPath)) {
    return { removedCount: 0, path: configPath };
  }

  let existing = {};
  try {
    existing = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return { removedCount: 0, path: configPath };
  }

  if (!existing.agent || typeof existing.agent !== 'object') {
    return { removedCount: 0, path: configPath };
  }

  const gsrKeys = Object.keys(existing.agent).filter((key) => key.startsWith(GSR_AGENT_PREFIX));

  if (gsrKeys.length === 0) {
    return { removedCount: 0, path: configPath };
  }

  const result = JSON.parse(JSON.stringify(existing));
  for (const key of gsrKeys) {
    delete result.agent[key];
  }

  const dir = dirname(configPath);
  mkdirSync(dir, { recursive: true });
  const json = JSON.stringify(result, null, 2) + '\n';
  const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, json, 'utf8');
  renameSync(tempPath, configPath);

  return { removedCount: gsrKeys.length, path: configPath };
}

const OPENCODE_COMMANDS_DIR = join(homedir(), '.config', 'opencode', 'commands');

/**
 * Find the gsr commands source directory.
 * Commands are .md files shipped under router/commands/ in the package.
 */
function findCommandsSourceDir() {
  const moduleDir = dirname(new URL(import.meta.url).pathname);
  const commandsDir = join(moduleDir, '..', '..', '..', 'router', 'commands');
  if (existsSync(commandsDir)) return commandsDir;
  return null;
}

/**
 * Deploy gsr-*.md command files to the OpenCode commands directory.
 * These become /gsr-* slash commands inside the TUI.
 *
 * @param {{ commandsDir?: string }} options - Override target dir for testing
 * @returns {{ written: number, skipped: number, files: string[], targetDir: string }}
 */
export function deployGsrCommands(options = {}) {
  const sourceDir = findCommandsSourceDir();
  if (!sourceDir) {
    return { written: 0, skipped: 0, files: [], targetDir: '', error: 'Commands source directory not found.' };
  }

  const targetDir = options.commandsDir || OPENCODE_COMMANDS_DIR;
  mkdirSync(targetDir, { recursive: true });

  const sourceFiles = readdirSync(sourceDir).filter(f => f.endsWith('.md'));
  const files = [];
  let written = 0;
  let skipped = 0;

  // Catalog commands are eliminated — never deploy them
  const SKIP_FILES = new Set(['gsr-catalog-disable.md', 'gsr-catalog-enable.md', 'gsr-catalog-list.md', 'gsr-catalog-use.md']);

  // Commands that conflict with TUI plugin slash registrations → deploy under -manual suffix
  const RENAME_MAP = {
    'gsr.md': 'gsr-manual.md',
    'gsr-fallback.md': 'gsr-fallback-manual.md',
  };

  for (const file of sourceFiles) {
    if (SKIP_FILES.has(file)) continue;
    const sourcePath = join(sourceDir, file);
    const deployedFileName = RENAME_MAP[file] ?? file;
    const targetPath = join(targetDir, deployedFileName);
    const sourceContent = readFileSync(sourcePath, 'utf8');

    // Skip if identical content already exists
    if (existsSync(targetPath)) {
      const existingContent = readFileSync(targetPath, 'utf8');
      if (existingContent === sourceContent) {
        skipped++;
        continue;
      }
    }

    // Atomic write
    const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tempPath, sourceContent, 'utf8');
    renameSync(tempPath, targetPath);
    files.push(deployedFileName);
    written++;
  }

  return { written, skipped, files, targetDir };
}

/**
 * Remove all gsr-*.md command files from the OpenCode commands directory.
 * @param {{ commandsDir?: string }} options
 * @returns {{ removed: number, files: string[] }}
 */
export function removeGsrCommands(options = {}) {
  const targetDir = options.commandsDir || OPENCODE_COMMANDS_DIR;
  if (!existsSync(targetDir)) {
    return { removed: 0, files: [] };
  }

  const gsrFiles = readdirSync(targetDir).filter(f => f.startsWith('gsr-') && f.endsWith('.md'));
  for (const file of gsrFiles) {
    unlinkSync(join(targetDir, file));
  }

  return { removed: gsrFiles.length, files: gsrFiles };
}

/**
 * Remove stale gsr-* entries from the GLOBAL opencode.json.
 * Called during apply to migrate from old behavior (global) to new (project-local).
 *
 * @returns {{ removedCount: number, path: string }}
 */
export function cleanStaleGlobalOverlay() {
  return removeOpenCodeOverlay(OPENCODE_CONFIG_PATH);
}

export { OPENCODE_CONFIG_PATH, OPENCODE_COMMANDS_DIR, GSR_AGENT_PREFIX };

/**
 * Migration 002: Profile Schema Simplification
 *
 * Transforms v4 profiles from the legacy array-of-lanes phase format to the
 * simplified flat {model, fallbacks} object format. Also:
 *   - Promotes the active_preset profile to visible: true
 *   - Removes active_preset and active_catalog from coreConfig
 *   - Adds builtin: true to all profiles that don't already have it
 *   - Renames debug_invoke.preset → debug_invoke.profile (with gsr- prefix)
 *   - Separates sdd-debug profiles into invokeConfigs (separate from profiles)
 *
 * The migration is a pure transformation — no I/O. The runner handles file writes.
 */

export const migration = {
  id: '002',
  name: 'profile-schema-simplification',
  description: 'Simplify profile phase schema from array-of-lanes to flat {model, fallbacks} objects, extract debug invoke configs, and remove legacy active_preset/active_catalog from core config',
  type: 'major',
  /** When true, the runner must load and pass profilesArray as the second arg to canApply/apply. */
  needsProfiles: true,
  /**
   * When true, the runner skips the validateRouterConfig step after applying this migration.
   * Required because migration 002 produces a new phase schema that the old v3 validator
   * does not understand — the validator update is deferred to Phase 2.
   */
  skipValidationAfterApply: true,

  /**
   * Returns true if migration should run.
   *
   * Applies when:
   * - coreConfig has a non-empty active_preset, OR
   * - Any profile has at least one phase value that is an array (old lane format)
   *
   * @param {object} coreConfig
   * @param {Array<object>} profilesArray
   * @returns {boolean}
   */
  canApply(coreConfig, profilesArray = []) {
    // Condition 1: active_preset is present and non-empty
    if (typeof coreConfig.active_preset === 'string' && coreConfig.active_preset.length > 0) {
      return true;
    }

    // Condition 2: any profile has a phase in old array format
    for (const profile of profilesArray) {
      if (hasArrayPhase(profile)) {
        return true;
      }
    }

    return false;
  },

  /**
   * Apply the migration transformation.
   *
   * @param {object} coreConfig
   * @param {Array<object>} profilesArray
   * @returns {{ coreConfig: object, profiles: Array<{name: string, content: object}>, invokeConfigs: Array<{name: string, content: object}> }}
   */
  apply(coreConfig, profilesArray) {
    // Step 1: Deep clone inputs — do not mutate originals
    const updatedCore = JSON.parse(JSON.stringify(coreConfig));
    const inputProfiles = JSON.parse(JSON.stringify(profilesArray));

    const activePreset = updatedCore.active_preset ?? null;

    // Step 2: Set visible:true on the profile matching active_preset
    if (activePreset) {
      const match = inputProfiles.find((p) => p.name === activePreset);
      if (match) {
        match.visible = true;
      } else {
        // Warn but continue — don't throw
        console.warn(
          `[migration 002] active_preset "${activePreset}" does not match any profile — skipping visible:true assignment`
        );
      }
    }

    // Step 3: Remove active_preset and active_catalog from core config
    delete updatedCore.active_preset;
    delete updatedCore.active_catalog;

    // Steps 4–7: Transform each profile
    const profiles = [];
    const invokeConfigs = [];

    for (const profile of inputProfiles) {
      // Step 4: Add builtin:true if not already set
      if (!('builtin' in profile)) {
        profile.builtin = true;
      }

      // Step 5: Transform phases
      if (profile.phases && typeof profile.phases === 'object') {
        const transformedPhases = {};
        for (const [phaseName, phaseValue] of Object.entries(profile.phases)) {
          if (Array.isArray(phaseValue)) {
            // Old format: array of lanes → transform to {model, fallbacks}
            transformedPhases[phaseName] = transformLanes(phaseValue);
          } else {
            // New format: already an object → leave as-is
            transformedPhases[phaseName] = phaseValue;
          }
        }
        profile.phases = transformedPhases;
      }

      // Step 6: Rename debug_invoke.preset → debug_invoke.profile (with gsr- prefix)
      if (profile.debug_invoke && typeof profile.debug_invoke === 'object') {
        if ('preset' in profile.debug_invoke) {
          const presetValue = profile.debug_invoke.preset;
          const profileValue = presetValue.startsWith('gsr-') ? presetValue : `gsr-${presetValue}`;
          profile.debug_invoke.profile = profileValue;
          delete profile.debug_invoke.preset;
        } else if ('profile' in profile.debug_invoke) {
          // Already has profile key — ensure gsr- prefix
          const profileValue = profile.debug_invoke.profile;
          if (!profileValue.startsWith('gsr-')) {
            profile.debug_invoke.profile = `gsr-${profileValue}`;
          }
        }
      }

      // Step 7: Separate sdd-debug profiles into invokeConfigs
      const isSddDebug =
        profile.sdd === 'sdd-debug' ||
        (typeof profile.name === 'string' && profile.name.startsWith('sdd-debug'));

      if (isSddDebug) {
        // Invoke config name: prepend gsr- if not already there
        const invokeConfigName = profile.name.startsWith('gsr-') ? profile.name : `gsr-${profile.name}`;
        invokeConfigs.push({ name: invokeConfigName, content: profile });
      } else {
        profiles.push({ name: profile.name, content: profile });
      }
    }

    // Step 8: Build list of profile file names to delete from profiles/
    // (sdd-debug profiles that were moved to invokeConfigs)
    const deleteFromProfiles = invokeConfigs.map((ic) => {
      // Original name before gsr- prefix was added
      const originalName = ic.content?.name ?? ic.name.replace(/^gsr-/, '');
      return `${originalName}.router.yaml`;
    });

    return { coreConfig: updatedCore, profiles, invokeConfigs, deleteFromProfiles };
  },
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Returns true if any phase in the profile is in old array format.
 *
 * @param {object} profile
 * @returns {boolean}
 */
function hasArrayPhase(profile) {
  if (!profile.phases || typeof profile.phases !== 'object') {
    return false;
  }
  return Object.values(profile.phases).some((v) => Array.isArray(v));
}

/**
 * Transform an array of lanes into a simplified {model, fallbacks} object.
 * Uses the lane with role:'primary', or the first lane if none has role:'primary'.
 *
 * @param {Array<object>} lanes
 * @returns {{ model: string | undefined, fallbacks: string[] }}
 */
function transformLanes(lanes) {
  if (!lanes || lanes.length === 0) {
    return { fallbacks: [] };
  }

  // Find primary lane (role: 'primary'), fall back to first lane
  const primaryLane = lanes.find((l) => l.role === 'primary') ?? lanes[0];

  const model = primaryLane.target;

  // Parse fallbacks: already an array (post-migration-001) OR string (raw v3) → normalize to array
  const fallbacksRaw = primaryLane.fallbacks ?? '';
  let fallbacks;
  if (Array.isArray(fallbacksRaw)) {
    fallbacks = fallbacksRaw.filter((f) => typeof f === 'string' && f.trim().length > 0);
  } else if (typeof fallbacksRaw === 'string' && fallbacksRaw.trim().length > 0) {
    fallbacks = fallbacksRaw.split(',').map((f) => f.trim()).filter(Boolean);
  } else {
    fallbacks = [];
  }

  const result = {};
  if (model !== undefined && model !== null) {
    result.model = model;
  }
  result.fallbacks = fallbacks;

  return result;
}

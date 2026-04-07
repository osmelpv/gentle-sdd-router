import fs from 'node:fs';
import path from 'node:path';
import { parseYaml, stringifyYaml, validateRouterConfig } from '../router.js';
import { loadV4Profiles, assembleV4Config } from '../router-v4-io.js';
import { migration as m001 } from './001_v3-to-v4-multifile.js';
import { migration as m002 } from './002_profile-schema-simplification.js';

// ─── Static migration registry ───────────────────────────────────────────────
// New migration scripts: add one import above and push here.
const MIGRATIONS = [m001, m002];

// ─── Registry I/O ────────────────────────────────────────────────────────────

const REGISTRY_FILENAME = '.migrations.yaml';

/**
 * Default empty registry.
 * `applied` is an object map: { [migrationId]: { name, applied_at, backup_path? } }
 * This avoids the custom YAML parser's limitation with nested list-item objects.
 */
const DEFAULT_REGISTRY = { schema_version: 1, applied: {} };

/**
 * Load the per-project migration registry from `router/.migrations.yaml`.
 * Returns the default empty registry if the file does not exist.
 *
 * @param {string} routerDir  Absolute path to the router directory
 * @returns {{ schema_version: number, applied: Object.<string, {name: string, applied_at: string, backup_path?: string}> }}
 */
export function loadMigrationsRegistry(routerDir) {
  const registryPath = path.join(routerDir, REGISTRY_FILENAME);

  if (!fs.existsSync(registryPath)) {
    return { ...DEFAULT_REGISTRY, applied: {} };
  }

  const raw = fs.readFileSync(registryPath, 'utf8');
  const parsed = parseYaml(raw);

  // Handle both the current object-map format and legacy array format (forward compat)
  let applied = {};
  if (parsed.applied && typeof parsed.applied === 'object' && !Array.isArray(parsed.applied)) {
    applied = parsed.applied;
  } else if (Array.isArray(parsed.applied)) {
    // Legacy: convert array to map
    for (const entry of parsed.applied) {
      if (typeof entry === 'object' && entry.id) {
        applied[entry.id] = { name: entry.name, applied_at: entry.applied_at };
      } else if (typeof entry === 'string') {
        applied[String(entry)] = { name: entry, applied_at: null };
      }
    }
  }

  return {
    schema_version: parsed.schema_version ?? 1,
    applied,
  };
}

/**
 * Persist the migration registry to `router/.migrations.yaml`.
 *
 * @param {string} routerDir
 * @param {{ schema_version: number, applied: Object }} registry
 */
export function saveMigrationsRegistry(routerDir, registry) {
  const registryPath = path.join(routerDir, REGISTRY_FILENAME);
  const yaml = stringifyYaml(registry);
  fs.writeFileSync(registryPath, yaml, 'utf8');
}

// ─── Planner ─────────────────────────────────────────────────────────────────

const ROUTER_FILENAME = 'router.yaml';

/**
 * Calculate which migrations are pending for the project at `routerDir`.
 *
 * Algorithm:
 *  1. Read `router/router.yaml` to get the current config version.
 *  2. Read `.migrations.yaml` for the list of already-applied IDs.
 *  3. For each script in MIGRATIONS (in order):
 *       - Include it if `canApply(config)` returns true AND its id is not in applied.
 *
 * @param {string} routerDir  Absolute path to the router directory (contains router.yaml)
 * @returns {{
 *   currentVersion: number,
 *   targetVersion: number | null,
 *   pending: Array<{ id: string, name: string, description: string }>,
 *   alreadyApplied: string[],
 * }}
 */
export function planMigrations(routerDir) {
  const configPath = path.join(routerDir, ROUTER_FILENAME);
  const raw = fs.readFileSync(configPath, 'utf8');
  const config = parseYaml(raw);
  const currentVersion = config.version;

  const registry = loadMigrationsRegistry(routerDir);
  const appliedIds = new Set(Object.keys(registry.applied));

  const pending = [];

  for (const script of MIGRATIONS) {
    if (appliedIds.has(script.id)) {
      continue;
    }

    // Migrations with needsProfiles:true need project profiles to decide canApply.
    // Load profiles lazily only for those migrations, using includeGlobal:false to
    // avoid global plugin profiles polluting migration decisions.
    let profilesArray = [];
    if (script.needsProfiles === true) {
      try {
        const profilesDir = path.join(routerDir, 'profiles');
        if (fs.existsSync(profilesDir)) {
          const rawProfiles = loadV4Profiles(routerDir, { includeGlobal: false });
          profilesArray = rawProfiles.map((p) => p.content);
        }
      } catch {
        // Non-fatal: if profiles can't be loaded, fall back to empty array
        profilesArray = [];
      }
    }

    if (script.canApply(config, profilesArray)) {
      pending.push({
        id: script.id,
        name: script.name,
        description: script.description,
      });
    }
  }

  const targetVersion = pending.length > 0
    ? MIGRATIONS[MIGRATIONS.length - 1].toVersion
    : null;

  const pendingMinor = pending.filter((m) => {
    const script = MIGRATIONS.find((s) => s.id === m.id);
    return script?.type === 'minor';
  });
  const pendingMajor = pending.filter((m) => {
    const script = MIGRATIONS.find((s) => s.id === m.id);
    return script?.type !== 'minor';
  });

  return {
    currentVersion,
    targetVersion,
    pending,
    pendingMinor,
    pendingMajor,
    alreadyApplied: [...appliedIds],
  };
}

/**
 * Automatically apply all pending minor migrations for the project at `routerDir`.
 * Major migrations are not applied — they require explicit user confirmation.
 *
 * @param {string} routerDir  Absolute path to the router directory
 * @returns {{ applied: string[], backups: string[], plan?: object }}
 */
export async function applyMinorMigrations(routerDir) {
  const plan = planMigrations(routerDir);

  if (plan.pendingMinor.length === 0) {
    return { applied: [], backups: [], plan };
  }

  const applied = [];
  const backups = [];

  for (const pendingMigration of plan.pendingMinor) {
    const script = MIGRATIONS.find((m) => m.id === pendingMigration.id);
    if (!script) continue;

    let backupPath = null;

    try {
      backupPath = createBackup(routerDir, script.id);
      backups.push(backupPath);

      const configPath = path.join(routerDir, ROUTER_FILENAME);
      const raw = fs.readFileSync(configPath, 'utf8');
      const config = parseYaml(raw);

      let output;
      if (script.needsProfiles === true) {
        const rawProfiles = loadV4Profiles(routerDir, { includeGlobal: false });
        const profilesArray = rawProfiles.map((p) => ({ ...p.content, name: p.content.name ?? p.fileName?.replace('.router.yaml', '') }));
        output = script.apply(config, profilesArray);
      } else {
        output = script.apply(config, { routerDir });
      }
      writeMigrationOutput(routerDir, output);

      if (!script.skipValidationAfterApply) {
        const writtenProfiles = loadV4Profiles(routerDir);
        const writtenCore = parseYaml(fs.readFileSync(path.join(routerDir, ROUTER_FILENAME), 'utf8'));
        const assembled = assembleV4Config(writtenCore, writtenProfiles);
        validateRouterConfig(assembled);
      }

      const registry = loadMigrationsRegistry(routerDir);
      registry.applied[script.id] = {
        name: script.name,
        applied_at: new Date().toISOString(),
        backup_path: backupPath,
      };
      saveMigrationsRegistry(routerDir, registry);

      applied.push(script.id);
    } catch (err) {
      if (backupPath) restoreBackup(routerDir, backupPath);
      throw err;
    }
  }

  return { applied, backups, plan };
}

// ─── Backup helpers ───────────────────────────────────────────────────────────

const BACKUPS_DIRNAME = 'backups';

/**
 * Create a timestamped backup of the entire routerDir (excluding backups/ itself).
 *
 * @param {string} routerDir  Absolute path to the router directory
 * @param {string} migrationId  Migration ID used in the backup folder name
 * @returns {string}  Absolute path to the created backup directory
 */
export function createBackup(routerDir, migrationId) {
  const timestamp = Date.now();
  const backupName = `pre-${migrationId}-${timestamp}`;
  const backupsDir = path.join(routerDir, BACKUPS_DIRNAME);
  const backupPath = path.join(backupsDir, backupName);

  fs.mkdirSync(backupPath, { recursive: true });

  const entries = fs.readdirSync(routerDir);

  for (const entry of entries) {
    if (entry === BACKUPS_DIRNAME) {
      continue; // never backup the backups dir itself
    }

    const src = path.join(routerDir, entry);
    const dest = path.join(backupPath, entry);
    fs.cpSync(src, dest, { recursive: true });
  }

  return backupPath;
}

/**
 * Restore a previously created backup to routerDir.
 * Removes all current routerDir contents (except backups/) then copies backup in.
 *
 * @param {string} routerDir  Absolute path to the router directory
 * @param {string} backupPath  Absolute path to the backup directory to restore from
 */
export function restoreBackup(routerDir, backupPath) {
  // Remove all current entries except backups/
  const entries = fs.readdirSync(routerDir);
  for (const entry of entries) {
    if (entry === BACKUPS_DIRNAME) {
      continue;
    }

    const entryPath = path.join(routerDir, entry);
    fs.rmSync(entryPath, { recursive: true, force: true });
  }

  // Copy backup contents back
  const backupEntries = fs.readdirSync(backupPath);
  for (const entry of backupEntries) {
    const src = path.join(backupPath, entry);
    const dest = path.join(routerDir, entry);
    fs.cpSync(src, dest, { recursive: true });
  }
}

// ─── Write migration output ───────────────────────────────────────────────────

/**
 * Atomically write the migration output (coreConfig + profiles[] + optional invokeConfigs[]) to routerDir.
 *
 * @param {string} routerDir
 * @param {{
 *   coreConfig: object,
 *   profiles: Array<{name: string, catalog?: string, content: object}>,
 *   invokeConfigs?: Array<{name: string, content: object}>
 * }} output
 */
function writeMigrationOutput(routerDir, output) {
  const configPath = path.join(routerDir, 'router.yaml');

  // Write core config atomically
  const coreYaml = stringifyYaml(output.coreConfig);
  const tempCore = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempCore, coreYaml, 'utf8');
  fs.renameSync(tempCore, configPath);

  // Ensure profiles directory exists
  const profilesDir = path.join(routerDir, 'profiles');
  fs.mkdirSync(profilesDir, { recursive: true });

  // Write each profile atomically
  for (const profile of output.profiles) {
    const catalogDir = profile.catalog && profile.catalog !== 'default'
      ? path.join(profilesDir, profile.catalog)
      : profilesDir;

    fs.mkdirSync(catalogDir, { recursive: true });

    const profilePath = path.join(catalogDir, `${profile.name}.router.yaml`);
    const profileYaml = stringifyYaml(profile.content);
    const tempProfile = `${profilePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempProfile, profileYaml, 'utf8');
    fs.renameSync(tempProfile, profilePath);
  }

  // Write invokeConfigs to router/invoke_configs/ (migration 002 output)
  if (Array.isArray(output.invokeConfigs) && output.invokeConfigs.length > 0) {
    const invokeConfigsDir = path.join(routerDir, 'invoke_configs');
    fs.mkdirSync(invokeConfigsDir, { recursive: true });

    for (const cfg of output.invokeConfigs) {
      const cfgPath = path.join(invokeConfigsDir, `${cfg.name}.yaml`);
      const cfgYaml = stringifyYaml(cfg.content);
      const tempCfg = `${cfgPath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tempCfg, cfgYaml, 'utf8');
      fs.renameSync(tempCfg, cfgPath);
    }
  }

  // Delete profiles that were moved to invokeConfigs (e.g. sdd-debug-*)
  if (Array.isArray(output.deleteFromProfiles) && output.deleteFromProfiles.length > 0) {
    const profilesDir = path.join(routerDir, 'profiles');
    for (const fileName of output.deleteFromProfiles) {
      const filePath = path.join(profilesDir, fileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

/**
 * Run all pending migrations for the project at `routerDir`.
 *
 * @param {string} routerDir  Absolute path to the router directory
 * @param {{ dryRun?: boolean, confirm?: (plan: object) => boolean }} [options]
 * @returns {{ applied: string[], backups: string[], plan?: object }}
 */
export async function runMigrations(routerDir, options = {}) {
  const { dryRun = false } = options;

  // Step 1: plan
  const plan = planMigrations(routerDir);

  if (plan.pending.length === 0) {
    return { applied: [], backups: [], plan };
  }

  // Step 2: dry-run — return plan without executing
  if (dryRun) {
    return { applied: [], backups: [], plan };
  }

  const applied = [];
  const backups = [];

  for (const pendingMigration of plan.pending) {
    // Find the full migration script object
    const script = MIGRATIONS.find((m) => m.id === pendingMigration.id);
    if (!script) {
      throw new Error(`Migration script not found for id "${pendingMigration.id}".`);
    }

    let backupPath = null;

    try {
      // Step 3a: backup
      backupPath = createBackup(routerDir, script.id);
      backups.push(backupPath);

      // Step 3b: load current config
      const configPath = path.join(routerDir, ROUTER_FILENAME);
      const raw = fs.readFileSync(configPath, 'utf8');
      const config = parseYaml(raw);

      // Step 3c: apply migration
      // Migrations with needsProfiles:true receive the current profiles as the second arg.
      let output;
      if (script.needsProfiles === true) {
        const rawProfiles = loadV4Profiles(routerDir, { includeGlobal: false });
        const profilesArray = rawProfiles.map((p) => ({ ...p.content, name: p.content.name ?? p.fileName?.replace('.router.yaml', '') }));
        output = script.apply(config, profilesArray);
      } else {
        output = script.apply(config, { routerDir });
      }

      // Step 3d: write output
      writeMigrationOutput(routerDir, output);

      // Step 3e: validate — load written files and assemble to validate
      // (skip validation for migrations that transform to new schema the validator doesn't understand)
      if (!script.skipValidationAfterApply) {
        const writtenProfiles = loadV4Profiles(routerDir);
        const writtenCore = parseYaml(fs.readFileSync(path.join(routerDir, ROUTER_FILENAME), 'utf8'));
        const assembled = assembleV4Config(writtenCore, writtenProfiles);
        validateRouterConfig(assembled);
      }

      // Step 3f: update registry
      const registry = loadMigrationsRegistry(routerDir);
      registry.applied[script.id] = {
        name: script.name,
        applied_at: new Date().toISOString(),
        backup_path: backupPath,
      };
      saveMigrationsRegistry(routerDir, registry);

      applied.push(script.id);
    } catch (err) {
      // Rollback: restore from backup
      if (backupPath) {
        restoreBackup(routerDir, backupPath);
      }

      throw err;
    }
  }

  return { applied, backups, plan };
}

// ─── Exports ─────────────────────────────────────────────────────────────────
export { MIGRATIONS };

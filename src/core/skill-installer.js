/**
 * Skill Installer
 *
 * Detects AI coding environments and installs GSR skill files into their skills directories.
 * Skills teach agents how to use gsr, how to run a Tribunal, etc.
 *
 * Design decisions:
 * - D1: detect environments by scanning known config dirs; never throw on detection failure
 * - D3: atomic writes (temp + rename) for safe installation
 * - Hash comparison (SHA-256) for idempotent installs — skip if content unchanged
 * - No external dependencies — only Node.js built-ins
 *
 * @module core/skill-installer
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  readdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Compute SHA-256 hash of a buffer or string.
 * Uses binary content to avoid platform newline issues.
 *
 * @param {Buffer|string} content
 * @returns {string} hex digest
 */
function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Detect AI coding environments present on this machine.
 *
 * Detection strategy:
 *   1. Check for OpenCode: ~/.config/opencode/ directory exists
 *   2. Check for Claude Code: ~/.claude/ or ~/.config/Claude/ exists
 *
 * Never throws — returns empty array if detection fails entirely.
 *
 * @returns {Array<{ name: string, skillsDir: string }>}
 */
export function detectEnvironments() {
  const environments = [];
  const home = homedir();

  // Defensive wrapper for each detection
  function tryDetect(fn) {
    try {
      return fn();
    } catch {
      return null;
    }
  }

  // OpenCode: ~/.config/opencode/skills/
  tryDetect(() => {
    const openCodeConfigDir = join(home, '.config', 'opencode');
    if (existsSync(openCodeConfigDir)) {
      const skillsDir = join(openCodeConfigDir, 'skills');
      environments.push({ name: 'opencode', skillsDir });
    }
  });

  // Claude Code: ~/.config/Claude/skills/ (check if ~/.claude/ or ~/.config/Claude/ exists)
  tryDetect(() => {
    const claudeDir = join(home, '.claude');
    const claudeConfigDir = join(home, '.config', 'Claude');
    if (existsSync(claudeDir) || existsSync(claudeConfigDir)) {
      const skillsDir = join(claudeConfigDir, 'skills');
      environments.push({ name: 'claude-code', skillsDir });
    }
  });

  return environments;
}

/**
 * Get the path to the router/skills/ source directory.
 *
 * Resolution order:
 *   1. routerDir/skills/ (when called from a project context)
 *   2. MODULE_DIR/../../router/skills/ (when called from the installed package)
 *
 * @param {string} [routerDir] - Optional explicit router directory
 * @returns {string} absolute path to router/skills/
 */
export function getSkillsSourceDir(routerDir) {
  if (routerDir) {
    return join(routerDir, 'skills');
  }
  // Default: relative to this module (src/core/ → router/skills/)
  return join(MODULE_DIR, '..', '..', 'router', 'skills');
}

/**
 * Install GSR skills to detected AI environments.
 *
 * Logic:
 *   1. Find skills source: router/skills/ (relative to routerDir or module dir)
 *   2. Detect environments
 *   3. For each environment × skill file:
 *      a. Compute SHA-256 of source content
 *      b. If target exists, compute hash of target
 *      c. If hashes match → skip (idempotent)
 *      d. If different or missing → atomic write (temp + rename)
 *
 * @param {Object} [options]
 * @param {boolean} [options.global] - Install to all detected environments (true) or project-local only (false)
 * @param {string} [options.routerDir] - Override router directory (for testing)
 * @param {boolean} [options.force] - Force overwrite even when hashes match
 * @returns {{ installed: number, skipped: number, environments: string[], errors: string[] }}
 */
export function installSkills(options = {}) {
  const { routerDir, force = false } = options;

  const result = {
    installed: 0,
    skipped: 0,
    environments: [],
    errors: [],
  };

  // Step 1: Find source directory
  const sourceDir = getSkillsSourceDir(routerDir);

  if (!existsSync(sourceDir)) {
    result.errors.push(`Skills source directory not found: ${sourceDir}`);
    return result;
  }

  // Step 2: List skill files
  let skillFiles;
  try {
    skillFiles = readdirSync(sourceDir).filter((f) => f.endsWith('.md'));
  } catch (err) {
    result.errors.push(`Failed to read skills source directory: ${err.message}`);
    return result;
  }

  if (skillFiles.length === 0) {
    return result;
  }

  // Step 3: Detect environments
  const environments = detectEnvironments();

  if (environments.length === 0) {
    return result;
  }

  // Step 4: Install to each environment
  for (const env of environments) {
    const { name, skillsDir } = env;

    // Create skills directory if it doesn't exist
    try {
      mkdirSync(skillsDir, { recursive: true });
    } catch (err) {
      result.errors.push(`${name}: Failed to create skills dir: ${err.message}`);
      continue;
    }

    let envInstalled = 0;
    let envSkipped = 0;

    for (const file of skillFiles) {
      const sourcePath = join(sourceDir, file);
      const targetPath = join(skillsDir, file);

      try {
        // Read source content
        const sourceContent = readFileSync(sourcePath);
        const sourceHash = sha256(sourceContent);

        // Check if target exists and compute its hash
        if (!force && existsSync(targetPath)) {
          try {
            const targetContent = readFileSync(targetPath);
            const targetHash = sha256(targetContent);
            if (sourceHash === targetHash) {
              envSkipped++;
              continue;
            }
          } catch {
            // Target exists but can't read — will try to overwrite
          }
        }

        // Atomic write: temp file + rename
        const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
        writeFileSync(tempPath, sourceContent);
        renameSync(tempPath, targetPath);
        envInstalled++;
      } catch (err) {
        result.errors.push(`${name}/${file}: ${err.message}`);
      }
    }

    if (envInstalled > 0 || envSkipped > 0) {
      result.environments.push(name);
    }
    result.installed += envInstalled;
    result.skipped += envSkipped;
  }

  return result;
}

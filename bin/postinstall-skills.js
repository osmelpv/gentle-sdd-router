#!/usr/bin/env node
/**
 * Postinstall script — install GSR skill files to detected AI environments.
 *
 * Only runs when installed globally (`npm install -g gentle-sdd-router`).
 * Silently exits when installed as a project dependency.
 *
 * Detection: check npm_config_global env var (set by npm during global installs).
 */

const isGlobalInstall = process.env.npm_config_global === 'true';

if (!isGlobalInstall) {
  // Local install — skills will be installed via `gsr install` or `gsr skill-install`
  process.exit(0);
}

try {
  const { installSkills } = await import('../src/core/skill-installer.js');
  const result = installSkills({ global: true });

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      process.stderr.write(`[gsr postinstall] Warning: ${err}\n`);
    }
  }

  if (result.installed > 0) {
    process.stdout.write(
      `[gsr postinstall] Installed ${result.installed} skill file(s) to: ${result.environments.join(', ')}\n`
    );
  } else if (result.skipped > 0) {
    process.stdout.write(`[gsr postinstall] Skills already up to date.\n`);
  }
} catch (err) {
  // Non-fatal: postinstall should never block the install
  process.stderr.write(`[gsr postinstall] Skill install failed (non-fatal): ${err.message}\n`);
}

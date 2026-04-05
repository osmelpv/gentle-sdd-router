/**
 * Claude Code Command Deployer
 *
 * Deploys /gsr-* commands to ~/.claude/commands/ for use as Claude Code slash commands.
 * Transforms opencode-specific syntax to Claude Code format before writing.
 *
 * MANUAL VERIFICATION:
 *   ls ~/.claude/commands/gsr*.md
 *   Expected: all gsr-*.md files from router/commands/ present, with `!` stripped.
 *
 * WHEN CLAUDE CODE IS NOT INSTALLED:
 *   ~/.claude/ may not exist. This module creates it if Claude Code is absent but the dir
 *   does not exist — safe to call unconditionally. If `~/.claude/` exists, commands are
 *   deployed normally. The step in unified-sync.js logs at debug level and skips silently
 *   rather than failing when Claude Code is definitively not present.
 *
 * TRANSFORM RULES APPLIED:
 *   Rule 1: Strip `!` prefix from shell commands:  !`cmd` → `cmd`
 *   Rule 2: Lines whose only shell content was `!`backtick get a "Run using your bash tool:" prefix
 *           so the Claude Code AI knows to execute them via bash rather than type them in a TUI.
 *   YAML frontmatter (between --- delimiters) is preserved verbatim.
 *
 * @module claude-code/command-deployer
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const CLAUDE_COMMANDS_DIR = join(homedir(), '.claude', 'commands');

/**
 * Find the gsr commands source directory.
 * Commands are .md files shipped under router/commands/ in the package.
 *
 * @returns {string|null}
 */
function findCommandsSourceDir() {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const commandsDir = join(moduleDir, '..', '..', '..', 'router', 'commands');
  if (existsSync(commandsDir)) return commandsDir;
  return null;
}

/**
 * Transform opencode markdown content to Claude Code format.
 *
 * Rules applied (in order):
 *   1. YAML frontmatter lines (between leading --- markers) are passed through unchanged.
 *   2. Lines that consist ONLY of `!`backtick-cmd` (optional surrounding whitespace):
 *        !`gsr status`  →  Run using your bash tool: `gsr status`
 *   3. Inline `!`backtick-cmd` occurrences within normal text lines:
 *        "Run: !`gsr status`"  →  "Run: `gsr status`"
 *        (The `!` is removed; no prefix is injected for mid-line occurrences.)
 *
 * The transform is idempotent: applying it twice yields the same output.
 *
 * @param {string} content - Raw markdown content from router/commands/
 * @returns {string} - Transformed content for Claude Code
 */
export function transformForClaudeCode(content) {
  const lines = content.split('\n');
  const result = [];

  // Track YAML frontmatter state
  let inFrontmatter = false;
  let frontmatterClosed = false;
  let frontmatterCount = 0;

  for (const line of lines) {
    // Detect YAML frontmatter delimiters (--- at start of line)
    if (line.trim() === '---') {
      frontmatterCount++;
      if (frontmatterCount === 1) {
        inFrontmatter = true;
        result.push(line);
        continue;
      } else if (frontmatterCount === 2) {
        inFrontmatter = false;
        frontmatterClosed = true;
        result.push(line);
        continue;
      }
    }

    // Pass frontmatter lines through unchanged
    if (inFrontmatter) {
      result.push(line);
      continue;
    }

    // Check if line is ONLY a !`...` shell command (with optional leading/trailing whitespace)
    // Pattern: optional whitespace, !`...`, optional whitespace — nothing else on the line
    const onlyShellCmd = /^(\s*)!\`([^`]+)`(\s*)$/.exec(line);
    if (onlyShellCmd) {
      const indent = onlyShellCmd[1];
      const cmd = onlyShellCmd[2];
      // Transform to: Run using your bash tool: `cmd`
      result.push(`${indent}Run using your bash tool: \`${cmd}\``);
      continue;
    }

    // Remove inline `!` prefix from backtick shell commands anywhere on the line
    // e.g. "- Command: !`gsr status`" → "- Command: `gsr status`"
    const transformed = line.replace(/!\`([^`]+)`/g, '`$1`');
    result.push(transformed);
  }

  return result.join('\n');
}

/**
 * Deploy gsr-*.md command files to ~/.claude/commands/, transforming opencode
 * syntax to Claude Code format.
 *
 * - Creates targetDir if it does not exist (same pattern as opencode deployer).
 * - Skips files when transformed content is identical to existing (noop detection).
 * - Writes atomically via temp file + rename.
 *
 * @param {string} [commandsSourceDir] - Override source dir (for testing)
 * @param {string} [targetDir] - Override target dir (for testing)
 * @returns {{ deployed: number, skipped: number, errors: string[], targetDir: string }}
 */
export async function deployGsrCommandsClaudeCode(commandsSourceDir, targetDir) {
  const sourceDir = commandsSourceDir ?? findCommandsSourceDir();
  if (!sourceDir) {
    return {
      deployed: 0,
      skipped: 0,
      errors: ['Commands source directory not found.'],
      targetDir: targetDir ?? CLAUDE_COMMANDS_DIR,
    };
  }

  const effectiveTargetDir = targetDir ?? CLAUDE_COMMANDS_DIR;

  // Verify source dir exists (when explicitly passed, findCommandsSourceDir check is bypassed)
  if (!existsSync(sourceDir)) {
    return {
      deployed: 0,
      skipped: 0,
      errors: [`Commands source directory not found: ${sourceDir}`],
      targetDir: effectiveTargetDir,
    };
  }

  try {
    mkdirSync(effectiveTargetDir, { recursive: true });
  } catch (err) {
    return {
      deployed: 0,
      skipped: 0,
      errors: [`Failed to create target directory: ${err.message}`],
      targetDir: effectiveTargetDir,
    };
  }

  const sourceFiles = readdirSync(sourceDir).filter(f => f.endsWith('.md'));
  let deployed = 0;
  let skipped = 0;
  const errors = [];

  // Catalog commands are eliminated
  const SKIP_FILES = new Set(['gsr-catalog-disable.md', 'gsr-catalog-enable.md', 'gsr-catalog-list.md', 'gsr-catalog-use.md']);
  // Commands handled by TUI plugin slash registration → deploy as -manual
  const RENAME_MAP = { 'gsr.md': 'gsr-manual.md', 'gsr-fallback.md': 'gsr-fallback-manual.md' };

  for (const file of sourceFiles) {
    if (SKIP_FILES.has(file)) continue;
    try {
      const sourcePath = join(sourceDir, file);
      const deployedFileName = RENAME_MAP[file] ?? file;
      const targetPath = join(effectiveTargetDir, deployedFileName);
      const rawContent = readFileSync(sourcePath, 'utf8');
      const transformed = transformForClaudeCode(rawContent);

      // Noop detection: skip if content identical
      if (existsSync(targetPath)) {
        const existingContent = readFileSync(targetPath, 'utf8');
        if (existingContent === transformed) {
          skipped++;
          continue;
        }
      }

      // Atomic write
      const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tempPath, transformed, 'utf8');
      renameSync(tempPath, targetPath);
      deployed++;
    } catch (err) {
      errors.push(`${file}: ${err.message}`);
    }
  }

  return { deployed, skipped, errors, targetDir: effectiveTargetDir };
}

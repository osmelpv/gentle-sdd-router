import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/**
 * All 8 known AI coding platforms with detection paths and provider mappings.
 * detectPath uses '~' as shorthand for os.homedir().
 */
export const PLATFORMS = [
  { id: 'claude-code',    label: 'Claude Code',    detectPath: '~/.claude',                   providers: ['anthropic'] },
  { id: 'opencode',       label: 'OpenCode',        detectPath: '~/.config/opencode',           providers: ['opencode', 'opencode-go', 'openai', 'anthropic', 'mistral'] },
  { id: 'gemini-cli',     label: 'Gemini CLI',      detectPath: '~/.gemini',                   providers: ['google'] },
  { id: 'cursor',         label: 'Cursor',          detectPath: '~/.cursor',                   providers: ['anthropic', 'openai', 'google'] },
  { id: 'vscode-copilot', label: 'VS Code Copilot', detectPath: '~/.copilot',                 providers: ['openai', 'anthropic'] },
  { id: 'codex',          label: 'Codex',           detectPath: '~/.codex',                    providers: ['openai'] },
  { id: 'windsurf',       label: 'Windsurf',        detectPath: '~/.codeium/windsurf',         providers: ['anthropic', 'openai', 'google'] },
  { id: 'antigravity',    label: 'Antigravity',     detectPath: '~/.gemini/antigravity',       providers: ['google'] },
];

/**
 * Auto-detect which platforms are installed by checking their config paths.
 *
 * @returns {string[]} Array of platform IDs whose config path exists on disk
 */
export function detectInstalledPlatforms() {
  return PLATFORMS.filter(p => {
    const resolved = p.detectPath.replace('~', os.homedir());
    return fs.existsSync(resolved);
  }).map(p => p.id);
}

/**
 * Given a list of active platform IDs, return unique provider names
 * used by those platforms.
 *
 * @param {string[]} platformIds  List of platform IDs (e.g. ['opencode', 'claude-code'])
 * @returns {string[]}            Unique, sorted provider name strings
 */
export function getProvidersForPlatforms(platformIds) {
  const providers = new Set();
  PLATFORMS
    .filter(p => platformIds.includes(p.id))
    .forEach(p => p.providers.forEach(pr => providers.add(pr)));
  return [...providers].sort();
}

// @ts-nocheck
/** @jsxImportSource @opentui/solid */
/**
 * tui.tsx — OpenCode TUI Plugin entry point for gsr.
 *
 * This file is the entry point loaded by OpenCode when the project directory
 * is registered in tui.json. It delegates all logic to the canonical plugin
 * implementation in src/adapters/opencode/gsr-tui-plugin.js.
 *
 * Do NOT add logic here — keep it as a thin re-export wrapper.
 */
export { default } from './src/adapters/opencode/gsr-tui-plugin.js';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getGlobalSddAgentSpecs } from '../src/core/global-sdd-agent-routing.js';
import { materializeGlobalSddAgents } from '../src/adapters/opencode/global-sdd-agent-materializer.js';
import { runSddGlobalSync } from '../src/cli.js';

function captureStdout(fn) {
  const original = process.stdout.write.bind(process.stdout);
  const chunks = [];
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return chunks.join('');
}

test('getGlobalSddAgentSpecs derives standard SDD agents from local-hybrid', () => {
  const specs = getGlobalSddAgentSpecs({ preset: 'local-hybrid', debugPreset: 'sdd-debug-mono', cwd: os.tmpdir() });
  const byName = new Map(specs.map((s) => [s.name, s]));

  assert.equal(byName.get('sdd-explore')?.target, 'opencode/nemotron-3-super-free');
  assert.equal(byName.get('sdd-propose')?.target, 'opencode/qwen3.6-plus-free');
  assert.equal(byName.get('sdd-apply')?.target, 'anthropic/claude-sonnet-4-6');
  assert.equal(byName.get('sdd-verify')?.target, 'openai/gpt-5.4');
  assert.equal(byName.get('sdd-archive')?.target, 'google/gemini-3-flash-preview');
  assert.equal(byName.get('sdd-orchestrator')?.target, 'opencode/qwen3.6-plus-free');
});

test('getGlobalSddAgentSpecs derives debug agents from sdd-debug-mono', () => {
  const specs = getGlobalSddAgentSpecs({ preset: 'local-hybrid', debugPreset: 'sdd-debug-mono', cwd: os.tmpdir() });
  const names = specs.map((s) => s.name);
  assert.ok(names.includes('sdd-debug-explore-issues'));
  assert.ok(names.includes('sdd-debug-apply-fix'));
  assert.ok(names.includes('sdd-debug-archive-debug'));

  const explore = specs.find((s) => s.name === 'sdd-debug-explore-issues');
  assert.equal(explore.target, 'openai/gpt-5.4');
  assert.match(explore.prompt, /explore-issues/);
  assert.match(explore.prompt, /contracts\/phases\/explore-issues\.md/);
});

test('materializeGlobalSddAgents writes managed sdd-* agents and preserves unrelated ones', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-global-agents-'));
  const targetPath = path.join(tmp, 'opencode.json');
  fs.writeFileSync(targetPath, JSON.stringify({
    agent: {
      unrelated: { mode: 'primary', model: 'openai/gpt-4.1' },
      'sdd-explore': { mode: 'subagent', model: 'old/model' },
    },
  }, null, 2));

  const specs = getGlobalSddAgentSpecs({ preset: 'local-hybrid', debugPreset: 'sdd-debug-mono', cwd: os.tmpdir() });
  const result = materializeGlobalSddAgents(specs, targetPath);
  const written = JSON.parse(fs.readFileSync(targetPath, 'utf8'));

  assert.equal(result.count, specs.length);
  assert.equal(written.agent.unrelated.model, 'openai/gpt-4.1');
  assert.equal(written.agent['sdd-explore'].model, 'opencode/nemotron-3-super-free');
  assert.equal(written.agent['sdd-explore']._gsr_generated, true);
  assert.equal(written.agent['sdd-debug-apply-fix'].model, 'openai/gpt-5.4');
  assert.equal(written.agent['sdd-debug-apply-fix'].hidden, true);
});

test('runSddGlobalSync prints summary and writes temp config', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-global-sync-'));
  const targetPath = path.join(tmp, 'opencode.json');

  const output = captureStdout(() => runSddGlobalSync(['--preset', 'local-hybrid', '--debug-preset', 'sdd-debug-mono'], { targetPath, cwd: os.tmpdir() }));
  const written = JSON.parse(fs.readFileSync(targetPath, 'utf8'));

  assert.match(output, /Global SDD agents synced:/);
  assert.match(output, /Preset: local-hybrid/);
  assert.match(output, /Debug preset: sdd-debug-mono/);
  assert.ok(written.agent['sdd-verify']);
  assert.ok(written.agent['sdd-debug-validate-fix']);
});

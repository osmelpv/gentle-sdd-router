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
  const specs = getGlobalSddAgentSpecs();
  const standardSpecs = specs.filter((s) => s.sdd === 'sdd-orchestrator');
  const standardNames = standardSpecs.map((s) => s.name);
  assert.ok(standardNames.includes('sdd-orchestrator'), 'Should have sdd-orchestrator');
  assert.ok(standardNames.includes('sdd-explore'), 'Should have sdd-explore');
  assert.ok(standardNames.includes('sdd-apply'), 'Should have sdd-apply');
  assert.ok(standardNames.includes('sdd-verify'), 'Should have sdd-verify');
  assert.ok(standardNames.includes('sdd-archive'), 'Should have sdd-archive');

  const orch = standardSpecs.find((s) => s.name === 'sdd-orchestrator');
  assert.equal(orch.mode, 'primary');
  assert.equal(orch.hidden, false);
});

test('getGlobalSddAgentSpecs derives v2 debug agents from sdd-debug-mono', () => {
  const specs = getGlobalSddAgentSpecs();
  const debugSpecs = specs.filter((s) => s.sdd === 'sdd-debug');
  const debugNames = debugSpecs.map((s) => s.name);

  // v2: 3 delegated phases only (analyze-area, implant-logs, apply-fixes)
  assert.equal(debugSpecs.length, 3, `Expected 3 debug agents, got: ${debugNames.join(', ')}`);
  assert.ok(debugNames.includes('sdd-debug-analyze-area'));
  assert.ok(debugNames.includes('sdd-debug-implant-logs'));
  assert.ok(debugNames.includes('sdd-debug-apply-fixes'));

  // All debug agents should be subagents
  for (const spec of debugSpecs) {
    assert.equal(spec.mode, 'subagent');
    assert.equal(spec.hidden, true);
    assert.equal(spec.target, 'openai/gpt-5.4');
  }
});

test('materializeGlobalSddAgents writes managed sdd-* agents and preserves unrelated ones', () => {
  const specs = getGlobalSddAgentSpecs();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-test-'));
  const tmpConfig = path.join(tmpDir, 'agents.json');

  // Write an existing unrelated agent
  fs.writeFileSync(tmpConfig, JSON.stringify({ agent: { 'my-custom': { prompt: 'test' } } }));

  const result = materializeGlobalSddAgents(specs, tmpConfig);
  const written = JSON.parse(fs.readFileSync(tmpConfig, 'utf8'));

  // Unrelated agent preserved
  assert.ok(written.agent['my-custom'], 'Should preserve unrelated agents');

  // GSR agents written
  assert.ok(written.agent['sdd-orchestrator'], 'Should have sdd-orchestrator');
  assert.ok(written.agent['sdd-debug-analyze-area'], 'Should have sdd-debug-analyze-area');
  assert.ok(written.agent['sdd-debug-implant-logs'], 'Should have sdd-debug-implant-logs');
  assert.ok(written.agent['sdd-debug-apply-fixes'], 'Should have sdd-debug-apply-fixes');

  // All GSR agents marked as generated
  for (const name of result.agentNames) {
    assert.equal(written.agent[name]._gsr_generated, true);
  }

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('runSddGlobalSync prints summary and writes temp config', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-sync-test-'));
  const tmpConfig = path.join(tmpDir, 'agents.json');
  const output = captureStdout(() => {
    runSddGlobalSync([], { targetPath: tmpConfig });
  });
  // Should mention agents count and preset in the output
  assert.ok(output.includes('Global SDD agents synced'), 'Should report sync count');
  assert.ok(output.includes('local-hybrid'), 'Should reference default preset');
  assert.ok(output.includes('sdd-debug-mono'), 'Should reference default debug preset');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

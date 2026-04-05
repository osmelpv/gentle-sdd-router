import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCustomSdd, scaffoldPhaseContract } from '../src/core/sdd-catalog-io.js';
import { getProjectSddAgentSpecs } from '../src/core/project-sdd-agent-routing.js';
import { materializeProjectSddAgents } from '../src/adapters/opencode/project-sdd-agent-materializer.js';
import { runSddCreate } from '../src/cli.js';
import { unifiedSync } from '../src/core/unified-sync.js';

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-project-sdd-'));
  const routerDir = path.join(root, 'router');
  fs.mkdirSync(path.join(routerDir, 'profiles'), { recursive: true });
  fs.mkdirSync(path.join(routerDir, 'catalogs'), { recursive: true });
  fs.writeFileSync(path.join(routerDir, 'router.yaml'), [
    'version: 4',
    'active_catalog: default',
    'active_preset: local-hybrid',
    'activation_state: active',
  ].join('\n'));
  return { root, routerDir, catalogsDir: path.join(routerDir, 'catalogs'), configPath: path.join(routerDir, 'router.yaml'), targetPath: path.join(root, 'opencode.json') };
}

test('getProjectSddAgentSpecs derives hidden sdd-<catalog>-<phase> agents from project SDDs', () => {
  const { root, catalogsDir, configPath } = makeProject();
  try {
    createCustomSdd(catalogsDir, 'game-design', 'Game design workflow');
    const sddYaml = path.join(catalogsDir, 'game-design', 'sdd.yaml');
    fs.writeFileSync(sddYaml, [
      'name: game-design',
      'version: 1',
      'description: test',
      'phases:',
      '  concept:',
      '    intent: Define the concept',
      '  level-design:',
      '    intent: Design the level',
    ].join('\n'));
    scaffoldPhaseContract(catalogsDir, 'game-design', 'concept', { intent: 'Define the concept' });
    scaffoldPhaseContract(catalogsDir, 'game-design', 'level-design', { intent: 'Design the level' });

    const specs = getProjectSddAgentSpecs(configPath, { cwd: root });
    const byName = new Map(specs.map((s) => [s.name, s]));

    assert.ok(byName.has('sdd-game-design-concept'));
    assert.ok(byName.has('sdd-game-design-level-design'));
    assert.equal(byName.get('sdd-game-design-concept').hidden, true);
    assert.match(byName.get('sdd-game-design-concept').prompt, /game-design/);
    assert.match(byName.get('sdd-game-design-concept').prompt, /contracts\/phases\/concept\.md/);
    assert.equal(byName.get('sdd-game-design-concept').target, 'anthropic/claude-sonnet-4-6');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runSddCreate auto-materializes project-local sdd-* agents without manual sync', () => {
  const { root, catalogsDir, targetPath } = makeProject();
  try {
    runSddCreate(['game-design'], catalogsDir);
    const written = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    assert.ok(written.agent['sdd-game-design-main']);
    assert.equal(written.agent['sdd-game-design-main']._gsr_generated, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unifiedSync reconciles project-local sdd-* agents when YAML was edited manually', async () => {
  const { root, catalogsDir, configPath, targetPath } = makeProject();
  try {
    createCustomSdd(catalogsDir, 'game-design', 'Game design workflow');
    const sddYaml = path.join(catalogsDir, 'game-design', 'sdd.yaml');
    fs.writeFileSync(sddYaml, [
      'name: game-design',
      'version: 1',
      'description: test',
      'phases:',
      '  concept:',
      '    intent: Define the concept',
    ].join('\n'));
    scaffoldPhaseContract(catalogsDir, 'game-design', 'concept', { intent: 'Define the concept' });

    const result = await unifiedSync({ configPath, targetPath, cwd: root });
    const written = JSON.parse(fs.readFileSync(targetPath, 'utf8'));

    assert.equal(result.status === 'ok' || result.status === 'partial', true);
    assert.ok(written.agent['sdd-game-design-concept']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('materializeProjectSddAgents preserves unrelated project agents', () => {
  const { root, catalogsDir, configPath, targetPath } = makeProject();
  try {
    createCustomSdd(catalogsDir, 'game-design', 'Game design workflow');
    fs.writeFileSync(targetPath, JSON.stringify({ agent: { unrelated: { mode: 'primary', model: 'openai/gpt-4.1' } } }, null, 2));

    const result = materializeProjectSddAgents(configPath, { targetPath, cwd: root });
    const written = JSON.parse(fs.readFileSync(targetPath, 'utf8'));

    assert.ok(result.count >= 1);
    assert.equal(written.agent.unrelated.model, 'openai/gpt-4.1');
    assert.ok(written.agent['sdd-game-design-main']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

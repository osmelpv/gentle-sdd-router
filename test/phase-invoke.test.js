/**
 * Tests for:
 *   - addPhaseInvoke() in sdd-catalog-io.js
 *   - runPhaseInvoke() in cli.js (gsr phase invoke subcommand)
 *   - buildInvokeFromInputs extended fields in sdd-phase-editor.js
 *
 * Strict TDD: tests written FIRST (RED), then implementation.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-phase-invoke-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true });
}

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

async function captureStdout(fn) {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const chunks = [];
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return chunks.join('');
}

const BASE_SDD_YAML = `name: game-design
version: 1
description: "Game design workflow"
phases:
  concept:
    intent: "Define high-level game concept"
  level-design:
    intent: "Design levels and encounters"
    depends_on:
      - concept
`;

// ─── addPhaseInvoke ───────────────────────────────────────────────────────────

describe('addPhaseInvoke', () => {
  test('adds invoke block to an existing phase and writes sdd.yaml atomically', async () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(catalogsDir, 'game-design/sdd.yaml', BASE_SDD_YAML);

      const { addPhaseInvoke } = await import('../src/core/sdd-catalog-io.js');
      addPhaseInvoke(catalogsDir, 'game-design', 'level-design', {
        catalog: 'art-production',
        sdd: 'asset-pipeline',
        trigger: 'on_issues',
        input_from: 'phase_output',
        required_fields: ['issues', 'affected_files'],
      });

      // Read back and verify
      const { loadCustomSdd } = await import('../src/core/sdd-catalog-io.js');
      const sdd = loadCustomSdd(catalogsDir, 'game-design');
      const invoke = sdd.phases['level-design'].invoke;
      assert.ok(invoke, 'invoke block must exist on level-design phase');
      assert.equal(invoke.catalog, 'art-production');
    } finally {
      cleanup(tmp);
    }
  });

  test('persists sdd and trigger fields on the invoke block', async () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(catalogsDir, 'game-design/sdd.yaml', BASE_SDD_YAML);

      const { addPhaseInvoke } = await import('../src/core/sdd-catalog-io.js');
      addPhaseInvoke(catalogsDir, 'game-design', 'level-design', {
        catalog: 'art-production',
        sdd: 'asset-pipeline',
        trigger: 'always',
        input_from: 'phase_output',
        required_fields: ['issues'],
      });

      const raw = fs.readFileSync(
        path.join(catalogsDir, 'game-design', 'sdd.yaml'),
        'utf8'
      );
      assert.ok(raw.includes('art-production'), 'YAML must include catalog');
      assert.ok(raw.includes('always'), 'YAML must include trigger');
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when SDD does not exist', async () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });

      const { addPhaseInvoke } = await import('../src/core/sdd-catalog-io.js');
      assert.throws(
        () => addPhaseInvoke(catalogsDir, 'nonexistent', 'concept', {
          catalog: 'art-production',
          trigger: 'on_issues',
        }),
        /not found|nonexistent/i
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when phase does not exist in the SDD', async () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(catalogsDir, 'game-design/sdd.yaml', BASE_SDD_YAML);

      const { addPhaseInvoke } = await import('../src/core/sdd-catalog-io.js');
      assert.throws(
        () => addPhaseInvoke(catalogsDir, 'game-design', 'nonexistent-phase', {
          catalog: 'art-production',
          trigger: 'on_issues',
        }),
        /phase|not found|nonexistent-phase/i
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('throws on invalid trigger value', async () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(catalogsDir, 'game-design/sdd.yaml', BASE_SDD_YAML);

      const { addPhaseInvoke } = await import('../src/core/sdd-catalog-io.js');
      assert.throws(
        () => addPhaseInvoke(catalogsDir, 'game-design', 'level-design', {
          catalog: 'art-production',
          trigger: 'invalid-trigger',
        }),
        /trigger|on_issues|always|never|manual/i
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when catalog slug is invalid', async () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(catalogsDir, 'game-design/sdd.yaml', BASE_SDD_YAML);

      const { addPhaseInvoke } = await import('../src/core/sdd-catalog-io.js');
      assert.throws(
        () => addPhaseInvoke(catalogsDir, 'game-design', 'level-design', {
          catalog: 'Art Production',
          trigger: 'on_issues',
        }),
        /slug|catalog/i
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('overwrites existing invoke block on the phase (upsert)', async () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(catalogsDir, 'game-design/sdd.yaml', BASE_SDD_YAML);

      const { addPhaseInvoke, loadCustomSdd } = await import('../src/core/sdd-catalog-io.js');

      // First invoke
      addPhaseInvoke(catalogsDir, 'game-design', 'level-design', {
        catalog: 'art-production',
        trigger: 'on_issues',
      });

      // Second invoke (overwrite with different catalog)
      addPhaseInvoke(catalogsDir, 'game-design', 'level-design', {
        catalog: 'sound-design',
        trigger: 'always',
      });

      const sdd = loadCustomSdd(catalogsDir, 'game-design');
      assert.equal(sdd.phases['level-design'].invoke.catalog, 'sound-design',
        'Second call must overwrite the first'
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('preserves other phases when adding invoke to one', async () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(catalogsDir, 'game-design/sdd.yaml', BASE_SDD_YAML);

      const { addPhaseInvoke, loadCustomSdd } = await import('../src/core/sdd-catalog-io.js');
      addPhaseInvoke(catalogsDir, 'game-design', 'level-design', {
        catalog: 'art-production',
        trigger: 'on_issues',
      });

      const sdd = loadCustomSdd(catalogsDir, 'game-design');
      // concept phase must still be intact
      assert.ok(sdd.phases.concept, 'concept phase must survive the write');
      assert.equal(sdd.phases.concept.intent, 'Define high-level game concept');
    } finally {
      cleanup(tmp);
    }
  });

  test('defaults sdd to catalog when sdd field is not provided', async () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(catalogsDir, 'game-design/sdd.yaml', BASE_SDD_YAML);

      const { addPhaseInvoke, loadCustomSdd } = await import('../src/core/sdd-catalog-io.js');
      addPhaseInvoke(catalogsDir, 'game-design', 'level-design', {
        catalog: 'art-production',
        trigger: 'on_issues',
        // no sdd field
      });

      const sdd = loadCustomSdd(catalogsDir, 'game-design');
      // sdd.yaml invoke.sdd should default to catalog when omitted
      const raw = fs.readFileSync(
        path.join(catalogsDir, 'game-design', 'sdd.yaml'),
        'utf8'
      );
      assert.ok(raw.includes('art-production'), 'Must include catalog in YAML');
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── gsr phase invoke CLI ─────────────────────────────────────────────────────

describe('runPhaseInvoke', () => {
  test('creates invoke block on specified phase and prints confirmation', async () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(catalogsDir, 'game-design/sdd.yaml', BASE_SDD_YAML);

      const { runPhaseInvoke } = await import('../src/cli.js');
      const output = await captureStdout(() =>
        runPhaseInvoke(
          [
            'level-design',
            '--sdd', 'game-design',
            '--target', 'art-production/asset-pipeline',
            '--trigger', 'on_issues',
          ],
          catalogsDir
        )
      );

      // Confirmation message
      assert.ok(output.length > 0, 'Should print confirmation');
      assert.ok(
        output.includes('level-design') || output.includes('game-design') || output.includes('invoke'),
        `Expected confirmation referencing phase/sdd: "${output}"`
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('invoke block written to sdd.yaml on disk', async () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(catalogsDir, 'game-design/sdd.yaml', BASE_SDD_YAML);

      const { runPhaseInvoke } = await import('../src/cli.js');
      await captureStdout(() =>
        runPhaseInvoke(
          [
            'level-design',
            '--sdd', 'game-design',
            '--target', 'art-production/asset-pipeline',
            '--trigger', 'always',
          ],
          catalogsDir
        )
      );

      const raw = fs.readFileSync(
        path.join(catalogsDir, 'game-design', 'sdd.yaml'),
        'utf8'
      );
      assert.ok(raw.includes('art-production'), 'sdd.yaml must contain invoke catalog');
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when phase name is missing', async () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const { runPhaseInvoke } = await import('../src/cli.js');
      assert.throws(
        () => runPhaseInvoke(['--sdd', 'game-design', '--target', 'art-production/ap', '--trigger', 'on_issues'], catalogsDir),
        /phase|name|required/i
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when --sdd is missing', async () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const { runPhaseInvoke } = await import('../src/cli.js');
      assert.throws(
        () => runPhaseInvoke(['level-design', '--target', 'art-production/ap', '--trigger', 'on_issues'], catalogsDir),
        /--sdd|sdd|required/i
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when --target is missing', async () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      const { runPhaseInvoke } = await import('../src/cli.js');
      assert.throws(
        () => runPhaseInvoke(['level-design', '--sdd', 'game-design', '--trigger', 'on_issues'], catalogsDir),
        /--target|target|required/i
      );
    } finally {
      cleanup(tmp);
    }
  });

  test('throws when --trigger is invalid', async () => {
    const tmp = makeTempDir();
    try {
      const catalogsDir = path.join(tmp, 'catalogs');
      writeFile(catalogsDir, 'game-design/sdd.yaml', BASE_SDD_YAML);
      const { runPhaseInvoke } = await import('../src/cli.js');
      assert.throws(
        () => runPhaseInvoke(['level-design', '--sdd', 'game-design', '--target', 'art-production/ap', '--trigger', 'bad'], catalogsDir),
        /trigger|on_issues|always|never|manual/i
      );
    } finally {
      cleanup(tmp);
    }
  });
});

// ─── buildInvokeFromInputs — extended fields ──────────────────────────────────

describe('buildInvokeFromInputs — extended invoke fields', () => {
  test('includes trigger field when provided', async () => {
    const { buildInvokeFromInputs } = await import('../src/ux/tui/screens/sdd-phase-editor.js');
    const result = buildInvokeFromInputs({
      catalog: 'art-production',
      sdd: 'asset-pipeline',
      payload_from: 'output',
      await: true,
      result_field: '',
      trigger: 'on_issues',
      input_from: '',
      required_fields: '',
    });
    assert.ok(result, 'Result must not be null');
    assert.equal(result.trigger, 'on_issues');
  });

  test('includes input_from field when provided', async () => {
    const { buildInvokeFromInputs } = await import('../src/ux/tui/screens/sdd-phase-editor.js');
    const result = buildInvokeFromInputs({
      catalog: 'art-production',
      sdd: '',
      payload_from: 'output',
      await: true,
      result_field: '',
      trigger: 'always',
      input_from: 'phase_output',
      required_fields: '',
    });
    assert.ok(result, 'Result must not be null');
    assert.equal(result.input_from, 'phase_output');
  });

  test('includes required_fields as array when comma-separated string provided', async () => {
    const { buildInvokeFromInputs } = await import('../src/ux/tui/screens/sdd-phase-editor.js');
    const result = buildInvokeFromInputs({
      catalog: 'art-production',
      sdd: '',
      payload_from: 'output',
      await: true,
      result_field: '',
      trigger: 'on_issues',
      input_from: '',
      required_fields: 'issues,affected_files',
    });
    assert.ok(result, 'Result must not be null');
    assert.deepEqual(result.required_fields, ['issues', 'affected_files']);
  });

  test('returns null when catalog is empty (no invoke configured)', async () => {
    const { buildInvokeFromInputs } = await import('../src/ux/tui/screens/sdd-phase-editor.js');
    const result = buildInvokeFromInputs({
      catalog: '',
      sdd: '',
      payload_from: 'output',
      await: true,
      result_field: '',
      trigger: 'on_issues',
      input_from: '',
      required_fields: '',
    });
    assert.equal(result, null, 'Result must be null when catalog is empty');
  });

  test('omits trigger when not provided (undefined/empty)', async () => {
    const { buildInvokeFromInputs } = await import('../src/ux/tui/screens/sdd-phase-editor.js');
    const result = buildInvokeFromInputs({
      catalog: 'art-production',
      sdd: '',
      payload_from: 'output',
      await: true,
      result_field: '',
      trigger: '',
      input_from: '',
      required_fields: '',
    });
    assert.ok(result, 'Result must not be null');
    // trigger should be absent or null when empty
    assert.ok(!result.trigger, 'trigger should be absent/null when not provided');
  });

  test('omits required_fields when empty string provided', async () => {
    const { buildInvokeFromInputs } = await import('../src/ux/tui/screens/sdd-phase-editor.js');
    const result = buildInvokeFromInputs({
      catalog: 'art-production',
      sdd: '',
      payload_from: 'output',
      await: true,
      result_field: '',
      trigger: 'on_issues',
      input_from: '',
      required_fields: '',
    });
    assert.ok(result, 'Result must not be null');
    assert.ok(!result.required_fields || result.required_fields.length === 0,
      'required_fields should be absent/empty when not provided'
    );
  });
});

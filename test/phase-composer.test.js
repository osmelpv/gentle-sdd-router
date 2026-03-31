import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CANONICAL_PHASES, PHASE_METADATA } from '../src/core/phases.js';

describe('PhaseComposer requirements', () => {
  test('PHASE_METADATA marks tasks/apply/archive as alwaysMono', () => {
    assert.equal(PHASE_METADATA.tasks.alwaysMono, true);
    assert.equal(PHASE_METADATA.apply.alwaysMono, true);
    assert.equal(PHASE_METADATA.archive.alwaysMono, true);
  });

  test('PHASE_METADATA marks explore/spec/design/verify as NOT alwaysMono', () => {
    assert.equal(PHASE_METADATA.explore.alwaysMono, false);
    assert.equal(PHASE_METADATA.spec.alwaysMono, false);
    assert.equal(PHASE_METADATA.design.alwaysMono, false);
    assert.equal(PHASE_METADATA.verify.alwaysMono, false);
  });

  test('all phases have fixedRoles and optionalRoles', () => {
    for (const phase of CANONICAL_PHASES) {
      const meta = PHASE_METADATA[phase];
      assert.ok(Array.isArray(meta.fixedRoles), `${phase} should have fixedRoles array`);
      assert.ok(Array.isArray(meta.optionalRoles), `${phase} should have optionalRoles array`);
    }
  });

  test('alwaysMono phases have no optionalRoles', () => {
    for (const phase of CANONICAL_PHASES) {
      const meta = PHASE_METADATA[phase];
      if (meta.alwaysMono) {
        assert.equal(meta.optionalRoles.length, 0, `${phase} is alwaysMono and should have no optionalRoles`);
      }
    }
  });

  test('debug phase has on-failure trigger', () => {
    assert.equal(PHASE_METADATA.debug.trigger, 'on-failure');
    assert.equal(PHASE_METADATA.debug.depends_on, 'verify');
  });
});

describe('PhaseComposer component', () => {
  test('component imports without error', async () => {
    const mod = await import('../src/ux/tui/components/phase-composer.js');
    assert.equal(typeof mod.PhaseComposer, 'function');
  });
});

describe('SplitPanelPicker alwaysMono guard', () => {
  test('component imports without error', async () => {
    const mod = await import('../src/ux/tui/components/split-panel-picker.js');
    assert.equal(typeof mod.SplitPanelPicker, 'function');
  });
});

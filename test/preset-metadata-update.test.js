import assert from 'node:assert/strict';
import { test } from 'node:test';

import { setPresetMetadata } from '../src/core/router.js';

test('setPresetMetadata updates hidden on plain v3 config', () => {
  const config = {
    version: 3,
    active_catalog: 'default',
    active_preset: 'multivendor',
    active_profile: 'multivendor',
    activation_state: 'active',
    metadata: {},
    sdds: {},
    catalogs: {
      default: {
        enabled: true,
        sdd: 'agent-orchestrator',
        presets: {
          'sdd-debug-mono': {
            hidden: true,
            phases: {},
          },
        },
      },
    },
  };

  const nextConfig = setPresetMetadata(config, 'sdd-debug-mono', { hidden: false });

  assert.equal(nextConfig.catalogs.default.presets['sdd-debug-mono'].hidden, false);
  assert.equal(config.catalogs.default.presets['sdd-debug-mono'].hidden, true);
});

test('setPresetMetadata preserves _v4Source descriptor when present', () => {
  const config = {
    version: 3,
    active_catalog: 'default',
    active_preset: 'multivendor',
    active_profile: 'multivendor',
    activation_state: 'active',
    metadata: {},
    sdds: {},
    catalogs: {
      default: {
        enabled: true,
        sdd: 'agent-orchestrator',
        presets: {
          'sdd-debug-mono': {
            hidden: true,
            phases: {},
          },
        },
      },
    },
  };

  Object.defineProperty(config, '_v4Source', {
    value: { routerDir: '/tmp/router', coreConfig: { active_preset: 'multivendor' } },
    enumerable: false,
    configurable: true,
    writable: true,
  });

  const nextConfig = setPresetMetadata(config, 'sdd-debug-mono', { hidden: false });
  const descriptor = Object.getOwnPropertyDescriptor(nextConfig, '_v4Source');

  assert.ok(descriptor);
  assert.equal(descriptor.enumerable, false);
  assert.equal(nextConfig._v4Source.routerDir, '/tmp/router');
  assert.equal(nextConfig.catalogs.default.presets['sdd-debug-mono'].hidden, false);
});

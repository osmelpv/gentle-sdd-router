import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';

describe('TUI preset visibility flow', () => {
  test('presets list does not update parent state during render', () => {
    const sourcePath = new URL('../src/ux/tui/screens/profiles-list.js', import.meta.url).pathname;
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.equal(
      source.includes('useState(() => {'),
      false,
      'profiles-list.js should use effects, not useState initializers, for render-adjacent updates'
    );
  });

  test('presets list reloads config after toggling visibility', () => {
    const sourcePath = new URL('../src/ux/tui/screens/profiles-list.js', import.meta.url).pathname;
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.ok(
      source.includes('mod.loadRouterConfig(configPath)'),
      'profiles-list.js must reload the exact current configPath after toggling visibility'
    );
  });

  test('profile detail uses router-config module consistently', () => {
    const sourcePath = new URL('../src/ux/tui/screens/profile-detail.js', import.meta.url).pathname;
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.equal(
      source.includes('router-localConfig.js'),
      false,
      'profile-detail.js must not reference the non-existent router-localConfig.js module'
    );
    assert.ok(
      source.includes('router-config.js'),
      'profile-detail.js should use router-config.js for config operations'
    );
  });
});

/**
 * Tests for TUI feedback simplification (gsr-feedback-simplification)
 *
 * Since there is no Ink test renderer (no teatest, no @testing-library/react),
 * tests verify:
 *   1. HomeScreen menu description references simple vocabulary
 *   2. HOME_MENU_ITEMS status entry uses simplified text
 *   3. StatusScreen exports a function component
 *   4. getStatusIndicator utility exported from home.js provides level → label
 *
 * Degrades gracefully to unit tests (no rendering needed).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

// ── HomeScreen — status indicator in menu ────────────────────────────────

describe('HomeScreen — menu items use simplified vocabulary', () => {
  test('HOME_MENU_ITEMS exports an array', async () => {
    const mod = await import('../src/ux/tui/screens/home.js');
    assert.ok(Array.isArray(mod.HOME_MENU_ITEMS), 'HOME_MENU_ITEMS should be an array');
  });

  test('Status menu item description does NOT contain "overlay" term', async () => {
    const { HOME_MENU_ITEMS } = await import('../src/ux/tui/screens/home.js');
    const statusItem = HOME_MENU_ITEMS.find(i => i.value === 'status');
    assert.ok(statusItem, 'Should have a Status menu item');
    assert.ok(
      !statusItem.description.toLowerCase().includes('overlay'),
      `Status description should not contain "overlay". Got: "${statusItem.description}"`
    );
  });

  test('Status menu item description uses simple vocabulary', async () => {
    const { HOME_MENU_ITEMS } = await import('../src/ux/tui/screens/home.js');
    const statusItem = HOME_MENU_ITEMS.find(i => i.value === 'status');
    assert.ok(statusItem, 'Should have a Status menu item');
    const lower = statusItem.description.toLowerCase();
    // Should mention router state in simple terms
    const hasSimpleVocab = (
      lower.includes('status') ||
      lower.includes('preset') ||
      lower.includes('routing') ||
      lower.includes('active') ||
      lower.includes('current')
    );
    assert.ok(hasSimpleVocab,
      `Status description should use simple vocab. Got: "${statusItem.description}"`
    );
  });
});

// ── HomeScreen — getStatusIndicator utility ───────────────────────────────

describe('HomeScreen — getStatusIndicator', () => {
  test('getStatusIndicator is exported from home.js', async () => {
    const mod = await import('../src/ux/tui/screens/home.js');
    assert.equal(
      typeof mod.getStatusIndicator,
      'function',
      'getStatusIndicator should be exported as a function'
    );
  });

  test('getStatusIndicator returns emoji+label for "configured" level', async () => {
    const { getStatusIndicator } = await import('../src/ux/tui/screens/home.js');
    const result = getStatusIndicator('configured');
    assert.ok(typeof result === 'string', 'should return a string');
    assert.ok(result.length > 0, 'should not be empty');
  });

  test('getStatusIndicator returns emoji+label for "synchronized" level', async () => {
    const { getStatusIndicator } = await import('../src/ux/tui/screens/home.js');
    const result = getStatusIndicator('synchronized');
    assert.ok(typeof result === 'string', 'should return a string');
    assert.ok(result.includes('🔄'), `should include 🔄 emoji. Got: "${result}"`);
  });

  test('getStatusIndicator returns emoji+label for "requires_reopen" level', async () => {
    const { getStatusIndicator } = await import('../src/ux/tui/screens/home.js');
    const result = getStatusIndicator('requires_reopen');
    assert.ok(typeof result === 'string', 'should return a string');
    assert.ok(result.includes('⚠️'), `should include ⚠️ emoji. Got: "${result}"`);
  });

  test('getStatusIndicator returns something for unknown level (fallback)', async () => {
    const { getStatusIndicator } = await import('../src/ux/tui/screens/home.js');
    const result = getStatusIndicator('unknown-level');
    assert.ok(typeof result === 'string', 'should always return a string');
    assert.ok(result.length > 0, 'should not be empty');
  });
});

// ── StatusScreen — component export ────────────────────────────────────

describe('StatusScreen — component export', () => {
  test('StatusScreen exports a function component', async () => {
    const mod = await import('../src/ux/tui/screens/status.js');
    assert.equal(typeof mod.StatusScreen, 'function', 'StatusScreen should be a function');
  });
});

// ── HomeScreen — Update menu item ─────────────────────────────────────────

describe('HomeScreen — Update menu item', () => {
  test('HOME_MENU_ITEMS contains an Update entry with value "update"', async () => {
    const { HOME_MENU_ITEMS } = await import('../src/ux/tui/screens/home.js');
    const updateItem = HOME_MENU_ITEMS.find(i => i.value === 'update');
    assert.ok(updateItem, 'Should have an Update menu item with value "update"');
    assert.equal(updateItem.label, 'Update', 'Update item label should be "Update"');
  });

  test('Update item appears before Exit item', async () => {
    const { HOME_MENU_ITEMS } = await import('../src/ux/tui/screens/home.js');
    const updateIdx = HOME_MENU_ITEMS.findIndex(i => i.value === 'update');
    const exitIdx = HOME_MENU_ITEMS.findIndex(i => i.value === 'exit');
    assert.ok(updateIdx !== -1, 'Update item should exist');
    assert.ok(exitIdx !== -1, 'Exit item should exist');
    assert.ok(updateIdx < exitIdx, `Update (${updateIdx}) should come before Exit (${exitIdx})`);
  });

  test('Update item description mentions migrations or updates', async () => {
    const { HOME_MENU_ITEMS } = await import('../src/ux/tui/screens/home.js');
    const updateItem = HOME_MENU_ITEMS.find(i => i.value === 'update');
    assert.ok(updateItem, 'Should have an Update menu item');
    const lower = updateItem.description.toLowerCase();
    assert.ok(
      lower.includes('migration') || lower.includes('update'),
      `Update description should mention migrations or updates. Got: "${updateItem.description}"`
    );
  });
});

// ── Home screen description update ────────────────────────────────────────

describe('HomeScreen — Status item description is user-friendly', () => {
  test('Status description does not mention raw "resolved routes" term', async () => {
    const { HOME_MENU_ITEMS } = await import('../src/ux/tui/screens/home.js');
    const statusItem = HOME_MENU_ITEMS.find(i => i.value === 'status');
    assert.ok(statusItem, 'Should have a Status menu item');
    assert.ok(
      !statusItem.description.toLowerCase().includes('resolved route'),
      `Status description should not mention "resolved routes". Got: "${statusItem.description}"`
    );
  });

  test('Status description does not mention pricing internals', async () => {
    const { HOME_MENU_ITEMS } = await import('../src/ux/tui/screens/home.js');
    const statusItem = HOME_MENU_ITEMS.find(i => i.value === 'status');
    assert.ok(statusItem, 'Should have a Status menu item');
    const lower = statusItem.description.toLowerCase();
    assert.ok(
      !lower.includes('context window') && !lower.includes('inputpermillion'),
      `Status description should not mention pricing internals. Got: "${statusItem.description}"`
    );
  });
});

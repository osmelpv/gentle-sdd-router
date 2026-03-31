import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fetchAllModels, clearModelCache } from '../src/ux/tui/model-fetcher.js';

describe('model-fetcher', () => {
  test('fetchAllModels returns providers object', async () => {
    clearModelCache();
    const result = await fetchAllModels();
    assert.ok(result.providers, 'Should have providers');
    assert.ok(result.sources, 'Should have sources array');
    assert.ok(Array.isArray(result.sources), 'sources should be array');
    // Should have at least offline fallback
    const totalModels = Object.values(result.providers).reduce((sum, g) => sum + g.models.length, 0);
    assert.ok(totalModels > 0, 'Should have at least some models');
  });

  test('fetchAllModels caches results', async () => {
    const first = await fetchAllModels();
    const second = await fetchAllModels();
    assert.equal(second.fromCache, true, 'Second call should be from cache');
  });

  test('clearModelCache resets cache', async () => {
    await fetchAllModels(); // populate cache
    clearModelCache();
    const result = await fetchAllModels();
    assert.equal(result.fromCache, false, 'After clear, should not be from cache');
  });

  test('models have required fields', async () => {
    const result = await fetchAllModels();
    for (const [provider, group] of Object.entries(result.providers)) {
      for (const model of group.models.slice(0, 3)) { // check first 3 per provider
        assert.ok(model.id, `${provider} model should have id`);
        assert.ok(model.name, `${provider} model should have name`);
        assert.ok(typeof model.contextWindow === 'number', `${provider}/${model.id} should have numeric contextWindow`);
        assert.ok(typeof model.costIn === 'number', `${provider}/${model.id} should have numeric costIn`);
        assert.ok(typeof model.costOut === 'number', `${provider}/${model.id} should have numeric costOut`);
        assert.ok(model.capabilities, `${provider}/${model.id} should have capabilities`);
      }
    }
  });
});

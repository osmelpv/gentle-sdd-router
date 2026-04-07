/**
 * Tests for src/core/watchdog-context.js
 *
 * Validates that buildHeartbeatInstructions and buildMonitorInstructions
 * generate the expected prompt strings.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildHeartbeatInstructions,
  buildMonitorInstructions,
} from '../src/core/watchdog-context.js';

// ── buildHeartbeatInstructions ────────────────────────────────────────────────

describe('buildHeartbeatInstructions', () => {
  const BASE_PARAMS = {
    taskId: 'sdd-apply-001',
    agentName: 'sdd-apply',
    model: 'anthropic/claude-sonnet',
    projectRoot: '/home/user/my-project',
  };

  it('returns a string', () => {
    const result = buildHeartbeatInstructions(BASE_PARAMS);
    assert.equal(typeof result, 'string');
  });

  it('includes the heartbeat file path with taskId', () => {
    const result = buildHeartbeatInstructions(BASE_PARAMS);
    assert.ok(
      result.includes('.gsr/watchdog/sdd-apply-001.json'),
      `Expected heartbeat path with taskId. Got:\n${result}`
    );
  });

  it('includes the taskId in the bash write command', () => {
    const result = buildHeartbeatInstructions(BASE_PARAMS);
    assert.ok(
      result.includes('"task_id":"sdd-apply-001"'),
      `Expected task_id in bash command. Got:\n${result}`
    );
  });

  it('includes a bash mkdir command for the watchdog dir', () => {
    const result = buildHeartbeatInstructions(BASE_PARAMS);
    assert.ok(
      result.includes('mkdir -p'),
      `Expected mkdir -p command. Got:\n${result}`
    );
    assert.ok(
      result.includes('.gsr/watchdog'),
      `Expected .gsr/watchdog in mkdir command. Got:\n${result}`
    );
  });

  it('includes the 90-second threshold warning', () => {
    const result = buildHeartbeatInstructions(BASE_PARAMS);
    assert.ok(
      result.includes('90 seconds') || result.includes('90'),
      `Expected 90-second threshold. Got:\n${result}`
    );
  });

  it('uses the provided projectRoot in the heartbeat path', () => {
    const result = buildHeartbeatInstructions({
      ...BASE_PARAMS,
      projectRoot: '/custom/root',
    });
    assert.ok(
      result.includes('/custom/root/.gsr/watchdog/sdd-apply-001.json'),
      `Expected custom root in path. Got:\n${result}`
    );
  });
});

// ── buildMonitorInstructions ──────────────────────────────────────────────────

describe('buildMonitorInstructions', () => {
  const BASE_PARAMS = {
    projectRoot: '/home/user/my-project',
    delegates: [
      { taskId: 'sdd-apply-001', model: 'anthropic/claude-opus', fallbacks: ['openai/gpt-4', 'google/gemini-pro'] },
      { taskId: 'sdd-verify-001', model: 'anthropic/claude-sonnet', fallbacks: ['openai/gpt-4o-mini'] },
    ],
  };

  it('returns a string', () => {
    const result = buildMonitorInstructions(BASE_PARAMS);
    assert.equal(typeof result, 'string');
  });

  it('lists all delegate task IDs', () => {
    const result = buildMonitorInstructions(BASE_PARAMS);
    assert.ok(
      result.includes('sdd-apply-001'),
      `Expected sdd-apply-001 in output. Got:\n${result}`
    );
    assert.ok(
      result.includes('sdd-verify-001'),
      `Expected sdd-verify-001 in output. Got:\n${result}`
    );
  });

  it('includes fallback model info for each delegate', () => {
    const result = buildMonitorInstructions(BASE_PARAMS);
    assert.ok(
      result.includes('openai/gpt-4'),
      `Expected fallback openai/gpt-4 in output. Got:\n${result}`
    );
    assert.ok(
      result.includes('openai/gpt-4o-mini'),
      `Expected fallback openai/gpt-4o-mini in output. Got:\n${result}`
    );
  });

  it('includes the 45-second grace period threshold', () => {
    const result = buildMonitorInstructions(BASE_PARAMS);
    assert.ok(
      result.includes('45 seconds') || result.includes('45'),
      `Expected 45-second grace period. Got:\n${result}`
    );
  });

  it('includes the 90-second timeout threshold', () => {
    const result = buildMonitorInstructions(BASE_PARAMS);
    assert.ok(
      result.includes('90 seconds') || result.includes('90'),
      `Expected 90-second timeout threshold. Got:\n${result}`
    );
  });

  it('includes the watchdog directory path', () => {
    const result = buildMonitorInstructions(BASE_PARAMS);
    assert.ok(
      result.includes('/home/user/my-project/.gsr/watchdog'),
      `Expected watchdog dir path. Got:\n${result}`
    );
  });

  it('handles empty delegates array gracefully', () => {
    const result = buildMonitorInstructions({ projectRoot: '/some/root', delegates: [] });
    assert.equal(typeof result, 'string');
    assert.ok(result.includes('.gsr/watchdog'), `Expected watchdog dir in output. Got:\n${result}`);
  });
});

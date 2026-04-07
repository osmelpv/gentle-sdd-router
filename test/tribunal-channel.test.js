/**
 * Unit tests for TribunalChannel and TribunalFileIO
 *
 * Spec reference: SPEC-TRIBUNAL-002
 * Strict TDD: tests written FIRST (RED phase), implementation follows.
 *
 * Test scenarios:
 *   S1  — Fresh tribunal: initialize creates metadata.json with correct structure
 *   S2  — Write + readAll: write 3 messages, readAll returns all 3
 *   S3  — readByRole: judge + minister messages → readByRole('minister') returns only ministers
 *   S4  — readAll(round): filter by round number
 *   S5  — writeDecision: creates final-decision.json + updates metadata status to 'decided'
 *   S6  — compress: creates compression.json with lessons/badIdeas/contextForNext
 *   S7  — cleanup: removes round files, keeps metadata/decision/compression
 *   S8  — Idempotent write: same message ID twice overwrites cleanly
 *   S9  — Message ID format: deterministic `{tribunalId}-r{round}-{sender}`
 *   S10 — detect(): returns 'files' when no .engram directory exists
 *   S11 — Empty readAll: returns [] when no messages exist
 *   S12 — Missing directory: readAll on non-existent dir returns [], not error
 *   S13 — from/to fields: messages include routing fields
 *   S14 — readFor(agentId): filters by 'to' field, includes broadcasts
 *   S15 — Heartbeat write/read/isAgentAlive via TribunalChannel
 *   S16 — buildJudgeContext: returns non-empty string with all params
 *   S17 — buildMinisterContext: returns string with channel dir and polling instructions
 *   S18 — buildRadarContext: returns string with investigation focus
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { TribunalChannel } from '../src/core/tribunal-channel.js';
import { TribunalFileIO, toWatchdogFormat } from '../src/core/tribunal-io.js';
import { buildJudgeContext, buildMinisterContext, buildRadarContext } from '../src/core/tribunal-context.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'gsr-tribunal-test-'));
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

function makeChannel(tmpDir, opts = {}) {
  return new TribunalChannel('tribunal-logic', 'apply', {
    useEngram: false,
    routerDir: tmpDir,
    ...opts,
  });
}

// ─── S1: initialize creates metadata.json ────────────────────────────────────

describe('TribunalChannel — S1: initialize', () => {
  let tmp;
  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { cleanup(tmp); });

  it('creates metadata.json with correct structure', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({
      judge: 'anthropic/claude-opus',
      ministers: ['anthropic/claude-sonnet', 'openai/gpt-4o'],
      radar: null,
    });

    const metaPath = join(tmp, '.tribunal', 'tribunal-logic', 'apply', 'metadata.json');
    assert.ok(existsSync(metaPath), 'metadata.json must exist');

    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    assert.equal(meta.sdd, 'tribunal-logic');
    assert.equal(meta.phase, 'apply');
    assert.equal(meta.status, 'open');
    assert.ok(typeof meta.tribunal_id === 'string' && meta.tribunal_id.length > 0);
    assert.ok(typeof meta.started_at === 'string');
    assert.equal(meta.decided_at, null);
    assert.equal(meta.rounds_run, 0);
    assert.deepEqual(meta.participants.ministers, ['anthropic/claude-sonnet', 'openai/gpt-4o']);
    assert.equal(meta.decision, null);
    assert.equal(meta.consensus, null);
    assert.equal(meta.escalated_to_user, false);
  });
});

// ─── S2: write + readAll returns all messages ────────────────────────────────

describe('TribunalChannel — S2: write + readAll', () => {
  let tmp;
  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { cleanup(tmp); });

  it('write 3 messages from different senders, readAll returns all 3', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b', 'model-c'], radar: null });

    await ch.write('minister-1', 'minister', 'response', { text: 'My take' }, 1);
    await ch.write('minister-2', 'minister', 'response', { text: 'Another take' }, 1);
    await ch.write('judge', 'judge', 'question', { text: 'What do you think?' }, 1);

    const all = await ch.readAll();
    assert.equal(all.length, 3);
  });

  it('each written message has the expected shape', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    const result = await ch.write('minister-1', 'minister', 'response', {
      text: 'Hello',
      position: 'agree',
      confidence: 0.9,
    }, 1, { model: 'anthropic/claude-sonnet' });

    assert.ok(typeof result.id === 'string');
    assert.equal(result.written, true);
  });
});

// ─── S3: readByRole returns only matching role ────────────────────────────────

describe('TribunalChannel — S3: readByRole', () => {
  let tmp;
  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { cleanup(tmp); });

  it('readByRole("minister") returns only minister messages', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b', 'model-c'], radar: null });

    await ch.write('judge', 'judge', 'question', { text: 'Q' }, 1);
    await ch.write('minister-1', 'minister', 'response', { text: 'R1' }, 1);
    await ch.write('minister-2', 'minister', 'response', { text: 'R2' }, 1);

    const ministers = await ch.readByRole('minister');
    assert.equal(ministers.length, 2);
    assert.ok(ministers.every(m => m.role === 'minister'));
  });

  it('readByRole("judge") returns only judge messages', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    await ch.write('judge', 'judge', 'synthesis', { text: 'Summary' }, 1);
    await ch.write('minister-1', 'minister', 'response', { text: 'R' }, 1);

    const judges = await ch.readByRole('judge');
    assert.equal(judges.length, 1);
    assert.equal(judges[0].role, 'judge');
    assert.equal(judges[0].sender, 'judge');
  });
});

// ─── S4: readAll(round) filters by round number ──────────────────────────────

describe('TribunalChannel — S4: readAll(round)', () => {
  let tmp;
  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { cleanup(tmp); });

  it('filters messages by round number', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    await ch.write('minister-1', 'minister', 'response', { text: 'Round 1' }, 1);
    await ch.write('judge', 'judge', 'question', { text: 'Round 1 question' }, 1);
    await ch.write('minister-1', 'minister', 'response', { text: 'Round 2' }, 2);

    const round1 = await ch.readAll(1);
    assert.equal(round1.length, 2);
    assert.ok(round1.every(m => m.round === 1));

    const round2 = await ch.readAll(2);
    assert.equal(round2.length, 1);
    assert.equal(round2[0].round, 2);
  });
});

// ─── S5: writeDecision creates final-decision.json and updates metadata ──────

describe('TribunalChannel — S5: writeDecision', () => {
  let tmp;
  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { cleanup(tmp); });

  it('creates final-decision.json and sets metadata.status to decided', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    await ch.writeDecision('Use hexagonal architecture');

    const baseDir = join(tmp, '.tribunal', 'tribunal-logic', 'apply');
    const decisionPath = join(baseDir, 'final-decision.json');
    assert.ok(existsSync(decisionPath), 'final-decision.json must exist');

    const decision = JSON.parse(readFileSync(decisionPath, 'utf8'));
    assert.equal(decision.decision, 'Use hexagonal architecture');

    const meta = JSON.parse(readFileSync(join(baseDir, 'metadata.json'), 'utf8'));
    assert.equal(meta.status, 'decided');
    assert.ok(typeof meta.decided_at === 'string');
  });
});

// ─── S6: compress creates compression.json ───────────────────────────────────

describe('TribunalChannel — S6: compress', () => {
  let tmp;
  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { cleanup(tmp); });

  it('creates compression.json with lessons, badIdeas, contextForNext', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });
    await ch.writeDecision('Use ports and adapters');

    await ch.compress(
      ['Lesson 1: TDD pays off', 'Lesson 2: Keep it small'],
      ['Bad idea: monolith'],
      'Next phase should focus on I/O'
    );

    const compressionPath = join(tmp, '.tribunal', 'tribunal-logic', 'apply', 'compression.json');
    assert.ok(existsSync(compressionPath), 'compression.json must exist');

    const comp = JSON.parse(readFileSync(compressionPath, 'utf8'));
    assert.deepEqual(comp.lessons_learned, ['Lesson 1: TDD pays off', 'Lesson 2: Keep it small']);
    assert.deepEqual(comp.bad_ideas, ['Bad idea: monolith']);
    assert.equal(comp.context_for_next_phase, 'Next phase should focus on I/O');
  });

  it('compress sets metadata.status to compressed', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });
    await ch.writeDecision('decision text');
    await ch.compress(['lesson'], [], 'context');

    const metaPath = join(tmp, '.tribunal', 'tribunal-logic', 'apply', 'metadata.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    assert.equal(meta.status, 'compressed');
  });
});

// ─── S7: cleanup removes round files, keeps metadata/decision/compression ────

describe('TribunalChannel — S7: cleanup', () => {
  let tmp;
  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { cleanup(tmp); });

  it('removes round-*.json files but keeps metadata, decision, compression', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });
    await ch.write('minister-1', 'minister', 'response', { text: 'R1' }, 1);
    await ch.write('judge', 'judge', 'question', { text: 'Q1' }, 1);
    await ch.writeDecision('final decision');
    await ch.compress(['lesson'], [], 'context');

    const baseDir = join(tmp, '.tribunal', 'tribunal-logic', 'apply');
    const beforeCleanup = readdirSync(baseDir);
    assert.ok(beforeCleanup.some(f => f.startsWith('round-')), 'round files must exist before cleanup');

    await ch.cleanup();

    const afterCleanup = readdirSync(baseDir);
    assert.ok(!afterCleanup.some(f => f.startsWith('round-')), 'round files must be removed');
    assert.ok(existsSync(join(baseDir, 'metadata.json')), 'metadata.json must be kept');
    assert.ok(existsSync(join(baseDir, 'final-decision.json')), 'final-decision.json must be kept');
    assert.ok(existsSync(join(baseDir, 'compression.json')), 'compression.json must be kept');
  });
});

// ─── S8: Idempotent write — same sender+round overwrites ─────────────────────

describe('TribunalChannel — S8: idempotent write', () => {
  let tmp;
  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { cleanup(tmp); });

  it('writing same sender/round twice overwrites cleanly (only 1 file)', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    await ch.write('minister-1', 'minister', 'response', { text: 'First' }, 1);
    await ch.write('minister-1', 'minister', 'response', { text: 'Updated' }, 1);

    const all = await ch.readAll();
    // Only ONE file for minister-1 round 1
    assert.equal(all.length, 1);
    assert.equal(all[0].content.text, 'Updated');
  });
});

// ─── S9: Message ID format is deterministic ───────────────────────────────────

describe('TribunalChannel — S9: message ID format', () => {
  let tmp;
  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { cleanup(tmp); });

  it('message ID follows {tribunalId}-r{round}-{sender} pattern', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    const result = await ch.write('minister-1', 'minister', 'response', { text: 'Hello' }, 1);

    // ID must end with -r1-minister-1
    assert.ok(
      result.id.endsWith('-r1-minister-1'),
      `Expected ID to end with "-r1-minister-1", got: "${result.id}"`
    );

    // ID must start with tribunalId
    assert.ok(
      result.id.startsWith(ch.tribunalId),
      `Expected ID to start with tribunalId "${ch.tribunalId}", got: "${result.id}"`
    );
  });

  it('different rounds produce different IDs for same sender', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    const r1 = await ch.write('minister-1', 'minister', 'response', { text: 'Round 1' }, 1);
    const r2 = await ch.write('minister-1', 'minister', 'response', { text: 'Round 2' }, 2);

    assert.notEqual(r1.id, r2.id);
    assert.ok(r1.id.includes('-r1-minister-1'));
    assert.ok(r2.id.includes('-r2-minister-1'));
  });
});

// ─── S10: detect() always returns 'files' ────────────────────────────────────
//
// Engram MCP tools are not available to delegated sub-agents.
// File-based I/O is the only viable communication layer.
// detect() always returns 'files' regardless of .engram dir presence.

describe('TribunalChannel — S10: detect()', () => {
  it('returns "files" when no .engram directory exists in temp dir', async () => {
    const tmp = makeTempDir();
    try {
      const result = TribunalChannel.detect(tmp);
      assert.equal(result, 'files');
    } finally {
      cleanup(tmp);
    }
  });

  it('returns "files" even when .engram directory exists — Engram MCP unavailable to sub-agents', async () => {
    const tmp = makeTempDir();
    try {
      mkdirSync(join(tmp, '.engram'), { recursive: true });
      const result = TribunalChannel.detect(tmp);
      // Always 'files' — Engram MCP tools are not available to delegated sub-agents
      assert.equal(result, 'files');
    } finally {
      cleanup(tmp);
    }
  });

  it('returns "files" with no arguments (default baseDir)', () => {
    const result = TribunalChannel.detect();
    assert.equal(result, 'files');
  });
});

// ─── S11: Empty readAll returns [] when no messages ──────────────────────────

describe('TribunalChannel — S11: empty readAll', () => {
  let tmp;
  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { cleanup(tmp); });

  it('returns [] when tribunal is initialized but no messages written', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    const all = await ch.readAll();
    assert.deepEqual(all, []);
  });

  it('readByRole returns [] when no messages of that role exist', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    await ch.write('judge', 'judge', 'question', { text: 'Q' }, 1);
    const radars = await ch.readByRole('radar');
    assert.deepEqual(radars, []);
  });
});

// ─── S12: Missing directory — readAll returns [], not error ──────────────────

describe('TribunalChannel — S12: missing directory', () => {
  let tmp;
  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { cleanup(tmp); });

  it('readAll returns [] when tribunal directory does not exist', async () => {
    // Do NOT initialize — directory never created
    const ch = makeChannel(tmp);
    const all = await ch.readAll();
    assert.deepEqual(all, []);
  });

  it('readByRole returns [] when tribunal directory does not exist', async () => {
    const ch = makeChannel(tmp);
    const result = await ch.readByRole('minister');
    assert.deepEqual(result, []);
  });
});

// ─── TribunalFileIO direct tests ─────────────────────────────────────────────

describe('TribunalFileIO — atomic write and read', () => {
  let tmp;
  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { cleanup(tmp); });

  it('writeMetadata and readMetadata round-trip', async () => {
    const io = new TribunalFileIO('test-sdd', 'explore', tmp);
    const meta = { tribunal_id: 'abc', status: 'open', rounds_run: 0 };
    await io.writeMetadata(meta);
    const read = await io.readMetadata();
    assert.deepEqual(read, meta);
  });

  it('readMetadata returns null when file does not exist', async () => {
    const io = new TribunalFileIO('test-sdd', 'explore', tmp);
    const result = await io.readMetadata();
    assert.equal(result, null);
  });

  it('updateMetadata merges fields without overwriting unrelated ones', async () => {
    const io = new TribunalFileIO('test-sdd', 'explore', tmp);
    await io.writeMetadata({ tribunal_id: 'abc', status: 'open', rounds_run: 0 });
    await io.updateMetadata({ status: 'decided', decided_at: '2026-04-07T00:00:00Z' });
    const meta = await io.readMetadata();
    assert.equal(meta.tribunal_id, 'abc');
    assert.equal(meta.status, 'decided');
    assert.equal(meta.decided_at, '2026-04-07T00:00:00Z');
    assert.equal(meta.rounds_run, 0);
  });

  it('writeMessage creates a round-{N}-{sender}.json file', async () => {
    const io = new TribunalFileIO('test-sdd', 'explore', tmp);
    await io.writeMetadata({ tribunal_id: 'abc', status: 'open', rounds_run: 0 });
    const msg = {
      id: 'abc-r1-minister-1',
      tribunal_id: 'abc',
      round: 1,
      sender: 'minister-1',
      role: 'minister',
      type: 'response',
      content: { text: 'Hello' },
    };
    await io.writeMessage(msg, 1);
    const filePath = join(tmp, '.tribunal', 'test-sdd', 'explore', 'round-1-minister-1.json');
    assert.ok(existsSync(filePath));
    const onDisk = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.equal(onDisk.id, 'abc-r1-minister-1');
  });

  it('readMessages returns all round files sorted', async () => {
    const io = new TribunalFileIO('test-sdd', 'explore', tmp);
    await io.writeMetadata({ tribunal_id: 'abc', status: 'open', rounds_run: 0 });
    await io.writeMessage({ id: 'id1', round: 1, sender: 'judge', role: 'judge', type: 'question', content: { text: 'Q' } }, 1);
    await io.writeMessage({ id: 'id2', round: 1, sender: 'minister-1', role: 'minister', type: 'response', content: { text: 'A' } }, 1);
    const msgs = await io.readMessages();
    assert.equal(msgs.length, 2);
  });

  it('cleanupRoundFiles removes round files only', async () => {
    const io = new TribunalFileIO('test-sdd', 'explore', tmp);
    await io.writeMetadata({ tribunal_id: 'abc', status: 'open', rounds_run: 0 });
    await io.writeMessage({ id: 'id1', round: 1, sender: 'judge', role: 'judge', type: 'question', content: { text: 'Q' } }, 1);
    await io.writeDecision('decision text');

    await io.cleanupRoundFiles();

    const baseDir = join(tmp, '.tribunal', 'test-sdd', 'explore');
    const files = readdirSync(baseDir);
    assert.ok(!files.some(f => f.startsWith('round-')));
    assert.ok(files.includes('metadata.json'));
    assert.ok(files.includes('final-decision.json'));
  });
});

// ─── getMetadata via TribunalChannel ─────────────────────────────────────────

describe('TribunalChannel — getMetadata', () => {
  let tmp;
  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { cleanup(tmp); });

  it('returns null before initialization', async () => {
    const ch = makeChannel(tmp);
    const meta = await ch.getMetadata();
    assert.equal(meta, null);
  });

  it('returns the correct metadata after initialization', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });
    const meta = await ch.getMetadata();
    assert.ok(meta !== null);
    assert.equal(meta.status, 'open');
    assert.equal(meta.sdd, 'tribunal-logic');
  });
});

// ─── S13: from/to fields in messages ─────────────────────────────────────────

describe('TribunalChannel — S13: from/to fields', () => {
  let tmp;
  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { cleanup(tmp); });

  it('written message includes from field equal to sender', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    await ch.write('minister-1', 'minister', 'response', { text: 'Hello' }, 1);

    const all = await ch.readAll();
    assert.equal(all.length, 1);
    assert.equal(all[0].from, 'minister-1');
  });

  it('written message defaults to to="all" when no options.to provided', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    await ch.write('judge', 'judge', 'question', { text: 'Q' }, 1);

    const all = await ch.readAll();
    assert.equal(all[0].to, 'all');
  });

  it('written message respects options.to when provided', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    await ch.write('judge', 'judge', 'question', { text: 'Directed' }, 1, { to: 'minister-1' });

    const all = await ch.readAll();
    assert.equal(all[0].to, 'minister-1');
    assert.equal(all[0].from, 'judge');
  });
});

// ─── S14: readFor(agentId) filtering ─────────────────────────────────────────

describe('TribunalChannel — S14: readFor', () => {
  let tmp;
  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { cleanup(tmp); });

  it('readFor returns messages with to=agentId AND to="all"', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b', 'model-c'], radar: null });

    // broadcast — should be visible to everyone
    await ch.write('judge', 'judge', 'question', { text: 'For all' }, 1, { to: 'all' });
    // directed to minister-1 only
    await ch.write('judge', 'judge', 'question', { text: 'For minister-1 only' }, 1, { to: 'minister-1' });
    // directed to minister-2 only
    await ch.write('judge', 'judge', 'question', { text: 'For minister-2 only' }, 1, { to: 'minister-2' });

    const forMinister1 = await ch.readFor('minister-1');
    assert.equal(forMinister1.length, 2, 'minister-1 should see broadcast + directed message');
    assert.ok(forMinister1.every(m => m.to === 'minister-1' || m.to === 'all'));

    const forMinister2 = await ch.readFor('minister-2');
    assert.equal(forMinister2.length, 2, 'minister-2 should see broadcast + directed message');
  });

  it('readFor returns [] when no matching messages exist', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    // Only a message directed to minister-1
    await ch.write('judge', 'judge', 'question', { text: 'Private' }, 1, { to: 'minister-1' });

    const forRadar = await ch.readFor('radar');
    assert.deepEqual(forRadar, []);
  });

  it('readFor accepts an optional round filter', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    await ch.write('judge', 'judge', 'question', { text: 'Round 1' }, 1, { to: 'minister-1' });
    await ch.write('judge', 'judge', 'question', { text: 'Round 2' }, 2, { to: 'minister-1' });

    const round1Only = await ch.readFor('minister-1', 1);
    assert.equal(round1Only.length, 1);
    assert.equal(round1Only[0].content.text, 'Round 1');
  });
});

// ─── S15: Heartbeat write/read/isAgentAlive ──────────────────────────────────

describe('TribunalChannel — S15: heartbeats', () => {
  let tmp;
  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { cleanup(tmp); });

  it('writeHeartbeat + readHeartbeats round-trip', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    await ch.writeHeartbeat('minister-1', 1, 'alive');
    await ch.writeHeartbeat('judge', 1, 'alive');

    const heartbeats = await ch.readHeartbeats();
    assert.equal(heartbeats.length, 2);
    const senders = heartbeats.map(h => h.sender).sort();
    assert.deepEqual(senders, ['judge', 'minister-1']);
  });

  it('isAgentAlive returns true for a fresh heartbeat', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    await ch.writeHeartbeat('minister-1', 1, 'alive');

    const alive = await ch.isAgentAlive('minister-1');
    assert.equal(alive, true);
  });

  it('isAgentAlive returns false when heartbeat status is "done"', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    await ch.writeHeartbeat('minister-1', 2, 'done');

    const alive = await ch.isAgentAlive('minister-1');
    assert.equal(alive, false);
  });

  it('isAgentAlive returns false when no heartbeat file exists', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    const alive = await ch.isAgentAlive('radar');
    assert.equal(alive, false);
  });

  it('readHeartbeats returns [] when tribunal dir does not exist', async () => {
    const ch = makeChannel(tmp);
    // Do NOT initialize — dir not created
    const hbs = await ch.readHeartbeats();
    assert.deepEqual(hbs, []);
  });
});

// ─── S19: checkAgentHealth ───────────────────────────────────────────────────

describe('TribunalChannel — S19: checkAgentHealth', () => {
  let tmp;
  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { cleanup(tmp); });

  it('returns alive:false, reason:no_heartbeat when no heartbeat file exists', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    const health = await ch.checkAgentHealth('minister-1');
    assert.equal(health.alive, false);
    assert.equal(health.reason, 'no_heartbeat');
    assert.equal(health.heartbeat, null);
    assert.equal(health.watchdogCompatible, null);
  });

  it('returns alive:false, reason:completed when heartbeat status is "done"', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    await ch.writeHeartbeat('minister-1', 2, 'done');

    const health = await ch.checkAgentHealth('minister-1');
    assert.equal(health.alive, false);
    assert.equal(health.reason, 'completed');
    assert.ok(health.heartbeat !== null);
    assert.equal(health.heartbeat.status, 'done');
    assert.ok(health.watchdogCompatible !== null);
  });

  it('returns alive:true, reason:healthy for a fresh alive heartbeat', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    await ch.writeHeartbeat('minister-1', 1, 'alive');

    const health = await ch.checkAgentHealth('minister-1');
    assert.equal(health.alive, true);
    assert.equal(health.reason, 'healthy');
    assert.ok(health.heartbeat !== null);
    assert.ok(health.watchdogCompatible !== null);
  });

  it('watchdogCompatible has ts (epoch ms) derived from heartbeat timestamp', async () => {
    const ch = makeChannel(tmp);
    await ch.initialize({ judge: 'model-a', ministers: ['model-b'], radar: null });

    await ch.writeHeartbeat('judge', 1, 'alive');

    const health = await ch.checkAgentHealth('judge');
    assert.ok(typeof health.watchdogCompatible.ts === 'number');
    assert.ok(health.watchdogCompatible.ts > 0);
    assert.equal(health.watchdogCompatible.task_id, 'judge');
    assert.equal(health.watchdogCompatible.status, 'running');
  });
});

// ─── S20: toWatchdogFormat ────────────────────────────────────────────────────

describe('toWatchdogFormat (tribunal-io)', () => {
  it('returns null for null input', () => {
    assert.equal(toWatchdogFormat(null), null);
  });

  it('returns null for undefined input', () => {
    assert.equal(toWatchdogFormat(undefined), null);
  });

  it('converts alive tribunal heartbeat to watchdog format', () => {
    const tribunalHb = {
      sender: 'minister-1',
      timestamp: '2026-04-07T12:00:00.000Z',
      round: 2,
      status: 'alive',
    };

    const result = toWatchdogFormat(tribunalHb);

    assert.equal(result.ts, new Date('2026-04-07T12:00:00.000Z').getTime());
    assert.equal(result.task_id, 'minister-1');
    assert.equal(result.status, 'running');
    assert.equal(result.round, 2);
    assert.equal(result.sender, 'minister-1');
  });

  it('converts done tribunal heartbeat — status becomes "completed"', () => {
    const tribunalHb = {
      sender: 'radar',
      timestamp: '2026-04-07T12:05:00.000Z',
      round: 3,
      status: 'done',
    };

    const result = toWatchdogFormat(tribunalHb);

    assert.equal(result.status, 'completed');
    assert.equal(result.task_id, 'radar');
    assert.equal(result.round, 3);
  });

  it('ts is a valid epoch millisecond number', () => {
    const now = new Date().toISOString();
    const result = toWatchdogFormat({ sender: 'judge', timestamp: now, round: 1, status: 'alive' });

    assert.ok(typeof result.ts === 'number');
    assert.ok(result.ts > 0);
    assert.ok(result.ts <= Date.now());
  });
});

// ─── S16: buildJudgeContext ───────────────────────────────────────────────────

describe('tribunal-context — S16: buildJudgeContext', () => {
  const BASE_PARAMS = {
    sddName: 'tribunal-logic',
    phaseName: 'apply',
    phaseGoal: 'Implement heartbeat tracking for tribunal agents',
    tribunalId: 'sdd/tribunal-logic/phases/apply/1712345678901',
    participants: {
      judge: 'anthropic/claude-opus',
      ministers: [
        { model: 'anthropic/claude-sonnet', name: 'minister-1' },
        { model: 'openai/gpt-4o', name: 'minister-2' },
      ],
      radar: { model: 'google/gemini-pro' },
    },
    maxRounds: 4,
    routerDir: '/home/user/project/router',
    profileName: 'myprofile',
  };

  it('returns a non-empty string', () => {
    const result = buildJudgeContext(BASE_PARAMS);
    assert.ok(typeof result === 'string' && result.length > 0);
  });

  it('includes sddName and phaseName', () => {
    const result = buildJudgeContext(BASE_PARAMS);
    assert.ok(result.includes('tribunal-logic'));
    assert.ok(result.includes('apply'));
  });

  it('includes tribunalId', () => {
    const result = buildJudgeContext(BASE_PARAMS);
    assert.ok(result.includes(BASE_PARAMS.tribunalId));
  });

  it('includes channel directory path', () => {
    const result = buildJudgeContext(BASE_PARAMS);
    assert.ok(result.includes('/home/user/project/router/.tribunal/tribunal-logic/apply/'));
  });

  it('includes minister agent names with models', () => {
    const result = buildJudgeContext(BASE_PARAMS);
    assert.ok(result.includes('gsr-myprofile-minister-1'));
    assert.ok(result.includes('gsr-myprofile-minister-2'));
    assert.ok(result.includes('anthropic/claude-sonnet'));
    assert.ok(result.includes('openai/gpt-4o'));
  });

  it('includes radar agent when participants.radar is set', () => {
    const result = buildJudgeContext(BASE_PARAMS);
    assert.ok(result.includes('gsr-myprofile-radar'));
    assert.ok(result.includes('google/gemini-pro'));
  });

  it('shows "not assigned" when radar is null', () => {
    const params = { ...BASE_PARAMS, participants: { ...BASE_PARAMS.participants, radar: null } };
    const result = buildJudgeContext(params);
    assert.ok(result.includes('not assigned'));
  });

  it('includes maxRounds', () => {
    const result = buildJudgeContext(BASE_PARAMS);
    assert.ok(result.includes('4'));
  });

  it('includes phaseGoal', () => {
    const result = buildJudgeContext(BASE_PARAMS);
    assert.ok(result.includes('Implement heartbeat tracking for tribunal agents'));
  });

  it('defaults maxRounds to 4 when not provided', () => {
    const { maxRounds: _mr, ...params } = BASE_PARAMS;
    const result = buildJudgeContext(params);
    assert.ok(result.includes('Max Rounds: 4'));
  });
});

// ─── S17: buildMinisterContext ────────────────────────────────────────────────

describe('tribunal-context — S17: buildMinisterContext', () => {
  const BASE_PARAMS = {
    ministerName: 'gsr-myprofile-minister-1',
    ministerModel: 'anthropic/claude-sonnet',
    sddName: 'tribunal-logic',
    phaseName: 'apply',
    phaseGoal: 'Evaluate the heartbeat implementation approach',
    tribunalId: 'sdd/tribunal-logic/phases/apply/1712345678901',
    channelDir: '/tmp/router/.tribunal/tribunal-logic/apply',
    round: 1,
  };

  it('returns a non-empty string', () => {
    const result = buildMinisterContext(BASE_PARAMS);
    assert.ok(typeof result === 'string' && result.length > 0);
  });

  it('includes the minister name', () => {
    const result = buildMinisterContext(BASE_PARAMS);
    assert.ok(result.includes('gsr-myprofile-minister-1'));
  });

  it('includes the channel directory path', () => {
    const result = buildMinisterContext(BASE_PARAMS);
    assert.ok(result.includes('/tmp/router/.tribunal/tribunal-logic/apply'));
  });

  it('includes polling instructions (sleep)', () => {
    const result = buildMinisterContext(BASE_PARAMS);
    assert.ok(result.includes('sleep 3') || result.includes('polling mode') || result.includes('Poll Loop'));
  });

  it('includes "terminate" handling', () => {
    const result = buildMinisterContext(BASE_PARAMS);
    assert.ok(result.includes('terminate'));
  });

  it('includes phaseGoal', () => {
    const result = buildMinisterContext(BASE_PARAMS);
    assert.ok(result.includes('Evaluate the heartbeat implementation approach'));
  });

  it('includes heartbeat write instructions', () => {
    const result = buildMinisterContext(BASE_PARAMS);
    assert.ok(result.includes('heartbeat'));
  });

  it('defaults round to 1 when not provided', () => {
    const { round: _r, ...params } = BASE_PARAMS;
    const result = buildMinisterContext(params);
    assert.ok(result.includes('round": 1') || result.includes('round-1-'));
  });
});

// ─── S18: buildRadarContext ───────────────────────────────────────────────────

describe('tribunal-context — S18: buildRadarContext', () => {
  const BASE_PARAMS = {
    sddName: 'tribunal-logic',
    phaseName: 'apply',
    phaseGoal: 'Evaluate the heartbeat implementation approach',
    tribunalId: 'sdd/tribunal-logic/phases/apply/1712345678901',
    channelDir: '/tmp/router/.tribunal/tribunal-logic/apply',
    routerDir: '/tmp/router',
  };

  it('returns a non-empty string', () => {
    const result = buildRadarContext(BASE_PARAMS);
    assert.ok(typeof result === 'string' && result.length > 0);
  });

  it('includes the investigation focus (phaseGoal)', () => {
    const result = buildRadarContext(BASE_PARAMS);
    assert.ok(result.includes('Evaluate the heartbeat implementation approach'));
  });

  it('includes the channel directory path', () => {
    const result = buildRadarContext(BASE_PARAMS);
    assert.ok(result.includes('/tmp/router/.tribunal/tribunal-logic/apply'));
  });

  it('includes "radar" as agent name', () => {
    const result = buildRadarContext(BASE_PARAMS);
    assert.ok(result.includes('radar'));
  });

  it('clarifies radar does NOT take positions', () => {
    const result = buildRadarContext(BASE_PARAMS);
    assert.ok(result.includes('FACTS') || result.includes('do NOT take positions') || result.includes('RISKS'));
  });

  it('includes routerDir as codebase root', () => {
    const result = buildRadarContext(BASE_PARAMS);
    assert.ok(result.includes('/tmp/router'));
  });

  it('includes "terminate" handling via polling', () => {
    const result = buildRadarContext(BASE_PARAMS);
    assert.ok(result.includes('terminate'));
  });
});

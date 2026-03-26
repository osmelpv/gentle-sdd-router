import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runCli } from '../src/cli.js';

const fixtureYaml = `version: 1

active_profile: default

profiles:
  default:
    phases:
      orchestrator:
        - anthropic/claude-sonnet
        - openai/gpt
      explore:
        - google/gemini-flash
        - openai/gpt
      spec:
        - anthropic/claude-opus
        - openai/o3
      design:
        - anthropic/claude-opus
        - openai/o3
      tasks:
        - google/gemini-flash
        - openai/gpt
      apply:
        - ollama/qwen3-coder
        - anthropic/claude-sonnet
      verify:
        - openai/o3
        - anthropic/claude-opus
      archive:
        - anthropic/claude-sonnet
    rules:
      fallback_enabled: true
      retry_count: 2
      timeout_seconds: 30
`;

const v3FixtureYaml = `version: 3

active_catalog: default
active_preset: latest
active_profile: latest
activation_state: active

catalogs:
  default:
    availability: stable
    presets:
      balanced:
        aliases: latest
        complexity: high
        phases:
          orchestrator:
            - kind: lane
              phase: orchestrator
              role: primary
              target: anthropic/claude-sonnet
              fallbacks: openai/gpt
            - kind: lane
              phase: orchestrator
              role: judge
              target: openai/o3
              fallbacks: anthropic/claude-opus
          verify:
            - kind: lane
              phase: verify
              role: radar
              target: google/gemini-pro
              fallbacks: openai/o3
`;

const multimodelFixtureYaml = `version: 3

active_catalog: default
active_preset: balanced
active_profile: balanced
activation_state: active

catalogs:
  default:
    availability: stable
    metadata:
      labels:
        - multimodel
        - shared
      pricing:
        band: platform
        currency: usd
    guidance:
      default:
        laneCount: 2
        ordering:
          - primary
          - judge
          - radar
    presets:
      balanced:
        aliases:
          - latest
        availability: stable
        complexity: high
        metadata:
          labels:
            - balanced
            - recommended
          pricing:
            band: team
            currency: usd
        guidance:
          default:
            laneCount: 2
            ordering:
              - primary
              - judge
        phases:
          orchestrator:
            - kind: lane
              phase: orchestrator
              role: primary
              target: anthropic/claude-sonnet
              fallbacks: openai/gpt
            - kind: lane
              phase: orchestrator
              role: judge
              target: openai/o3
              fallbacks: anthropic/claude-opus
      focused:
        aliases:
          - quick
        availability: beta
        complexity:
          label: focused
        metadata:
          labels:
            - focused
            - fast
          pricing:
            band: starter
            currency: eur
        guidance:
          default:
            laneCount: 1
            ordering:
              - primary
        phases:
          orchestrator:
            - kind: lane
              phase: orchestrator
              role: primary
              target: openai/gpt
              fallbacks: anthropic/claude-sonnet
            - kind: lane
              phase: orchestrator
              role: radar
              target: google/gemini-pro
              fallbacks: openai/o3
`;

test('CLI render opencode includes the agent-teams-lite consumer contract', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-cli-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), fixtureYaml, 'utf8');

  const originalCwd = process.cwd();
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.chdir(tempDir);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await runCli(['render', 'opencode']);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }

  const output = chunks.join('');

  assert.match(output, /Agent Teams Lite contract: degraded/);
  assert.match(output, /Agent Teams Lite compatibility: limited/);
  assert.match(output, /Agent Teams Lite mode: report-only/);
  assert.match(output, /Agent Teams Lite read: available/);
  assert.match(output, /Host session sync: ready/);
  assert.match(output, /Slash root: \/gsr/);
});

test('CLI render opencode reports v3 schema metadata without execution wording', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-cli-v3-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), v3FixtureYaml, 'utf8');

  const originalCwd = process.cwd();
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.chdir(tempDir);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await runCli(['render', 'opencode']);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }

  const output = chunks.join('');

  assert.match(output, /Schema: v3/);
  assert.match(output, /Selected preset: balanced/);
  assert.match(output, /Host session sync: ready/);
  assert.match(output, /Lane roles: primary \/ judge \/ radar/);
  assert.match(output, /Compatibility notes:/);
  assert.match(output, /Multimodel orchestration manager: 1/);
  assert.match(output, /Manager mode: sequential/);
  assert.match(output, /Manager policy: report-only \/ non-executing/);
});

test('CLI browse exposes shareable multimodel metadata without recommendation wording', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-browse-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), multimodelFixtureYaml, 'utf8');

  const originalCwd = process.cwd();
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.chdir(tempDir);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await runCli(['browse']);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }

  const output = chunks.join('');

  assert.match(output, /Command: browse multimodel/);
  assert.match(output, /Status: report-only/);
  assert.match(output, /Visibility: availability=yes pricing=yes labels=yes guidance=yes/);
  assert.match(output, /Policy: non-recommendation \/ non-execution/);
  assert.match(output, /Catalog labels: multimodel \/ shared/);
  assert.match(output, /Preset aliases: latest/);
  assert.match(output, /Pricing: band=team, currency=usd/);
  assert.match(output, /Guidance: default\(lanes=2, ordering=primary \/ judge\)/);
  assert.doesNotMatch(output, /recommendation engine|scoring|orchestration|provider execution/i);
});

test('CLI compare reports projected metadata deltas only', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-compare-'));
  fs.mkdirSync(path.join(tempDir, 'router'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'router', 'router.yaml'), multimodelFixtureYaml, 'utf8');

  const originalCwd = process.cwd();
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.chdir(tempDir);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await runCli(['compare', 'default/balanced', 'default/focused']);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }

  const output = chunks.join('');

  assert.match(output, /Command: compare multimodel/);
  assert.match(output, /Status: report-only/);
  assert.match(output, /Left: default\/balanced/);
  assert.match(output, /Right: default\/focused/);
  assert.match(output, /Differences:/);
  assert.match(output, /preset\.availability: stable -> beta/);
  assert.match(output, /pricing\.band: team -> starter/);
  assert.doesNotMatch(output, /recommendation engine|scoring|orchestration|provider execution/i);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { runCli } from '../src/cli.js';

const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const hostAdoptionEn = fs.readFileSync(new URL('../docs/host-adoption.en.md', import.meta.url), 'utf8');
const hostAdoptionEs = fs.readFileSync(new URL('../docs/host-adoption.es.md', import.meta.url), 'utf8');

test('README states the router boundary clearly and only once for render opencode', () => {
  assert.match(readme, /external router boundary, non-executing/);
  assert.match(readme, /`router\/router\.yaml` is the source of truth\./);
  assert.match(readme, /does not execute models, providers, or agent orchestration\./);
  assert.match(readme, /exposes `\/gsr` session-sync metadata for the active host TUI/i);
  assert.match(readme, /browse\/compare visibility flags are explicit for availability, pricing, labels, and guidance; hidden metadata stays redacted/i);
  assert.match(readme, /render opencode also surfaces a multimodel orchestration manager plan that only labels split\/dispatch\/merge\/judge\/radar steps/i);
  assert.equal(countOccurrences(readme, '- `gsr render opencode`'), 1);
  assert.match(readme, /Minimal v1 setup/);
  assert.match(readme, /compatibility is explicit: schema v1, v3, and v4 are supported; v3 powers multimodel browse\/compare and v4 is the current multi-file format/i);
});

test('README and CLI help share adoption wording', async () => {
  const help = await captureHelp(['--help']);
  const renderHelp = await captureHelp(['help', 'render', 'opencode']);

  const sharedPhrases = [
    'external router boundary, non-executing',
    'Host sync: /gsr session metadata is published for host-local slash-command registration; the router stays external and non-executing.',
    'Multimodel browse/compare expose shareable schema v3 metadata only.',
    'Compatibility: router.yaml versions 1, 3, and 4 are supported; v3 powers multimodel browse/compare and v4 is the current multi-file format.',
    'Quickstart: run gsr status, then gsr bootstrap if router/router.yaml is missing.',
    'Select the active profile in router/router.yaml without changing who is in control.',
    'Show who is in control, how to toggle it, the active profile, and resolved routes.',
    'Inspect shareable multimodel metadata projected from schema v3 without recommending or executing anything.',
    'Compare two shareable multimodel projections without recommending or executing anything.',
    'Inspect or apply a YAML-first install intent to router/router.yaml.',
    'Show or apply a step-by-step bootstrap path for adoption.',
    'Preview the OpenCode provider-execution, host-session sync, handoff, schema metadata, and multimodel orchestration manager boundaries without implying execution.',
  ];

  for (const phrase of sharedPhrases) {
    assert.match(readme, new RegExp(escapeRegExp(phrase)));
    assert.match(help, new RegExp(escapeRegExp(phrase)));
  }

  assert.match(renderHelp, /Usage: gsr render opencode/);
  assert.match(renderHelp, /Preview the OpenCode provider-execution, host-session sync, handoff, schema metadata, and multimodel orchestration manager boundaries without implying execution\./);
});

test('host adoption docs stay bilingual and scope-limited', () => {
  assert.match(hostAdoptionEn, /# Host Adoption/);
  assert.match(hostAdoptionEn, /## Purpose/);
  assert.match(hostAdoptionEn, /## Install/);
  assert.match(hostAdoptionEn, /## Uninstall/);
  assert.match(hostAdoptionEn, /## Safety notes/);
  assert.match(hostAdoptionEs, /# Adopción del Host/);
  assert.match(hostAdoptionEs, /## Proposito/);
  assert.match(hostAdoptionEs, /## Instalacion/);
  assert.match(hostAdoptionEs, /## Desinstalacion/);
  assert.match(hostAdoptionEs, /## Notas de seguridad/);
  assert.match(hostAdoptionEn, /\/gsr/);
  assert.match(hostAdoptionEs, /\/gsr/);
});

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function captureHelp(argv) {
  const originalWrite = process.stdout.write;
  const chunks = [];

  process.stdout.write = function capture(chunk) {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await runCli(argv);
  } finally {
    process.stdout.write = originalWrite;
  }

  return chunks.join('');
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { runCli } from '../src/cli.js';

const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const hostAdoptionEn = fs.readFileSync(new URL('../docs/host-adoption.en.md', import.meta.url), 'utf8');
const hostAdoptionEs = fs.readFileSync(new URL('../docs/host-adoption.es.md', import.meta.url), 'utf8');

test('README states the router boundary clearly', () => {
  assert.match(readme, /external router boundary, non-executing/);
  assert.match(readme, /`router\/router\.yaml` is the source of truth\./);
  assert.match(readme, /does not execute models, providers, or agent orchestration\./);
  assert.match(readme, /\/gsr-fallback/i, 'README must mention /gsr-fallback slash command');
  assert.match(readme, /Minimal v1 setup/);
});

test('README and CLI help share adoption wording', async () => {
  const help = await captureHelp(['--help']);
  const renderHelp = await captureHelp(['help', 'render', 'opencode']);

  const sharedPhrases = [
    'external router boundary, non-executing',
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

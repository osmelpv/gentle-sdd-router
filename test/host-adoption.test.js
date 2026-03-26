import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createHostAdoptionManifest,
  assertManifestMatchesHost,
  hashFile,
  listFilesRecursive,
  readHostAdoptionManifest,
  validateHostAdoptionManifest,
} from '../src/adapters/host-adoption/manifest.js';
import {
  HOST_ADOPTION_GUARDRAIL_LINE,
  HOST_ADOPTION_MANAGED_BLOCK_END,
  HOST_ADOPTION_MANAGED_BLOCK_START,
  createManagedBlock,
  findManagedBlock,
  removeManagedBlock,
  upsertManagedBlock,
} from '../src/adapters/host-adoption/markers.js';
import {
  installHostAdoption,
  resolveHostAdoptionPaths,
  uninstallHostAdoption,
} from '../src/adapters/host-adoption/index.js';

test('managed block helpers detect and preserve user text', () => {
  const baseText = ['alpha', 'beta'].join('\n');
  const inserted = upsertManagedBlock(baseText, HOST_ADOPTION_GUARDRAIL_LINE);

  assert.match(inserted, new RegExp(escapeRegExp(HOST_ADOPTION_MANAGED_BLOCK_START)));
  assert.match(inserted, new RegExp(escapeRegExp(HOST_ADOPTION_MANAGED_BLOCK_END)));
  assert.match(inserted, /router-skill: host-local/);

  const parsed = findManagedBlock(inserted);

  assert.ok(parsed);
  assert.equal(parsed.body, HOST_ADOPTION_GUARDRAIL_LINE);
  assert.equal(removeManagedBlock(inserted), 'alpha\nbeta\n');
  assert.throws(() => findManagedBlock(`${inserted}\n${inserted}`), /exactly once/i);
});

test('manifest hashes skill ownership and rejects tampering', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-host-manifest-'));
  const skillDir = path.join(tempDir, '.gsr', 'skills', 'router-skill');
  const policyPath = path.join(tempDir, '.gsr', 'policy', 'rules.md');

  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'skill.json'), '{"name":"router-skill"}\n', 'utf8');
  fs.writeFileSync(path.join(skillDir, 'README.md'), 'payload\n', 'utf8');

  const policyText = createManagedBlock(HOST_ADOPTION_GUARDRAIL_LINE) + '\n';
  const manifest = createHostAdoptionManifest({
    hostRoot: tempDir,
    skillDir,
    policyPath,
    policyText,
    managedLine: HOST_ADOPTION_GUARDRAIL_LINE,
    createdPolicyFile: true,
  });

  assert.equal(manifest.schema, 1);
  assert.equal(manifest.guardrail.startMarker, HOST_ADOPTION_MANAGED_BLOCK_START);
  assert.equal(manifest.guardrail.endMarker, HOST_ADOPTION_MANAGED_BLOCK_END);
  assert.equal(validateHostAdoptionManifest(manifest), true);
  assert.ok(manifest.ownership.manifestHash);

  const manifestPath = path.join(tempDir, '.gsr', 'host-adoption', 'manifest.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  assert.equal(readHostAdoptionManifest(manifestPath).skill.hash, manifest.skill.hash);
  assert.equal(assertManifestMatchesHost(manifest, {
    hostRoot: tempDir,
    skillDir,
    policyPath,
    policyText,
  }).policyText, policyText);

  manifest.skill.files[0].hash = 'tampered';
  assert.throws(() => validateHostAdoptionManifest(manifest), /ownership proof/i);
});

test('install and uninstall preserve unrelated policy text', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-host-flow-'));
  fs.mkdirSync(path.join(tempDir, '.gsr', 'policy'), { recursive: true });
  fs.writeFileSync(
    path.join(tempDir, '.gsr', 'policy', 'rules.md'),
    ['keep me', 'user line'].join('\n') + '\n',
    'utf8',
  );

  const paths = resolveHostAdoptionPaths(tempDir);
  assert.equal(fs.existsSync(paths.manifestPath), false);

  const firstInstall = installHostAdoption(tempDir);
  const secondInstall = installHostAdoption(tempDir);

  assert.equal(firstInstall.status, 'installed');
  assert.equal(secondInstall.status, 'noop');
  assert.equal(readHostAdoptionManifest(paths.manifestPath).skill.hash, firstInstall.manifest.skill.hash);
  assert.ok(fs.existsSync(path.join(paths.skillDir, 'README.md')));
  assert.ok(fs.existsSync(path.join(paths.skillDir, 'SKILL.md')));

  const installedPolicy = fs.readFileSync(paths.policyPath, 'utf8');
  assert.match(installedPolicy, /keep me/);
  assert.match(installedPolicy, /user line/);
  assert.match(installedPolicy, /router-skill: host-local/);

  const skillFilePath = path.join(paths.skillDir, 'SKILL.md');
  const originalSkillText = fs.readFileSync(skillFilePath, 'utf8');
  fs.writeFileSync(skillFilePath, `${originalSkillText}\nuser edit`, 'utf8');

  assert.throws(() => uninstallHostAdoption(tempDir), /skill files do not match|hash mismatch/i);

  fs.writeFileSync(skillFilePath, originalSkillText, 'utf8');

  const uninstall = uninstallHostAdoption(tempDir);

  assert.equal(uninstall.status, 'uninstalled');
  assert.equal(fs.readFileSync(paths.policyPath, 'utf8'), 'keep me\nuser line\n');
  assert.equal(fs.existsSync(paths.manifestPath), false);
  assert.equal(fs.existsSync(paths.skillDir), false);
});

test('uninstall fails closed on duplicate markers', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-host-guardrail-'));
  fs.mkdirSync(path.join(tempDir, '.gsr', 'policy'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, '.gsr', 'policy', 'rules.md'), 'seed\n', 'utf8');

  const paths = resolveHostAdoptionPaths(tempDir);
  installHostAdoption(tempDir);

  const tampered = `${fs.readFileSync(paths.policyPath, 'utf8')}${createManagedBlock(HOST_ADOPTION_GUARDRAIL_LINE)}\n`;
  fs.writeFileSync(paths.policyPath, tampered, 'utf8');

  assert.throws(() => uninstallHostAdoption(tempDir), /exactly once/);
  assert.match(fs.readFileSync(paths.policyPath, 'utf8'), /router-skill: host-local/);
});

test('manifest fingerprints the actual skill files', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-host-files-'));
  const skillDir = path.join(tempDir, '.gsr', 'skills', 'router-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'one.txt'), 'one\n', 'utf8');
  fs.writeFileSync(path.join(skillDir, 'two.txt'), 'two\n', 'utf8');

  const files = listFilesRecursive(skillDir);
  assert.equal(files.length, 2);
  assert.equal(hashFile(files[0]), hashFile(files[0]));
});

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

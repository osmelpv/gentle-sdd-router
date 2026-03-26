import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package metadata stays adoption-focused and non-executing', () => {
  assert.equal(packageJson.description, 'Release-ready non-executing CLI router for SDD adoption, YAML control, and OpenCode boundary reports.');
  assert.deepEqual(packageJson.keywords, ['sdd', 'router', 'cli', 'adoption', 'documentation', 'opencode', 'release', 'compatibility']);
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.license, 'UNLICENSED');
  assert.deepEqual(packageJson.files, ['README.md', 'assets/', 'bin/', 'docs/', 'src/', 'router/']);
  assert.deepEqual(packageJson.engines, { node: '>=20' });
  assert.deepEqual(packageJson.repository, { type: 'git', url: 'git+https://github.com/osmelpv/gentle-sdd-router.git' });
});

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Find the contracts directory.
 * In development (npm link): relative to the module source.
 * In production (npm install -g): relative to the installed package.
 */
export function findContractsDir() {
  // Try relative to this module (works for both linked and installed)
  const moduleDir = dirname(new URL(import.meta.url).pathname);
  const contractsDir = join(moduleDir, '..', '..', 'router', 'contracts');
  if (existsSync(contractsDir)) return contractsDir;
  return null;
}

/**
 * Read all contract files and generate a sync manifest.
 * @param {string} contractsDir - Path to router/contracts/
 * @returns {Array<{type: string, name: string, topicKey: string, file: string, content: string, checksum: string}>}
 */
export function readContracts(contractsDir) {
  const contracts = [];

  const subdirs = ['roles', 'phases'];
  for (const subdir of subdirs) {
    const dir = join(contractsDir, subdir);
    if (!existsSync(dir)) continue;

    const files = readdirSync(dir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const name = file.replace('.md', '');
      const filePath = join(dir, file);
      const content = readFileSync(filePath, 'utf8');
      const checksum = createHash('sha256').update(content).digest('hex');

      contracts.push({
        type: subdir === 'roles' ? 'role' : 'phase',
        name,
        topicKey: `gsr/contracts/${subdir}/${name}`,
        file: `router/contracts/${subdir}/${file}`,
        content,
        checksum,
      });
    }
  }

  return contracts;
}

/**
 * Generate a sync manifest JSON file.
 * This manifest is read by the TUI host to push contracts to Engram.
 * @param {string} contractsDir - Path to router/contracts/
 * @returns {{ manifest: object, contractCount: number, manifestPath: string }}
 */
export function generateSyncManifest(contractsDir) {
  const contracts = readContracts(contractsDir);

  const manifest = {
    version: 1,
    generated_at: new Date().toISOString(),
    contracts: contracts.map(c => ({
      type: c.type,
      name: c.name,
      topic_key: c.topicKey,
      file: c.file,
      checksum: c.checksum,
    })),
  };

  // Write manifest file
  const manifestPath = join(contractsDir, '.sync-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  return { manifest, contractCount: contracts.length, manifestPath };
}

/**
 * Full sync operation: read contracts, generate manifest, return summary.
 * @returns {{ roles: number, phases: number, total: number, manifestPath: string }}
 */
export function syncContracts() {
  const contractsDir = findContractsDir();
  if (!contractsDir) {
    throw new Error('Contracts directory not found. Expected at router/contracts/');
  }

  const contracts = readContracts(contractsDir);
  const roles = contracts.filter(c => c.type === 'role').length;
  const phases = contracts.filter(c => c.type === 'phase').length;

  const { manifestPath } = generateSyncManifest(contractsDir);

  return { roles, phases, total: contracts.length, manifestPath };
}

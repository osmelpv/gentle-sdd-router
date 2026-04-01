import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { loadCustomSdds } from './sdd-catalog-io.js';

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
 * Read catalog-scoped role and phase contracts for a custom SDD.
 * @param {string} catalogDir - Path to router/catalogs/<name>/
 * @param {string} [catalogsDir] - Optional path to router/catalogs/ — used to compute
 *   project-style relative paths (e.g. `catalogs/game-design/contracts/roles/director.md`).
 *   When omitted, the file path falls back to an absolute FS path (legacy behavior).
 * @returns {Array<{type: string, name: string, file: string}>}
 */
export function readCatalogContracts(catalogDir, catalogsDir) {
  const contracts = [];
  const contractsBase = join(catalogDir, 'contracts');

  // Compute the router root for relative-path generation
  const routerDir = catalogsDir ? dirname(catalogsDir) : null;

  const subdirs = ['roles', 'phases'];
  for (const subdir of subdirs) {
    const dir = join(contractsBase, subdir);
    if (!existsSync(dir)) continue;

    let files;
    try {
      files = readdirSync(dir).filter(f => f.endsWith('.md'));
    } catch {
      continue;
    }

    for (const file of files) {
      const name = file.replace('.md', '');
      const absolutePath = join(contractsBase, subdir, file);
      // Produce a project-style relative path when routerDir is known
      const filePath = routerDir
        ? relative(routerDir, absolutePath)
        : absolutePath;
      contracts.push({
        type: subdir === 'roles' ? 'role' : 'phase',
        name,
        file: filePath,
      });
    }
  }

  return contracts;
}

/**
 * Generate a sync manifest JSON file.
 * This manifest is read by the TUI host to push contracts to Engram.
 *
 * Version behavior:
 *   - version: 1 when no custom SDDs found (backward-compatible)
 *   - version: 2 when custom SDDs are present (strict superset)
 *
 * @param {string} contractsDir - Path to router/contracts/
 * @param {string} [catalogsDir] - Optional path to router/catalogs/ for custom SDDs
 * @returns {{ manifest: object, contractCount: number, manifestPath: string }}
 */
export function generateSyncManifest(contractsDir, catalogsDir) {
  const contracts = readContracts(contractsDir);

  // Load custom SDDs if catalogsDir provided
  let customSdds = [];
  if (catalogsDir) {
    try {
      customSdds = loadCustomSdds(catalogsDir);
    } catch {
      // Non-blocking: catalog load errors don't break the sync
      customSdds = [];
    }
  }

  const contractsArray = contracts.map(c => ({
    type: c.type,
    name: c.name,
    topic_key: c.topicKey,
    file: c.file,
    checksum: c.checksum,
  }));

  let manifest;

  if (customSdds.length > 0) {
    // v2: includes custom_sdds array
    const customSddsArray = customSdds.map(sdd => {
      const catalogDir = join(catalogsDir, sdd.name);
      const catalogContracts = readCatalogContracts(catalogDir, catalogsDir);

      const roles = catalogContracts
        .filter(c => c.type === 'role')
        .map(c => ({ name: c.name, file: c.file }));

      const phases = Object.entries(sdd.phases).map(([phaseName, phase]) => ({
        name: phaseName,
        intent: phase.intent,
        execution: phase.execution,
        agents: phase.agents,
      }));

      return {
        name: sdd.name,
        scope: 'project',
        phases,
        roles,
        triggers: sdd.triggers ?? {},
      };
    });

    manifest = {
      version: 2,
      generated_at: new Date().toISOString(),
      contracts: contractsArray,
      custom_sdds: customSddsArray,
    };
  } else {
    // v1: no custom SDDs
    manifest = {
      version: 1,
      generated_at: new Date().toISOString(),
      contracts: contractsArray,
    };
  }

  // Write manifest file — always to the same path
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

  // Derive catalogsDir relative to contractsDir (router/catalogs/)
  const catalogsDir = join(dirname(contractsDir), 'catalogs');

  const contracts = readContracts(contractsDir);
  const roles = contracts.filter(c => c.type === 'role').length;
  const phases = contracts.filter(c => c.type === 'phase').length;

  const { manifestPath } = generateSyncManifest(contractsDir, catalogsDir);

  return { roles, phases, total: contracts.length, manifestPath };
}

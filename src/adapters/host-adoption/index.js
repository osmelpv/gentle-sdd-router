import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertManifestMatchesHost,
  createHostAdoptionManifest,
  readHostAdoptionManifest,
  writeHostAdoptionManifest,
} from './manifest.js';
import {
  HOST_ADOPTION_GUARDRAIL_LINE,
  HOST_ADOPTION_MANAGED_BLOCK_END,
  HOST_ADOPTION_MANAGED_BLOCK_START,
  findManagedBlock,
  removeManagedBlock,
  upsertManagedBlock,
} from './markers.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '../../..');
const ROUTER_SKILL_ASSET_DIR = path.join(REPO_ROOT, 'assets', 'host-skill', 'router-skill');

export const HOST_ADOPTION_SKILL_NAME = 'router-skill';
export const HOST_ADOPTION_SKILL_DIR_NAME = '.gsr/skills/router-skill';
export const HOST_ADOPTION_POLICY_FILE_NAME = '.gsr/policy/rules.md';
export const HOST_ADOPTION_MANIFEST_FILE_NAME = '.gsr/host-adoption/manifest.json';

export function resolveHostAdoptionPaths(hostRoot) {
  const resolvedHostRoot = path.resolve(hostRoot);

  return {
    hostRoot: resolvedHostRoot,
    skillDir: path.join(resolvedHostRoot, HOST_ADOPTION_SKILL_DIR_NAME),
    policyPath: path.join(resolvedHostRoot, HOST_ADOPTION_POLICY_FILE_NAME),
    manifestPath: path.join(resolvedHostRoot, HOST_ADOPTION_MANIFEST_FILE_NAME),
    assetDir: ROUTER_SKILL_ASSET_DIR,
  };
}

export function installHostAdoption(hostRoot, options = {}) {
  const paths = resolveHostAdoptionPaths(hostRoot);
  const assetDir = options.assetDir ?? paths.assetDir;

  if (!fs.existsSync(assetDir)) {
    throw new Error('Router skill asset payload is missing.');
  }

  if (fs.existsSync(paths.manifestPath)) {
    const manifest = readHostAdoptionManifest(paths.manifestPath);
    const state = assertManifestMatchesHost(manifest, paths);

    return {
      status: 'noop',
      manifest,
      policyPath: paths.policyPath,
      skillDir: paths.skillDir,
      assetDir,
      policyText: state.policyText,
    };
  }

  const previousPolicyExists = fs.existsSync(paths.policyPath);
  const previousPolicyText = previousPolicyExists ? fs.readFileSync(paths.policyPath, 'utf8') : '';

  if (fs.existsSync(paths.skillDir)) {
    throw new Error('Host adoption skill directory already exists without a manifest.');
  }

  if (findManagedBlock(previousPolicyText)) {
    throw new Error('Host adoption policy already contains a managed block without a manifest.');
  }

  try {
    copyDirectoryAtomic(assetDir, paths.skillDir);

    const nextPolicyText = upsertManagedBlock(previousPolicyText, HOST_ADOPTION_GUARDRAIL_LINE);
    writeTextAtomic(paths.policyPath, nextPolicyText);

    const manifest = createHostAdoptionManifest({
      hostRoot: paths.hostRoot,
      skillDir: paths.skillDir,
      policyPath: paths.policyPath,
      policyText: nextPolicyText,
      managedLine: HOST_ADOPTION_GUARDRAIL_LINE,
      createdPolicyFile: !previousPolicyExists,
    });

    writeHostAdoptionManifest(paths.manifestPath, manifest);

    return {
      status: 'installed',
      manifest,
      policyPath: paths.policyPath,
      skillDir: paths.skillDir,
      assetDir,
    };
  } catch (error) {
    restoreInstallFailure(paths, previousPolicyExists, previousPolicyText);
    throw error;
  }
}

export function uninstallHostAdoption(hostRoot, options = {}) {
  const paths = resolveHostAdoptionPaths(hostRoot);

  if (!fs.existsSync(paths.manifestPath)) {
    throw new Error('Host adoption manifest is missing.');
  }

  const manifest = readHostAdoptionManifest(paths.manifestPath);
  const state = assertManifestMatchesHost(manifest, paths);
  const cleanedPolicyText = removeManagedBlock(state.policyText);

  if (cleanedPolicyText.length === 0 && manifest.guardrail.createdPolicyFile) {
    fs.rmSync(paths.policyPath, { force: true });
  } else {
    writeTextAtomic(paths.policyPath, cleanedPolicyText);
  }

  if (fs.existsSync(paths.skillDir)) {
    fs.rmSync(paths.skillDir, { recursive: true, force: true });
  }

  fs.rmSync(paths.manifestPath, { force: true });

  return {
    status: 'uninstalled',
    manifest,
    policyPath: paths.policyPath,
    skillDir: paths.skillDir,
    assetDir: options.assetDir ?? paths.assetDir,
  };
}

function copyDirectoryAtomic(sourceDir, targetDir) {
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryAtomic(sourcePath, targetPath);
      continue;
    }

    if (entry.isFile()) {
      const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(tempPath, fs.readFileSync(sourcePath));

      try {
        fs.renameSync(tempPath, targetPath);
      } catch (error) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // Ignore cleanup failures; the original error is the important one.
        }

        throw error;
      }
    }
  }
}

function writeTextAtomic(filePath, content) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tempPath, content, 'utf8');

  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Ignore cleanup failures; the original error is the important one.
    }

    throw error;
  }
}

function restoreInstallFailure(paths, previousPolicyExists, previousPolicyText) {
  try {
    if (previousPolicyExists) {
      writeTextAtomic(paths.policyPath, previousPolicyText);
    } else if (fs.existsSync(paths.policyPath)) {
      fs.rmSync(paths.policyPath, { force: true });
    }
  } catch {
    // Ignore rollback failures; the original error is the important one.
  }

  try {
    fs.rmSync(paths.skillDir, { recursive: true, force: true });
  } catch {
    // Ignore rollback failures; the original error is the important one.
  }

  try {
    fs.rmSync(paths.manifestPath, { force: true });
  } catch {
    // Ignore rollback failures; the original error is the important one.
  }
}

export {
  HOST_ADOPTION_GUARDRAIL_LINE,
  HOST_ADOPTION_MANAGED_BLOCK_START,
  HOST_ADOPTION_MANAGED_BLOCK_END,
};

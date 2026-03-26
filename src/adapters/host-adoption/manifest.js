import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  HOST_ADOPTION_GUARDRAIL_LINE,
  HOST_ADOPTION_MANAGED_BLOCK_END,
  HOST_ADOPTION_MANAGED_BLOCK_START,
  createManagedBlock,
  findManagedBlock,
} from './markers.js';

export const HOST_ADOPTION_MANIFEST_SCHEMA = 1;

export function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function hashFile(filePath) {
  return hashText(fs.readFileSync(filePath, 'utf8'));
}

export function listFilesRecursive(rootDir) {
  const entries = [];

  if (!fs.existsSync(rootDir)) {
    return entries;
  }

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      for (const child of listFilesRecursive(entryPath)) {
        entries.push(child);
      }
      continue;
    }

    if (entry.isFile()) {
      entries.push(entryPath);
    }
  }

  return entries.sort();
}

export function createHostAdoptionManifest({
  hostRoot,
  skillDir,
  policyPath,
  policyText,
  managedLine = HOST_ADOPTION_GUARDRAIL_LINE,
  createdPolicyFile = false,
}) {
  const skillFiles = listFilesRecursive(skillDir).map((filePath) => {
    const relativePath = normalizeRelativePath(path.relative(skillDir, filePath));
    const content = fs.readFileSync(filePath, 'utf8');

    return {
      path: relativePath,
      hash: hashText(content),
    };
  });
  const skillHash = hashText(skillFiles.map((file) => `${file.path}:${file.hash}`).join('\n'));
  const policyBlock = createManagedBlock(managedLine);
  const normalizedPolicyPath = normalizeRelativePath(path.relative(hostRoot, policyPath));
  const normalizedSkillDir = normalizeRelativePath(path.relative(hostRoot, skillDir));
  const manifest = {
    schema: HOST_ADOPTION_MANIFEST_SCHEMA,
    hostRoot,
    state: 'installed',
    createdAt: new Date().toISOString(),
    skill: {
      path: normalizedSkillDir,
      hash: skillHash,
      files: skillFiles,
    },
    guardrail: {
      path: normalizedPolicyPath,
      startMarker: HOST_ADOPTION_MANAGED_BLOCK_START,
      endMarker: HOST_ADOPTION_MANAGED_BLOCK_END,
      line: managedLine,
      blockHash: hashText(policyBlock),
      policyHash: hashText(policyText),
      createdPolicyFile,
    },
  };

  return {
    ...manifest,
    ownership: {
      manifestHash: hashText(stableStringify(manifest)),
    },
  };
}

export function validateHostAdoptionManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Host adoption manifest must be an object.');
  }

  if (manifest.schema !== HOST_ADOPTION_MANIFEST_SCHEMA) {
    throw new Error('Host adoption manifest schema is not supported.');
  }

  if (manifest.state !== 'installed') {
    throw new Error('Host adoption manifest is not in an installed state.');
  }

  if (!manifest.skill?.path || !manifest.guardrail?.path) {
    throw new Error('Host adoption manifest is missing tracked paths.');
  }

  if (!manifest.guardrail.startMarker || !manifest.guardrail.endMarker) {
    throw new Error('Host adoption manifest is missing managed markers.');
  }

  if (!manifest.ownership?.manifestHash) {
    throw new Error('Host adoption manifest is missing ownership proof.');
  }

  const snapshot = {
    schema: manifest.schema,
    hostRoot: manifest.hostRoot,
    state: manifest.state,
    createdAt: manifest.createdAt,
    skill: manifest.skill,
    guardrail: manifest.guardrail,
  };

  if (hashText(stableStringify(snapshot)) !== manifest.ownership.manifestHash) {
    throw new Error('Host adoption manifest ownership proof does not match.');
  }

  return true;
}

export function readHostAdoptionManifest(manifestPath) {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  validateHostAdoptionManifest(manifest);
  return manifest;
}

export function writeHostAdoptionManifest(manifestPath, manifest) {
  const tempPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
  const raw = `${JSON.stringify(manifest, null, 2)}\n`;

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(tempPath, raw, 'utf8');

  try {
    fs.renameSync(tempPath, manifestPath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Ignore cleanup failures; the original error is the important one.
    }

    throw error;
  }
}

export function assertManifestMatchesHost(manifest, { hostRoot, skillDir, policyPath, policyText }) {
  validateHostAdoptionManifest(manifest);

  if (path.resolve(hostRoot) !== path.resolve(manifest.hostRoot)) {
    throw new Error('Host adoption manifest belongs to a different host root.');
  }

  const currentFiles = listFilesRecursive(skillDir).map((filePath) => ({
    path: normalizeRelativePath(path.relative(skillDir, filePath)),
    hash: hashFile(filePath),
  }));
  const currentSkillHash = hashText(currentFiles.map((file) => `${file.path}:${file.hash}`).join('\n'));
  const expectedPaths = manifest.skill.files.map((file) => file.path).join('\n');
  const currentPaths = currentFiles.map((file) => file.path).join('\n');

  if (currentSkillHash !== manifest.skill.hash || expectedPaths !== currentPaths) {
    throw new Error('Host adoption skill files do not match the manifest.');
  }

  const currentPolicyText = policyText ?? fs.readFileSync(policyPath, 'utf8');
  const managedBlock = findManagedBlock(currentPolicyText);

  if (!managedBlock) {
    throw new Error('Host adoption managed block is missing.');
  }

  if (managedBlock.body !== manifest.guardrail.line) {
    throw new Error('Host adoption managed block does not match the manifest.');
  }

  if (managedBlock.blockHash !== manifest.guardrail.blockHash) {
    throw new Error('Host adoption managed block hash does not match the manifest.');
  }

  return {
    policyText: currentPolicyText,
    managedBlock,
  };
}

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

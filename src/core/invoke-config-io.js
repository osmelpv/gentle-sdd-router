/**
 * invoke-config-io.js
 *
 * Loads invoke configuration files from {routerDir}/invoke_configs/ directory.
 * These configs define the simplified phase schema for debug invoking.
 *
 * Schema requirements per file:
 *   - name: string (required)
 *   - sdd: string (required)
 *   - phases: object (required, may be empty)
 *
 * @module invoke-config-io
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseYaml } from './router.js';

const INVOKE_CONFIGS_DIR = 'invoke_configs';

/**
 * Load all invoke config files from {routerDir}/invoke_configs/.
 *
 * If the directory does not exist, returns [].
 * If a file is malformed or missing required fields, throws a descriptive error
 * that includes the file path.
 *
 * @param {string} routerDir - Absolute path to the router directory
 * @returns {Promise<Array<{name: string, sdd: string, phases: object, filePath: string, ...rest}>>}
 */
export async function loadInvokeConfigs(routerDir) {
  const invokeConfigsDir = join(routerDir, INVOKE_CONFIGS_DIR);

  if (!existsSync(invokeConfigsDir)) {
    return [];
  }

  let entries;
  try {
    entries = readdirSync(invokeConfigsDir);
  } catch {
    return [];
  }

  const yamlFiles = entries.filter((f) => f.endsWith('.yaml'));

  const results = [];

  for (const filename of yamlFiles) {
    const filePath = join(invokeConfigsDir, filename);
    let parsed;

    try {
      const raw = readFileSync(filePath, 'utf8');
      parsed = parseYaml(raw);
    } catch (err) {
      throw new Error(
        `Failed to parse invoke config file "${filePath}": ${err.message}`
      );
    }

    validateInvokeConfig(parsed, filePath);

    results.push({
      ...parsed,
      filePath,
    });
  }

  return results;
}

/**
 * Validate minimum required shape for an invoke config object.
 * Throws with file path in message on validation failure.
 *
 * @param {unknown} config - Parsed YAML object
 * @param {string} filePath - Absolute path to file (for error messages)
 */
function validateInvokeConfig(config, filePath) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(
      `Invoke config file "${filePath}" must be a valid YAML object.`
    );
  }

  if (typeof config.name !== 'string' || !config.name.trim()) {
    throw new Error(
      `Invoke config file "${filePath}" is missing required field "name" (must be a non-empty string).`
    );
  }

  if (typeof config.sdd !== 'string' || !config.sdd.trim()) {
    throw new Error(
      `Invoke config file "${filePath}" is missing required field "sdd" (must be a non-empty string).`
    );
  }

  if (config.phases === undefined || config.phases === null || typeof config.phases !== 'object' || Array.isArray(config.phases)) {
    throw new Error(
      `Invoke config file "${filePath}" is missing required field "phases" (must be an object).`
    );
  }
}

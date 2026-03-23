import fs from 'node:fs';
import path from 'node:path';

const CANONICAL_PHASES = [
  'orchestrator',
  'explore',
  'spec',
  'design',
  'tasks',
  'apply',
  'verify',
  'archive',
];

export function findProjectRoot(startDir = process.cwd()) {
  let current = path.resolve(startDir);

  while (true) {
    const configPath = path.join(current, 'router', 'router.yaml');
    if (fs.existsSync(configPath)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error('No se encontró router/router.yaml desde el directorio actual.');
    }

    current = parent;
  }
}

export function getConfigPath(startDir = process.cwd()) {
  return path.join(findProjectRoot(startDir), 'router', 'router.yaml');
}

export function loadRouterConfig(configPath = getConfigPath()) {
  const raw = fs.readFileSync(configPath, 'utf8');
  const config = parseYaml(raw);
  validateRouterConfig(config);
  return config;
}

export function saveRouterConfig(config, configPath = getConfigPath()) {
  validateRouterConfig(config);
  const yaml = stringifyYaml(config);
  const tempPath = `${configPath}.tmp`;
  fs.writeFileSync(tempPath, yaml, 'utf8');
  fs.renameSync(tempPath, configPath);
}

export function setActiveProfile(config, profileName) {
  if (!config.profiles?.[profileName]) {
    throw new Error(`El profile "${profileName}" no existe.`);
  }

  return {
    ...config,
    active_profile: profileName,
  };
}

export function resolveRouterState(config) {
  const activeProfileName = config.active_profile;
  const activeProfile = config.profiles[activeProfileName];

  if (!activeProfile) {
    throw new Error(`El profile activo "${activeProfileName}" no existe.`);
  }

  const phases = activeProfile.phases ?? {};
  const resolvedPhases = {};

  for (const [phaseName, routeChain] of Object.entries(phases)) {
    const activeRoute = routeChain.find(isRunnerRoute) ?? routeChain[0];

    resolvedPhases[phaseName] = {
      active: activeRoute,
      candidates: [...routeChain],
    };
  }

  return {
    version: config.version,
    activeProfileName,
    resolvedPhases,
    rules: activeProfile.rules ?? {},
    profiles: Object.keys(config.profiles),
  };
}

export function listProfiles(config) {
  const activeProfileName = config.active_profile;

  return Object.entries(config.profiles).map(([profileName, profile]) => ({
    name: profileName,
    active: profileName === activeProfileName,
    phases: Object.keys(profile.phases ?? {}),
  }));
}

export function validateRouterConfig(config) {
  if (!isObject(config)) {
    throw new Error('router.yaml debe contener un objeto raíz válido.');
  }

  if (config.version !== 1) {
    throw new Error('router.yaml requiere version: 1.');
  }

  if (typeof config.active_profile !== 'string' || !config.active_profile.trim()) {
    throw new Error('router.yaml requiere active_profile como string no vacío.');
  }

  if (!isObject(config.profiles) || Object.keys(config.profiles).length === 0) {
    throw new Error('router.yaml requiere al menos un profile en profiles.');
  }

  const activeProfile = config.profiles[config.active_profile];
  if (!activeProfile) {
    throw new Error(`El active_profile "${config.active_profile}" no existe en profiles.`);
  }

  for (const [profileName, profile] of Object.entries(config.profiles)) {
    if (!isObject(profile)) {
      throw new Error(`El profile "${profileName}" debe ser un objeto.`);
    }

    if (!isObject(profile.phases)) {
      throw new Error(`El profile "${profileName}" requiere phases como objeto.`);
    }

    for (const [phaseName, chain] of Object.entries(profile.phases)) {
      validateRouteChain(profileName, phaseName, chain);
    }

    if (profile.rules !== undefined && !isObject(profile.rules)) {
      throw new Error(`El profile "${profileName}" requiere rules como objeto cuando está presente.`);
    }
  }

  return true;
}

function validateRouteChain(profileName, phaseName, chain) {
  if (!Array.isArray(chain) || chain.length === 0) {
    throw new Error(`El profile "${profileName}" tiene una cadena vacía en la phase "${phaseName}".`);
  }

  for (const candidate of chain) {
    validateRouteCandidate(profileName, phaseName, candidate);
  }
}

function validateRouteCandidate(profileName, phaseName, candidate) {
  if (typeof candidate === 'string') {
    if (!candidate.trim()) {
      throw new Error(`El profile "${profileName}" tiene un candidato inválido en la phase "${phaseName}".`);
    }

    return;
  }

  if (!isObject(candidate)) {
    throw new Error(`El profile "${profileName}" tiene un candidato inválido en la phase "${phaseName}".`);
  }

  if (typeof candidate.kind !== 'string' || !candidate.kind.trim()) {
    throw new Error(`El profile "${profileName}" tiene un route object sin kind válido en la phase "${phaseName}".`);
  }

  if (candidate.kind === 'runner') {
    if (typeof candidate.target !== 'string' || !candidate.target.trim()) {
      throw new Error(`El profile "${profileName}" tiene un runner route sin target válido en la phase "${phaseName}".`);
    }
  } else if (candidate.target !== undefined && typeof candidate.target !== 'string') {
    throw new Error(`El profile "${profileName}" tiene un target inválido en la phase "${phaseName}".`);
  }

  if (candidate.metadata !== undefined && !isObject(candidate.metadata)) {
    throw new Error(`El profile "${profileName}" tiene metadata inválida en la phase "${phaseName}".`);
  }
}

function isRunnerRoute(candidate) {
  return typeof candidate === 'string' || (isObject(candidate) && candidate.kind === 'runner');
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseYaml(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let index = 0;

  function skipIgnored() {
    while (index < lines.length) {
      const trimmed = lines[index].trim();
      if (trimmed === '' || trimmed.startsWith('#')) {
        index += 1;
        continue;
      }
      break;
    }
  }

  function peekNextSignificantLine() {
    let probe = index;
    while (probe < lines.length) {
      const raw = lines[probe];
      const trimmed = raw.trim();
      if (trimmed === '' || trimmed.startsWith('#')) {
        probe += 1;
        continue;
      }
      return { indent: countIndent(raw), text: trimmed };
    }
    return null;
  }

  function parseBlock(expectedIndent) {
    skipIgnored();

    const first = peekNextSignificantLine();
    if (!first || first.indent < expectedIndent) {
      return {};
    }

    if (first.indent > expectedIndent) {
      throw new Error(`Indentación YAML inesperada en la línea ${index + 1}.`);
    }

    if (first.text.startsWith('- ')) {
      return parseList(expectedIndent);
    }

    const result = {};
    while (true) {
      skipIgnored();
      if (index >= lines.length) {
        return result;
      }

      const raw = lines[index];
      const trimmed = raw.trim();
      if (trimmed === '' || trimmed.startsWith('#')) {
        index += 1;
        continue;
      }

      const indent = countIndent(raw);
      if (indent < expectedIndent) {
        return result;
      }

      if (indent !== expectedIndent) {
        throw new Error(`Indentación YAML inesperada en la línea ${index + 1}.`);
      }

      if (trimmed.startsWith('- ')) {
        throw new Error(`Se esperaba una clave YAML en la línea ${index + 1}.`);
      }

      const separator = trimmed.indexOf(':');
      if (separator < 0) {
        throw new Error(`Se esperaba ":" en la línea ${index + 1}.`);
      }

      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      index += 1;

      if (value !== '') {
        result[key] = parseScalar(value);
        continue;
      }

      const next = peekNextSignificantLine();
      if (!next || next.indent <= expectedIndent) {
        result[key] = {};
        continue;
      }

      result[key] = parseBlock(next.indent);
    }
  }

  function parseList(expectedIndent) {
    const items = [];

    while (true) {
      skipIgnored();
      if (index >= lines.length) {
        return items;
      }

      const raw = lines[index];
      const trimmed = raw.trim();
      if (trimmed === '' || trimmed.startsWith('#')) {
        index += 1;
        continue;
      }

      const indent = countIndent(raw);
      if (indent < expectedIndent) {
        return items;
      }

      if (indent !== expectedIndent || !trimmed.startsWith('- ')) {
        throw new Error(`Se esperaba un item de lista en la línea ${index + 1}.`);
      }

      const itemText = trimmed.slice(2).trim();
      index += 1;
      items.push(parseListItem(itemText, indent));
    }
  }

  function parseListItem(itemText, itemIndent) {
    if (itemText === '') {
      const next = peekNextSignificantLine();
      if (!next || next.indent <= itemIndent) {
        return null;
      }

      return parseBlock(next.indent);
    }

    if (!looksLikeRouteObjectLine(itemText)) {
      return parseScalar(itemText);
    }

    const mapping = parseInlineMapping(itemText, itemIndent);
    const next = peekNextSignificantLine();

    if (!next || next.indent <= itemIndent) {
      return mapping;
    }

    const nested = parseBlock(next.indent);
    if (isObject(nested)) {
      return { ...mapping, ...nested };
    }

    throw new Error(`Se esperaba un objeto YAML en la línea ${index + 1}.`);
  }

  function looksLikeRouteObjectLine(text) {
    return /^(kind|target|metadata):(?:\s+.*)?$/.test(text);
  }

  function parseInlineMapping(text, itemIndent) {
    const separator = text.indexOf(':');
    if (separator < 0) {
      throw new Error(`Se esperaba ":" en la línea ${index + 1}.`);
    }

    const key = text.slice(0, separator).trim();
    const value = text.slice(separator + 1).trim();

    if (value === '') {
      const next = peekNextSignificantLine();
      if (!next || next.indent <= itemIndent) {
        return { [key]: {} };
      }

      return { [key]: parseBlock(next.indent) };
    }

    return { [key]: parseScalar(value) };
  }

  const document = parseBlock(0);
  skipIgnored();

  if (index < lines.length) {
    const remaining = lines.slice(index).find((line) => line.trim() !== '' && !line.trim().startsWith('#'));
    if (remaining !== undefined) {
      throw new Error('router.yaml contiene contenido sobrante o mal indentado.');
    }
  }

  return document;
}

function stringifyYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (isObject(item) || Array.isArray(item)) {
          const nested = stringifyYaml(item, indent + 2);
          return `${pad}- ${nested.replace(/^\s+/, '')}`;
        }

        return `${pad}- ${formatScalar(item)}`;
      })
      .join('\n');
  }

  if (isObject(value)) {
    return Object.entries(value)
      .map(([key, item]) => {
        if (Array.isArray(item)) {
          const nested = stringifyYaml(item, indent + 2);
          return `${pad}${key}:\n${nested}`;
        }

        if (isObject(item)) {
          const nested = stringifyYaml(item, indent + 2);
          return `${pad}${key}:\n${nested}`;
        }

        return `${pad}${key}: ${formatScalar(item)}`;
      })
      .join('\n');
  }

  return `${pad}${formatScalar(value)}`;
}

function parseScalar(raw) {
  if (raw === 'true') {
    return true;
  }

  if (raw === 'false') {
    return false;
  }

  if (/^-?\d+$/.test(raw)) {
    return Number(raw);
  }

  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }

  return raw;
}

function formatScalar(value) {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '0';
  }

  if (value === null || value === undefined) {
    return 'null';
  }

  const text = String(value);
  if (text === '' || /[:#\n\r\t]/.test(text) || text.startsWith(' ') || text.endsWith(' ')) {
    return JSON.stringify(text);
  }

  return text;
}

function countIndent(line) {
  return line.length - line.trimStart().length;
}

export { CANONICAL_PHASES, parseYaml, stringifyYaml };

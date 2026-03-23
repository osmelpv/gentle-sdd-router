import path from 'node:path';
import {
  getConfigPath,
  listProfiles,
  loadRouterConfig,
  resolveRouterState,
  saveRouterConfig,
  setActiveProfile,
  tryGetConfigPath,
} from './router-config.js';

export async function runCli(argv) {
  const [command, ...rest] = argv;

  switch (command) {
    case 'use':
      return runUse(rest);
    case 'reload':
      return runReload();
    case 'status':
      return runStatus();
    case 'list':
      return runList();
    default:
      printUsage();
      if (command) {
        throw new Error(`Comando desconocido: ${command}`);
      }
  }
}

function runUse(args) {
  const profileName = args[0];
  if (!profileName) {
    throw new Error('gsr use requiere un nombre de profile.');
  }

  const configPath = getConfigPath();
  const currentConfig = loadRouterConfig(configPath);
  const nextConfig = setActiveProfile(currentConfig, profileName);
  saveRouterConfig(nextConfig, configPath);

  process.stdout.write(`Active profile: ${profileName}\n`);
}

function runReload() {
  const configPath = getConfigPath();
  const config = loadRouterConfig(configPath);
  const state = resolveRouterState(config);

  process.stdout.write(renderStatus(state, configPath));
}

function runStatus() {
  const configPath = tryGetConfigPath();

  if (!configPath) {
    process.stdout.write(renderMissingStatus());
    return;
  }

  try {
    const config = loadRouterConfig(configPath);
    const state = resolveRouterState(config);

    process.stdout.write(renderStatus(state, configPath));
  } catch (error) {
    process.stdout.write(renderInvalidStatus(configPath, error));
  }
}

function runList() {
  const config = loadRouterConfig(getConfigPath());
  const profiles = listProfiles(config);

  process.stdout.write('Profiles:\n');
  for (const profile of profiles) {
    const marker = profile.active ? '*' : ' ';
    process.stdout.write(`${marker} ${profile.name} (${profile.phases.length} phases)\n`);
  }
}

function renderStatus(state, configPath) {
  const lines = [
    `Config: ${path.relative(process.cwd(), configPath) || configPath}`,
    `Version: ${state.version}`,
    `Active profile: ${state.activeProfileName}`,
    'Resolved routes:',
  ];

  for (const [phaseName, route] of Object.entries(state.resolvedPhases)) {
    lines.push(`- ${phaseName}: ${formatRoute(route.active)}`);
  }

  return `${lines.join('\n')}\n`;
}

function renderMissingStatus() {
  return [
    'Config: missing',
    'Status: unavailable',
    'Reason: router/router.yaml no está disponible en el contexto actual ni junto al módulo.',
  ].join('\n') + '\n';
}

function renderInvalidStatus(configPath, error) {
  const message = error instanceof Error ? error.message : String(error);

  return [
    `Config: ${path.relative(process.cwd(), configPath) || configPath}`,
    'Status: invalid',
    `Reason: ${message}`,
  ].join('\n') + '\n';
}

function printUsage() {
  process.stdout.write([
    'Usage:',
    '  gsr use <profile>',
    '  gsr reload',
    '  gsr status',
    '  gsr list',
  ].join('\n') + '\n');
}

function formatRoute(route) {
  if (route && typeof route === 'object') {
    return route.target ?? route.kind ?? '(none)';
  }

  return route ?? '(none)';
}

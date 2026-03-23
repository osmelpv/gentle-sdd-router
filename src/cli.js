import path from 'node:path';
import {
  getConfigPath,
  listProfiles,
  loadRouterConfig,
  resolveRouterState,
  saveRouterConfig,
  setActiveProfile,
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
  const configPath = getConfigPath();
  const config = loadRouterConfig(configPath);
  const state = resolveRouterState(config);

  process.stdout.write(renderStatus(state, configPath));
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

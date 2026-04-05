import * as p from '@clack/prompts';
import { resolveControllerLabel } from '../core/controller.js';

const BANNER = `
                                                      :!???????~!??????7~.
                                                  .!YY!:.     .!:      .^?YJ^
                                   ..           .5P~           .           .?G!
                               ...#7JB.        7#^             .              YB.
                           :~7GP5#! 7#       Y#      .:^^..   ..   .:^:.      ~#:
                   .. .?Y5?!^..P^P?G~ ?#     !@    .!55J?JY55YJ??JY55JJJYPJ:.   !#
                 .G?JBB#^G      G^G?G^ JB  :?#J   :PG:       .:::..       7#7.  .#P7.
                 .@~ 7G?G^G      G:GP#~^#:?#....~.P#                       ^@^:^...:#~
                  :#^ 7PJP^P   :^G#5P.~~. Y#.^^.^!#.                        Y#^^.~.:#~
                   :#^ ?5BPJ#BY!~B#       G5??J5?#Y   ^~:.           ..:~.   @5J5???GY
                    ^#~.#5~!:?GB!?#.     J#  ^.~.G5   .P@PBP       ^#5#@!    @:^::.  @^
                     .!!:      #! !#:..  :@Y^~^~7#    B@##:        J#@@!   ~@B~^~^^P@.
                               J@^ ?@7?5!#?.^!7Y.Y@7    !?.       .  ^?^    #@^~Y!~: 5#
                             :#7J@:.#B .#@J .: ~.@@~       .7!!7JJ.       #@@Y.^ ~  P#
                             G# .5Y7^   #B!?7?J?5@@@@.         .          P@@@#J?J7??~5P
                             :#Y:   .~Y@@7  !.~:^@@@@7                    @@@@@.!.^^  !@
                               ^7P#G#?:5#5P?J~!?#GJG@.                    P@JY#B?~!??G5:
                                  @~GY. 5BJYYYYJ~~55.7.                  ^:G#!.:!77!^
                                  !#^#Y. #G!????!^  G?                    G:7@#57~^^^^:.
                                   ~#B@Y. #~     .Y#!    P           ~?   .#J:YGY!~^^~!?55?.
                                     7B###Y77JG#B?     PP     ?.     #~    5#Y!?YJ!^.    ~GP:  .!^
                                        !G#@#GJ~.     ^#G     7@#.    .#J    .Y#@#!!PPY77.  ^5YJ57@~
                                     .?5Y7:.      .:~B@?    .P@@@#7    .B#!     ^Y##J~7!JGP?^.:~?#P
                                   :GP^    ..:~7!^!G#^   .J##~Y##!   .Y@P?^.     :!?J!..~?YYJ!.
                                  7#:  .^7!^YGYJY??G@:.  7GGB?   :PBPG. :.Y@#J7YJ7^..   ~GP
                                 .@^ .!~BJ77^      BB   ~PY#       ~#7B   .@~.^~!YY?5P?:  J#.
                                 .@^ YJ#:   .YYY#! ?@.  !~^#       ?B 5   J@  YB?Y?..:BYY. &5
                                  J#::~5G7~ !#:7@5   G#   7Y#       :@~7  ^@^  :#:#YB  .#::@~
                                   ^P55?G#.#  B#G   :@^  Y.BJ     .#!~~  B#    #@^ &?Y#5P5#!
                                      ..   B5^:5B?7JGJ  ~77G7      BY!Y. .GP?75#!.~#~ ^~~:
                                            #P!~:^^:..^7^5#         !@^7!. .^^^^~!#?
                                             !J5GG7!PGG5JJ.          ~YJPPGJ!JGPY?:
                                                 ^77!.                    :77!.
`;

/**
 * Run the interactive wizard.
 * @param {object} context - { configPath, routerDir, config, version }
 */
export async function runWizard(context, prompts = p) {
  prompts.intro(BANNER.trim() + '\n  GSR — Gentle SDD Router [BETA]');

  if (!context.configPath) {
    // State A: No router config found
    return await wizardFreshProject(context, prompts);
  }

  if (context.version < 4) {
    // State B: Outdated config
    return await wizardOutdatedConfig(context, prompts);
  }

  // State C: Current config
  return await wizardCurrentConfig(context, prompts);
}

export async function wizardFreshProject(context, prompts = p) {
  const action = await prompts.select({
    message: 'No router config found in this directory.',
    options: [
      { value: 'install', label: 'Install', hint: 'Set up gsr in this project' },
      { value: 'help', label: 'Help', hint: 'Show available commands' },
      { value: 'exit', label: 'Exit' },
    ],
  });

  if (prompts.isCancel(action) || action === 'exit') {
    prompts.outro('Bye!');
    return null;
  }

  return action; // 'install' or 'help'
}

export async function wizardOutdatedConfig(context, prompts = p) {
  const controllerLabel = resolveControllerLabel(context.config);

  prompts.note(
    `Config version: ${context.version} (latest: 4)\nController: ${controllerLabel}`,
    'Project Status',
  );

  const action = await prompts.select({
    message: 'What would you like to do?',
    options: [
      { value: 'update', label: 'Update', hint: 'Migrate config to the latest version' },
      { value: 'status', label: 'Status', hint: 'Show current router state' },
      { value: 'list', label: 'List presets', hint: 'Show available profiles' },
      { value: 'exit', label: 'Exit' },
    ],
  });

  if (prompts.isCancel(action) || action === 'exit') {
    prompts.outro('Bye!');
    return null;
  }

  return action;
}

export async function wizardCurrentConfig(context, prompts = p) {
  const controllerLabel = resolveControllerLabel(context.config);
  const activePreset = context.config?.active_preset || 'unknown';

  prompts.note(
    `Active preset: ${activePreset}\nController: ${controllerLabel}\nVersion: ${context.version}`,
    'Project Status',
  );

  const action = await prompts.select({
    message: 'What would you like to do?',
    options: [
      { value: 'use', label: 'Switch preset', hint: 'Change the active routing preset' },
      { value: 'status', label: 'Status', hint: 'Show detailed router state' },
      { value: 'reload', label: 'View routes', hint: 'Show resolved routes for current preset' },
      { value: 'list', label: 'List presets', hint: 'Show all available presets' },
      { value: 'compare', label: 'Compare presets', hint: 'Compare two presets side by side' },
      { value: 'profiles', label: 'Manage profiles', hint: 'Create, delete, rename, or copy profiles' },
      { value: 'export', label: 'Export preset', hint: 'Export a preset for sharing' },
      { value: 'import', label: 'Import preset', hint: 'Import a preset from file or URL' },
      { value: 'update', label: 'Check updates', hint: 'Check for config migrations' },
      { value: 'exit', label: 'Exit' },
    ],
  });

  if (prompts.isCancel(action) || action === 'exit') {
    prompts.outro('Bye!');
    return null;
  }

  if (action === 'use') return await wizardSwitchPreset(context, prompts);
  if (action === 'export') return await wizardExport(context, prompts);
  if (action === 'import') return await wizardImport(context, prompts);
  if (action === 'profiles') return await wizardManageProfiles(context, prompts);
  if (action === 'compare') return await wizardCompare(context, prompts);

  // browse, status, reload, list, update go straight to CLI
  return action;
}

export async function wizardSwitchPreset(context, prompts = p) {
  // Get available presets from config
  const presets = [];
  const catalogs = context.config?.catalogs || {};
  for (const [catalogName, catalog] of Object.entries(catalogs)) {
    const catalogPresets = catalog?.presets || {};
    for (const [presetName, preset] of Object.entries(catalogPresets)) {
      const isActive = presetName === context.config?.active_preset;
      presets.push({
        value: presetName,
        label: `${presetName}${isActive ? ' (active)' : ''}`,
        hint: preset?.availability || '',
      });
    }
  }

  if (presets.length === 0) {
    prompts.log.warn('No presets found.');
    return null;
  }

  const selected = await prompts.select({
    message: 'Select a preset to activate:',
    options: presets,
  });

  if (prompts.isCancel(selected)) {
    return null;
  }

  return { command: 'use', preset: selected };
}

export async function wizardExport(context, prompts = p) {
  // Build preset list from config
  const presets = [];
  const catalogs = context.config?.catalogs || {};
  for (const [, catalog] of Object.entries(catalogs)) {
    for (const [presetName] of Object.entries(catalog?.presets || {})) {
      presets.push({ value: presetName, label: presetName });
    }
  }

  if (presets.length === 0) {
    prompts.log.warn('No presets found to export.');
    return null;
  }

  const selected = await prompts.select({
    message: 'Select a preset to export:',
    options: presets,
  });

  if (prompts.isCancel(selected)) return null;

  const format = await prompts.select({
    message: 'Export format:',
    options: [
      { value: 'yaml', label: 'YAML', hint: 'Human-readable YAML output' },
      { value: 'compact', label: 'Compact', hint: 'gsr:// string for easy sharing' },
    ],
  });

  if (prompts.isCancel(format)) return null;

  return { command: 'export', preset: selected, compact: format === 'compact' };
}

export async function wizardImport(context, prompts = p) {
  const source = await prompts.text({
    message: 'Enter import source (file path, https:// URL, or gsr:// string):',
    validate(value) {
      if (!value || !value.trim()) return 'Source is required.';
    },
  });

  if (prompts.isCancel(source)) return null;

  return { command: 'import', source: source.trim() };
}

export async function wizardManageProfiles(context, prompts = p) {
  const action = await prompts.select({
    message: 'Preset management:',
    options: [
      { value: 'profile-create', label: 'Create preset', hint: 'Create a new empty preset' },
      { value: 'profile-delete', label: 'Delete preset', hint: 'Delete an existing preset' },
      { value: 'profile-rename', label: 'Rename preset', hint: 'Rename an existing preset' },
      { value: 'profile-copy', label: 'Copy preset', hint: 'Clone an existing preset' },
    ],
  });

  if (prompts.isCancel(action)) return null;

  if (action === 'profile-create') {
    const name = await prompts.text({
      message: 'New preset name:',
      validate(value) { if (!value || !value.trim()) return 'Name is required.'; },
    });
    if (prompts.isCancel(name)) return null;
    return { command: 'profile', subcommand: 'create', name: name.trim() };
  }

  if (action === 'profile-delete') {
    const presets = [];
    const catalogs = context.config?.catalogs || {};
    for (const [, catalog] of Object.entries(catalogs)) {
      for (const [presetName] of Object.entries(catalog?.presets || {})) {
        presets.push({ value: presetName, label: presetName });
      }
    }
    if (presets.length === 0) {
      prompts.log.warn('No presets found.');
      return null;
    }
    const selected = await prompts.select({ message: 'Select profile to delete:', options: presets });
    if (prompts.isCancel(selected)) return null;
    return { command: 'profile', subcommand: 'delete', name: selected };
  }

  if (action === 'profile-rename') {
    const presets = [];
    const catalogs = context.config?.catalogs || {};
    for (const [, catalog] of Object.entries(catalogs)) {
      for (const [presetName] of Object.entries(catalog?.presets || {})) {
        presets.push({ value: presetName, label: presetName });
      }
    }
    if (presets.length === 0) {
      prompts.log.warn('No profiles found.');
      return null;
    }
    const selected = await prompts.select({ message: 'Select profile to rename:', options: presets });
    if (prompts.isCancel(selected)) return null;
    const newName = await prompts.text({
      message: 'New name:',
      validate(value) { if (!value || !value.trim()) return 'Name is required.'; },
    });
    if (prompts.isCancel(newName)) return null;
    return { command: 'profile', subcommand: 'rename', oldName: selected, newName: newName.trim() };
  }

  if (action === 'profile-copy') {
    const presets = [];
    const catalogs = context.config?.catalogs || {};
    for (const [, catalog] of Object.entries(catalogs)) {
      for (const [presetName] of Object.entries(catalog?.presets || {})) {
        presets.push({ value: presetName, label: presetName });
      }
    }
    if (presets.length === 0) {
      prompts.log.warn('No profiles found.');
      return null;
    }
    const selected = await prompts.select({ message: 'Select profile to copy:', options: presets });
    if (prompts.isCancel(selected)) return null;
    const destName = await prompts.text({
      message: 'Name for the copy:',
      validate(value) { if (!value || !value.trim()) return 'Name is required.'; },
    });
    if (prompts.isCancel(destName)) return null;
    return { command: 'profile', subcommand: 'copy', sourceName: selected, destName: destName.trim() };
  }

  return null;
}

export async function wizardCompare(context, prompts = p) {
  const presets = [];
  const catalogs = context.config?.catalogs || {};
  for (const [, catalog] of Object.entries(catalogs)) {
    for (const [presetName] of Object.entries(catalog?.presets || {})) {
      presets.push({ value: presetName, label: presetName });
    }
  }
  if (presets.length < 2) {
    prompts.log.warn('Need at least 2 presets to compare.');
    return null;
  }

  const left = await prompts.select({ message: 'Select first preset:', options: presets });
  if (prompts.isCancel(left)) return null;

  const right = await prompts.select({
    message: 'Select second preset:',
    options: presets.filter((pr) => pr.value !== left),
  });
  if (prompts.isCancel(right)) return null;

  return { command: 'compare', left, right };
}

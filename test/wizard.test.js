import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runWizard,
  wizardCompare,
  wizardCurrentConfig,
  wizardExport,
  wizardFreshProject,
  wizardImport,
  wizardManageProfiles,
  wizardOutdatedConfig,
  wizardSwitchPreset,
} from '../src/ux/wizard.js';
import {
  resetWizardEntrypointForTesting,
  runCli,
  setWizardEntrypointForTesting,
} from '../src/cli.js';

function createPromptStub({ selectResult, textResult } = {}) {
  const calls = {
    intro: [],
    note: [],
    outro: [],
    warn: [],
    select: [],
    text: [],
  };

  return {
    calls,
    intro(message) {
      calls.intro.push(message);
    },
    note(message, title) {
      calls.note.push({ message, title });
    },
    outro(message) {
      calls.outro.push(message);
    },
    async select(payload) {
      calls.select.push(payload);
      return typeof selectResult === 'function' ? selectResult(payload) : selectResult;
    },
    async text(payload) {
      calls.text.push(payload);
      return typeof textResult === 'function' ? textResult(payload) : textResult;
    },
    isCancel(value) {
      return value === Symbol.for('cancel');
    },
    log: {
      warn(message) {
        calls.warn.push(message);
      },
    },
  };
}

function createCurrentContext(overrides = {}) {
  return {
    configPath: '/tmp/router/router.yaml',
    version: 4,
    config: {
      active_preset: 'balanced',
      catalogs: {
        default: {
          presets: {
            balanced: { availability: 'stable' },
            safety: { availability: 'unavailable' },
          },
        },
        experimental: {
          presets: {
            turbo: { availability: 'beta' },
          },
        },
      },
    },
    ...overrides,
  };
}

function withStdoutTty(value, fn) {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value,
  });

  try {
    return fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(process.stdout, 'isTTY', descriptor);
    } else {
      delete process.stdout.isTTY;
    }
  }
}

async function captureStdout(fn) {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const chunks = [];
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };

  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }

  return chunks.join('');
}

test('runWizard is exported as a function', () => {
  assert.equal(typeof runWizard, 'function');
});

test('runWizard is an async function', () => {
  // Async functions return a Promise when called; we can check via the prototype
  assert.ok(runWizard.constructor.name === 'AsyncFunction');
});

test('wizardFreshProject returns selected install action and exposes expected options', async () => {
  const prompts = createPromptStub({ selectResult: 'install' });

  const result = await wizardFreshProject({}, prompts);

  assert.equal(result, 'install');
  assert.deepEqual(
    prompts.calls.select[0].options.map((option) => option.value),
    ['install', 'help', 'exit'],
  );
});

test('wizardFreshProject exits cleanly on exit selection', async () => {
  const prompts = createPromptStub({ selectResult: 'exit' });

  const result = await wizardFreshProject({}, prompts);

  assert.equal(result, null);
  assert.deepEqual(prompts.calls.outro, ['Bye!']);
});

test('runWizard routes fresh projects into the fresh-project flow', async () => {
  const prompts = createPromptStub({ selectResult: 'help' });

  const result = await runWizard({ configPath: null, version: 0, config: null }, prompts);

  assert.equal(result, 'help');
  assert.ok(prompts.calls.intro[0].includes('GSR'));
  assert.equal(prompts.calls.select[0].message, 'No router config found in this directory.');
});

test('wizardCurrentConfig delegates preset switching and marks the active preset in options', async () => {
  const prompts = createPromptStub({
    selectResult(payload) {
      return payload.message === 'What would you like to do?' ? 'use' : 'turbo';
    },
  });

  const result = await wizardCurrentConfig(createCurrentContext(), prompts);

  assert.deepEqual(result, { command: 'use', preset: 'turbo' });
  assert.equal(prompts.calls.select.length, 2);
  assert.deepEqual(
    prompts.calls.select[0].options.map((option) => option.value),
    ['use', 'status', 'reload', 'list', 'browse', 'compare', 'profiles', 'export', 'import', 'update', 'exit'],
  );
  assert.deepEqual(
    prompts.calls.select[1].options.map((option) => option.label),
    ['balanced (active)', 'safety', 'turbo'],
  );
  assert.deepEqual(
    prompts.calls.select[1].options.map((option) => option.hint),
    ['stable', 'unavailable', 'beta'],
  );
});

test('wizardCurrentConfig returns direct actions when no preset switch is requested', async () => {
  const prompts = createPromptStub({ selectResult: 'status' });

  const result = await wizardCurrentConfig(createCurrentContext(), prompts);

  assert.equal(result, 'status');
  assert.equal(prompts.calls.select.length, 1);
});

test('wizardSwitchPreset warns and returns null when no presets exist', async () => {
  const prompts = createPromptStub();

  const result = await wizardSwitchPreset({
    config: {
      active_preset: 'balanced',
      catalogs: {
        default: { presets: {} },
      },
    },
  }, prompts);

  assert.equal(result, null);
  assert.deepEqual(prompts.calls.warn, ['No presets found.']);
  assert.equal(prompts.calls.select.length, 0);
});

test('runCli with no args and TTY enters the wizard entrypoint', async () => {
  const calls = [];
  setWizardEntrypointForTesting(async (context) => {
    calls.push(context);
    return null;
  });

  try {
    await withStdoutTty(true, () => runCli([]));
  } finally {
    resetWizardEntrypointForTesting();
  }

  assert.equal(calls.length, 1);
  assert.equal(typeof calls[0].version, 'number');
  assert.ok(calls[0].configPath);
});

test('runCli with no args and non-TTY falls back to text help', async () => {
  const output = await withStdoutTty(false, () => captureStdout(() => runCli([])));

  assert.match(output, /Usage: gsr <command> \[args\]/);
  assert.match(output, /Commands:/);
  assert.doesNotMatch(output, /No router config found in this directory/);
});

test('wizardCurrentConfig exposes export and import options', async () => {
  const prompts = createPromptStub({ selectResult: 'status' });

  await wizardCurrentConfig(createCurrentContext(), prompts);

  const optionValues = prompts.calls.select[0].options.map((o) => o.value);
  assert.ok(optionValues.includes('export'), 'export option is present');
  assert.ok(optionValues.includes('import'), 'import option is present');
});

test('wizardCurrentConfig export option has a label and hint', async () => {
  const prompts = createPromptStub({ selectResult: 'status' });

  await wizardCurrentConfig(createCurrentContext(), prompts);

  const exportOption = prompts.calls.select[0].options.find((o) => o.value === 'export');
  assert.ok(exportOption, 'export option exists');
  assert.ok(exportOption.label, 'export option has a label');
  assert.ok(exportOption.hint, 'export option has a hint');
});

test('wizardCurrentConfig import option has a label and hint', async () => {
  const prompts = createPromptStub({ selectResult: 'status' });

  await wizardCurrentConfig(createCurrentContext(), prompts);

  const importOption = prompts.calls.select[0].options.find((o) => o.value === 'import');
  assert.ok(importOption, 'import option exists');
  assert.ok(importOption.label, 'import option has a label');
  assert.ok(importOption.hint, 'import option has a hint');
});

test('wizardCurrentConfig export action triggers sub-flow and returns command object', async () => {
  let selectCallCount = 0;
  const prompts = createPromptStub({
    selectResult(payload) {
      selectCallCount++;
      if (selectCallCount === 1) return 'export';
      if (selectCallCount === 2) return 'balanced';
      return 'yaml';
    },
  });

  const result = await wizardCurrentConfig(createCurrentContext(), prompts);

  assert.deepEqual(result, { command: 'export', preset: 'balanced', compact: false });
});

test('wizardCurrentConfig import action triggers sub-flow and returns command object', async () => {
  const prompts = createPromptStub({
    selectResult: 'import',
    textResult: '/path/to/preset.yaml',
  });

  const result = await wizardCurrentConfig(createCurrentContext(), prompts);

  assert.deepEqual(result, { command: 'import', source: '/path/to/preset.yaml' });
});

// ── wizardOutdatedConfig ───────────────────────────────────────────────────────

test('wizardOutdatedConfig returns selected action and shows version note', async () => {
  const prompts = createPromptStub({ selectResult: 'update' });
  const context = createCurrentContext({ version: 3 });

  const result = await wizardOutdatedConfig(context, prompts);

  assert.equal(result, 'update');
  assert.equal(prompts.calls.note.length, 1);
  assert.ok(prompts.calls.note[0].message.includes('3'), 'note includes current version');
  assert.ok(prompts.calls.note[0].message.includes('4'), 'note includes latest version');
});

test('wizardOutdatedConfig exits cleanly on exit', async () => {
  const prompts = createPromptStub({ selectResult: 'exit' });
  const context = createCurrentContext({ version: 3 });

  const result = await wizardOutdatedConfig(context, prompts);

  assert.equal(result, null);
  assert.deepEqual(prompts.calls.outro, ['Bye!']);
});

test('wizardOutdatedConfig exits cleanly on cancel (Ctrl+C)', async () => {
  const prompts = createPromptStub({ selectResult: Symbol.for('cancel') });
  const context = createCurrentContext({ version: 3 });

  const result = await wizardOutdatedConfig(context, prompts);

  assert.equal(result, null);
  assert.deepEqual(prompts.calls.outro, ['Bye!']);
});

test('wizardOutdatedConfig shows correct menu options', async () => {
  const prompts = createPromptStub({ selectResult: 'status' });
  const context = createCurrentContext({ version: 3 });

  await wizardOutdatedConfig(context, prompts);

  const values = prompts.calls.select[0].options.map((o) => o.value);
  assert.deepEqual(values, ['update', 'status', 'list', 'exit']);
});

test('runWizard routes outdated configs (version < 4) into outdated flow', async () => {
  const prompts = createPromptStub({ selectResult: 'status' });
  const context = createCurrentContext({ version: 3 });

  const result = await runWizard(context, prompts);

  assert.equal(result, 'status');
  assert.equal(prompts.calls.note.length, 1);
  assert.ok(prompts.calls.note[0].message.includes('3'), 'outdated note shows current version');
});

test('wizardFreshProject exits cleanly on cancel (Ctrl+C)', async () => {
  const prompts = createPromptStub({ selectResult: Symbol.for('cancel') });

  const result = await wizardFreshProject({}, prompts);

  assert.equal(result, null);
  assert.deepEqual(prompts.calls.outro, ['Bye!']);
});

test('wizardCurrentConfig exits cleanly on cancel (Ctrl+C)', async () => {
  const prompts = createPromptStub({ selectResult: Symbol.for('cancel') });

  const result = await wizardCurrentConfig(createCurrentContext(), prompts);

  assert.equal(result, null);
  assert.deepEqual(prompts.calls.outro, ['Bye!']);
});

test('wizardSwitchPreset returns null on cancel (Ctrl+C)', async () => {
  const prompts = createPromptStub({ selectResult: Symbol.for('cancel') });

  const result = await wizardSwitchPreset(createCurrentContext(), prompts);

  assert.equal(result, null);
  // wizardSwitchPreset does NOT call outro on cancel — only null is returned
  assert.deepEqual(prompts.calls.outro, []);
});

// ── Bug fix tests ─────────────────────────────────────────────────────────────

test('wizardOutdatedConfig does not offer manage action (replaced with list)', async () => {
  const prompts = createPromptStub({ selectResult: 'status' });
  const context = createCurrentContext({ version: 3 });

  await wizardOutdatedConfig(context, prompts);

  const values = prompts.calls.select[0].options.map((o) => o.value);
  assert.ok(!values.includes('manage'), 'manage option must not be present');
});

test('wizardOutdatedConfig offers list action', async () => {
  const prompts = createPromptStub({ selectResult: 'status' });
  const context = createCurrentContext({ version: 3 });

  await wizardOutdatedConfig(context, prompts);

  const values = prompts.calls.select[0].options.map((o) => o.value);
  assert.ok(values.includes('list'), 'list option must be present');
});

test('wizardCurrentConfig export action returns object with preset and format', async () => {
  let selectCallCount = 0;
  const prompts = createPromptStub({
    selectResult(payload) {
      selectCallCount++;
      if (selectCallCount === 1) return 'export';
      if (selectCallCount === 2) return 'balanced';
      if (selectCallCount === 3) return 'compact';
      return 'exit';
    },
  });
  const result = await wizardCurrentConfig(createCurrentContext(), prompts);
  assert.deepEqual(result, { command: 'export', preset: 'balanced', compact: true });
});

test('wizardCurrentConfig export cancel returns null', async () => {
  let selectCallCount = 0;
  const prompts = createPromptStub({
    selectResult(payload) {
      selectCallCount++;
      if (selectCallCount === 1) return 'export';
      return Symbol.for('cancel');
    },
  });
  const result = await wizardCurrentConfig(createCurrentContext(), prompts);
  assert.equal(result, null);
});

test('wizardCurrentConfig import action returns object with source', async () => {
  const prompts = createPromptStub({
    selectResult: 'import',
    textResult: 'https://example.com/preset.yaml',
  });
  const result = await wizardCurrentConfig(createCurrentContext(), prompts);
  assert.deepEqual(result, { command: 'import', source: 'https://example.com/preset.yaml' });
});

test('wizardCurrentConfig import cancel returns null', async () => {
  const prompts = createPromptStub({
    selectResult: 'import',
    textResult: Symbol.for('cancel'),
  });
  const result = await wizardCurrentConfig(createCurrentContext(), prompts);
  assert.equal(result, null);
});

// ── New feature tests ─────────────────────────────────────────────────────────

test('wizardCurrentConfig offers browse option', async () => {
  const prompts = createPromptStub({ selectResult: 'status' });

  await wizardCurrentConfig(createCurrentContext(), prompts);

  const values = prompts.calls.select[0].options.map((o) => o.value);
  assert.ok(values.includes('browse'), 'browse option must be present');
});

test('wizardCurrentConfig offers compare option', async () => {
  const prompts = createPromptStub({ selectResult: 'status' });

  await wizardCurrentConfig(createCurrentContext(), prompts);

  const values = prompts.calls.select[0].options.map((o) => o.value);
  assert.ok(values.includes('compare'), 'compare option must be present');
});

test('wizardCurrentConfig offers profiles management option', async () => {
  const prompts = createPromptStub({ selectResult: 'status' });

  await wizardCurrentConfig(createCurrentContext(), prompts);

  const values = prompts.calls.select[0].options.map((o) => o.value);
  assert.ok(values.includes('profiles'), 'profiles option must be present');
});

test('wizardCurrentConfig browse returns direct string action', async () => {
  const prompts = createPromptStub({ selectResult: 'browse' });

  const result = await wizardCurrentConfig(createCurrentContext(), prompts);

  assert.equal(result, 'browse');
});

test('wizardCompare returns command object with left and right', async () => {
  let selectCallCount = 0;
  const prompts = createPromptStub({
    selectResult(payload) {
      selectCallCount++;
      if (selectCallCount === 1) return 'balanced';
      return 'turbo';
    },
  });
  const result = await wizardCompare(createCurrentContext(), prompts);
  assert.deepEqual(result, { command: 'compare', left: 'balanced', right: 'turbo' });
});

test('wizardCompare warns when less than 2 presets', async () => {
  const prompts = createPromptStub({ selectResult: 'balanced' });
  const context = createCurrentContext({
    config: {
      active_preset: 'balanced',
      catalogs: {
        default: {
          presets: {
            balanced: { availability: 'stable' },
          },
        },
      },
    },
  });
  const result = await wizardCompare(context, prompts);
  assert.equal(result, null);
  assert.ok(prompts.calls.warn.length > 0, 'should warn about not enough presets');
  assert.ok(prompts.calls.warn[0].includes('2'), 'warning mentions needing 2 presets');
});

test('wizardManageProfiles create returns command object', async () => {
  const prompts = createPromptStub({
    selectResult: 'profile-create',
    textResult: 'my-new-profile',
  });
  const result = await wizardManageProfiles(createCurrentContext(), prompts);
  assert.deepEqual(result, { command: 'profile', subcommand: 'create', name: 'my-new-profile' });
});

test('wizardManageProfiles delete returns command object', async () => {
  const prompts = createPromptStub({
    selectResult(payload) {
      if (payload.message === 'Preset management:') return 'profile-delete';
      return 'balanced';
    },
  });
  const result = await wizardManageProfiles(createCurrentContext(), prompts);
  assert.deepEqual(result, { command: 'profile', subcommand: 'delete', name: 'balanced' });
});

test('wizardManageProfiles rename returns command object', async () => {
  let selectCallCount = 0;
  const prompts = createPromptStub({
    selectResult(payload) {
      selectCallCount++;
      if (selectCallCount === 1) return 'profile-rename';
      return 'balanced';
    },
    textResult: 'balanced-v2',
  });
  const result = await wizardManageProfiles(createCurrentContext(), prompts);
  assert.deepEqual(result, {
    command: 'profile',
    subcommand: 'rename',
    oldName: 'balanced',
    newName: 'balanced-v2',
  });
});

test('wizardManageProfiles copy returns command object', async () => {
  let selectCallCount = 0;
  const prompts = createPromptStub({
    selectResult(payload) {
      selectCallCount++;
      if (selectCallCount === 1) return 'profile-copy';
      return 'balanced';
    },
    textResult: 'balanced-copy',
  });
  const result = await wizardManageProfiles(createCurrentContext(), prompts);
  assert.deepEqual(result, {
    command: 'profile',
    subcommand: 'copy',
    sourceName: 'balanced',
    destName: 'balanced-copy',
  });
});

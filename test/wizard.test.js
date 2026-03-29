import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runWizard,
  wizardCurrentConfig,
  wizardFreshProject,
  wizardSwitchPreset,
} from '../src/ux/wizard.js';
import {
  resetWizardEntrypointForTesting,
  runCli,
  setWizardEntrypointForTesting,
} from '../src/cli.js';

function createPromptStub({ selectResult } = {}) {
  const calls = {
    intro: [],
    note: [],
    outro: [],
    warn: [],
    select: [],
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
  assert.deepEqual(prompts.calls.intro, ['gsr — Gentle SDD Router']);
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
    ['use', 'status', 'reload', 'list', 'export', 'import', 'update', 'exit'],
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

test('wizardCurrentConfig returns export action directly when selected', async () => {
  const prompts = createPromptStub({ selectResult: 'export' });

  const result = await wizardCurrentConfig(createCurrentContext(), prompts);

  assert.equal(result, 'export');
});

test('wizardCurrentConfig returns import action directly when selected', async () => {
  const prompts = createPromptStub({ selectResult: 'import' });

  const result = await wizardCurrentConfig(createCurrentContext(), prompts);

  assert.equal(result, 'import');
});

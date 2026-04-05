import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  transformForClaudeCode,
  deployGsrCommandsClaudeCode,
  CLAUDE_COMMANDS_DIR,
} from '../src/adapters/claude-code/command-deployer.js';

// ── transformForClaudeCode ────────────────────────────────────────────────────

describe('transformForClaudeCode', () => {
  test('strips ! prefix from standalone shell command line', () => {
    const input = '!`gsr status`';
    const output = transformForClaudeCode(input);
    assert.ok(!output.includes('!`'), 'Should not contain !`');
    assert.ok(output.includes('`gsr status`'), 'Should contain bare backtick command');
    assert.ok(output.includes('Run using your bash tool:'), 'Should include bash instruction prefix');
  });

  test('strips ! prefix from inline shell command within text', () => {
    const input = '- Command: !`gsr status`';
    const output = transformForClaudeCode(input);
    assert.equal(output, '- Command: `gsr status`');
  });

  test('handles multiple inline ! commands on the same line', () => {
    const input = 'First: !`gsr status`, Second: !`gsr sync`';
    const output = transformForClaudeCode(input);
    assert.ok(!output.includes('!`'), 'Should not contain any !`');
    assert.ok(output.includes('`gsr status`'), 'Should contain first command');
    assert.ok(output.includes('`gsr sync`'), 'Should contain second command');
  });

  test('preserves regular markdown unchanged', () => {
    const input = '# Title\n\nSome plain text with no shell commands.\n\n- Bullet item';
    const output = transformForClaudeCode(input);
    assert.equal(output, input);
  });

  test('preserves YAML frontmatter verbatim', () => {
    const input = [
      '---',
      'description: "[System] Show router state"',
      'tags: [gsr, status]',
      '---',
      '',
      'Some content after frontmatter.',
    ].join('\n');

    const output = transformForClaudeCode(input);
    assert.ok(output.startsWith('---\ndescription: "[System] Show router state"\ntags: [gsr, status]\n---'), 'Frontmatter should be preserved verbatim');
  });

  test('does NOT add prefix to ! commands inside frontmatter', () => {
    // Frontmatter should pass through unchanged even if it somehow had !`...`
    const input = [
      '---',
      'description: "test !`cmd`"',
      '---',
      '',
      'Content here.',
    ].join('\n');

    const output = transformForClaudeCode(input);
    // The frontmatter line should be unchanged
    assert.ok(output.includes('description: "test !`cmd`"'), 'Frontmatter should be unchanged');
  });

  test('transform is idempotent — applying twice yields same result', () => {
    const input = [
      '---',
      'description: "[System] Show router state"',
      '---',
      '',
      'Run `gsr status` to see the current state.',
      '',
      'CONTEXT:',
      '- Working directory: !`echo -n "$(pwd)"`',
      '- Command: !`gsr status`',
    ].join('\n');

    const once = transformForClaudeCode(input);
    const twice = transformForClaudeCode(once);
    assert.equal(once, twice, 'Second application should be identical to first');
  });

  test('gsr-status.md-style content transforms correctly', () => {
    const input = [
      '---',
      'description: "[System] Show router state, active preset, and resolved routes"',
      '---',
      '',
      'Run `gsr status` and display the output to the user.',
      '',
      'CONTEXT:',
      '- Working directory: !`echo -n "$(pwd)"`',
      '- Command: !`gsr status`',
    ].join('\n');

    const output = transformForClaudeCode(input);

    // Frontmatter preserved
    assert.ok(output.includes('description: "[System] Show router state, active preset, and resolved routes"'));

    // Inline !` commands (prefixed by other text) get ! stripped but no bash prefix
    assert.ok(output.includes('- Working directory: `echo -n "$(pwd)"`'), 'Inline command should have ! stripped only');
    assert.ok(output.includes('- Command: `gsr status`'), 'Inline command should have ! stripped only');

    // No raw !` left
    assert.ok(!output.includes('!`'), 'Should not contain any raw !`');
  });

  test('content with no ! commands is unchanged', () => {
    const input = [
      '---',
      'description: "A command"',
      '---',
      '',
      'Already in Claude Code format.',
      'Run `gsr sync` using your bash tool.',
    ].join('\n');

    const output = transformForClaudeCode(input);
    assert.equal(output, input, 'Content without ! should be passed through unchanged');
  });
});

// ── deployGsrCommandsClaudeCode ───────────────────────────────────────────────

describe('deployGsrCommandsClaudeCode', () => {
  test('deploys command files to target dir and transforms content', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-claude-test-'));

    try {
      // Create a fake source dir with one command file
      const sourceDir = path.join(tmpDir, 'commands');
      const targetDir = path.join(tmpDir, 'claude-commands');
      fs.mkdirSync(sourceDir, { recursive: true });

      fs.writeFileSync(
        path.join(sourceDir, 'gsr-status.md'),
        '---\ndescription: "test"\n---\n\n- Command: !`gsr status`\n',
        'utf8'
      );

      const result = await deployGsrCommandsClaudeCode(sourceDir, targetDir);

      assert.equal(result.deployed, 1, 'Should deploy 1 file');
      assert.equal(result.skipped, 0, 'Should skip 0 files');
      assert.equal(result.errors.length, 0, 'Should have no errors');

      const deployedContent = fs.readFileSync(path.join(targetDir, 'gsr-status.md'), 'utf8');
      assert.ok(!deployedContent.includes('!`'), 'Deployed file should not contain !`');
      assert.ok(deployedContent.includes('`gsr status`'), 'Deployed file should contain transformed command');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('skips files when content is identical (noop detection)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-claude-noop-'));

    try {
      const sourceDir = path.join(tmpDir, 'commands');
      const targetDir = path.join(tmpDir, 'claude-commands');
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.mkdirSync(targetDir, { recursive: true });

      const rawContent = '---\ndescription: "test"\n---\n\nPlain content, no shell commands.\n';
      fs.writeFileSync(path.join(sourceDir, 'gsr-test.md'), rawContent, 'utf8');

      // Pre-write the already-transformed content to the target
      const transformedContent = transformForClaudeCode(rawContent);
      fs.writeFileSync(path.join(targetDir, 'gsr-test.md'), transformedContent, 'utf8');

      const result = await deployGsrCommandsClaudeCode(sourceDir, targetDir);

      assert.equal(result.deployed, 0, 'Should deploy 0 files (noop)');
      assert.equal(result.skipped, 1, 'Should skip 1 file (identical content)');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('creates target directory if it does not exist', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-claude-mkdir-'));

    try {
      const sourceDir = path.join(tmpDir, 'commands');
      const targetDir = path.join(tmpDir, 'nonexistent', 'nested', 'claude-commands');
      fs.mkdirSync(sourceDir, { recursive: true });

      fs.writeFileSync(path.join(sourceDir, 'gsr-test.md'), 'Hello world.\n', 'utf8');

      const result = await deployGsrCommandsClaudeCode(sourceDir, targetDir);

      assert.ok(fs.existsSync(targetDir), 'Target dir should be created');
      assert.equal(result.deployed, 1, 'Should deploy 1 file');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('returns error when source dir not found', async () => {
    const result = await deployGsrCommandsClaudeCode('/nonexistent/path/commands', '/tmp/target');
    assert.ok(result.errors.length > 0, 'Should have errors');
    assert.equal(result.deployed, 0, 'Should deploy nothing');
  });

  test('deploys multiple files', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-claude-multi-'));

    try {
      const sourceDir = path.join(tmpDir, 'commands');
      const targetDir = path.join(tmpDir, 'claude-commands');
      fs.mkdirSync(sourceDir, { recursive: true });

      fs.writeFileSync(path.join(sourceDir, 'gsr-status.md'), '- !`gsr status`\n', 'utf8');
      fs.writeFileSync(path.join(sourceDir, 'gsr-sync.md'), '- !`gsr sync`\n', 'utf8');
      fs.writeFileSync(path.join(sourceDir, 'gsr-fallback.md'), 'No shell commands here.\n', 'utf8');

      const result = await deployGsrCommandsClaudeCode(sourceDir, targetDir);

      assert.equal(result.deployed, 3, 'Should deploy all 3 files');
      assert.equal(result.skipped, 0, 'Should skip nothing');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── CLAUDE_COMMANDS_DIR ───────────────────────────────────────────────────────

describe('CLAUDE_COMMANDS_DIR', () => {
  test('points to ~/.claude/commands', () => {
    const expected = path.join(os.homedir(), '.claude', 'commands');
    assert.equal(CLAUDE_COMMANDS_DIR, expected);
  });
});

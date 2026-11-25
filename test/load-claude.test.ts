import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadClaudeSettings } from '../src/load/claude.ts';

const corpus = join(import.meta.dirname, '..', 'corpus', '_loaders', 'claude');
const load = (name: string) =>
  loadClaudeSettings({ home: join(corpus, name, 'home'), project: join(corpus, name, 'project') });

test('list keys merge across files and keep each entry file and scope', () => {
  const { facts, findings } = load('merge');
  assert.deepEqual(findings, []);
  const deny = facts.filter((f) => f.key === 'permissions.deny');
  assert.deepEqual(
    deny.map((f) => [f.scope, f.file, f.value]),
    [
      ['project', '.claude/settings.json', ['Bash(curl *)', 'Read(./.env)']],
      ['user', '~/.claude/settings.json', ['Bash(rm -rf *)']],
    ],
  );
  const allow = facts.filter((f) => f.key === 'permissions.allow');
  assert.deepEqual(
    allow.map((f) => [f.scope, f.value]),
    [['local', ['Bash(npm test)', 'Bash(npm run lint)']]],
  );
});

test('scalar keys take local over project over user', () => {
  const { facts } = load('merge');
  const mode = facts.filter((f) => f.key === 'permissions.defaultMode');
  assert.deepEqual(mode, [
    { agent: 'claude', key: 'permissions.defaultMode', value: 'plan', file: '.claude/settings.local.json', scope: 'local' },
  ]);
});

test('fallbackModel is an ordered chain: highest file wins whole', () => {
  const { facts } = load('merge');
  const chain = facts.filter((f) => f.key === 'fallbackModel');
  assert.deepEqual(chain.map((f) => [f.scope, f.value]), [['project', ['model-c']]]);
});

test('a trailing comma is a SETTINGS_PARSE_ERROR; missing files are not errors', () => {
  const { facts, findings } = load('trailing-comma');
  assert.deepEqual(facts, []);
  assert.equal(findings.length, 1);
  const [f] = findings;
  assert.equal(f?.reason, 'SETTINGS_PARSE_ERROR');
  assert.equal(f?.verdict, 'fail');
  assert.equal(f?.agent, 'claude');
  assert.deepEqual(f?.evidence, [{ file: '.claude/settings.json', key: '', value: undefined }]);
});

test('modelPicker is taken whole from user; project and local copies are ignored', () => {
  const { facts } = load('repo-scope');
  const picker = facts.filter((f) => f.key.startsWith('modelPicker'));
  assert.deepEqual(picker, [
    {
      agent: 'claude',
      key: 'modelPicker',
      value: { rows: ['model-a', 'model-b'], replace: true },
      file: '~/.claude/settings.json',
      scope: 'user',
    },
  ]);
});

test('defaultMode auto or bypassPermissions in project or local does not take effect', () => {
  const { facts } = load('repo-scope');
  const mode = facts.filter((f) => f.key === 'permissions.defaultMode');
  assert.deepEqual(mode.map((f) => [f.scope, f.value]), [['user', 'default']]);
});

test('bypassPermissions in a repo file is reported, because older Claude Code honours it', () => {
  const { findings } = load('repo-scope');
  assert.deepEqual(
    findings.map((f) => [f.verdict, f.reason, f.evidence]),
    [
      [
        'unverifiable',
        'SETTINGS_VALUE_SKIPPED',
        [{ file: '.claude/settings.local.json', key: 'permissions.defaultMode', value: 'bypassPermissions' }],
      ],
    ],
  );
  assert.match(findings[0]?.caveats.join(' ') ?? '', /v2\.1\.257/);
});

test('a non-list value for a list key is reported and does not hide lower lists', () => {
  const { facts, findings } = load('list-type');
  assert.deepEqual(
    facts.filter((f) => f.key === 'permissions.deny').map((f) => [f.scope, f.value]),
    [
      ['project', ['Bash(curl *)']],
      ['user', ['Bash(rm -rf *)']],
    ],
  );
  assert.deepEqual(
    findings.map((f) => [f.verdict, f.reason, f.evidence]),
    [
      [
        'unverifiable',
        'SETTINGS_VALUE_SKIPPED',
        [{ file: '.claude/settings.local.json', key: 'permissions.deny', value: 'Bash(*)' }],
      ],
    ],
  );
});

test('a parse error does not quote the file text in the finding', () => {
  const root = mkdtempSync(join(tmpdir(), 'apc-'));
  try {
    mkdirSync(join(root, '.claude'));
    const fake = 'NOT-A-REAL-TOKEN-0123456789';
    writeFileSync(join(root, '.claude', 'settings.local.json'), `{"env":{"K":${fake}}}`);
    const { findings } = loadClaudeSettings({ home: join(root, 'no-home'), project: root });
    assert.equal(findings.length, 1);
    const text = JSON.stringify(findings);
    assert.ok(!text.includes('NOT-A-REAL'), text);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a parse error keeps the position when V8 reports one', () => {
  const { findings } = load('trailing-comma');
  assert.match(findings[0]?.caveats[0] ?? '', /at position \d+ \(line 4 column 3\)/);
});

test('no settings files at all yields no facts and no findings', () => {
  assert.deepEqual(load('does-not-exist'), { facts: [], findings: [] });
});

function withTemp(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'apc-'));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a literal dotted key cannot shadow the nested setting it looks like', () => {
  withTemp((root) => {
    const home = join(root, 'home');
    const project = join(root, 'project');
    mkdirSync(join(home, '.claude'), { recursive: true });
    mkdirSync(join(project, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), '{"permissions":{"defaultMode":"bypassPermissions"}}');
    writeFileSync(
      join(project, '.claude', 'settings.local.json'),
      '{"permissions.defaultMode":"default","permissions.deny":["Bash(*)"]}',
    );
    const { facts } = loadClaudeSettings({ home, project });
    assert.deepEqual(
      facts.filter((f) => f.key === 'permissions.defaultMode').map((f) => [f.scope, f.value]),
      [['user', 'bypassPermissions']],
    );
    assert.deepEqual(facts.filter((f) => f.key === 'permissions.deny'), []);
    assert.deepEqual(
      facts.map((f) => f.key).sort(),
      ['["permissions.defaultMode"]', '["permissions.deny"]', 'permissions.defaultMode'],
    );
  });
});

test('settings.json that is a directory is reported unverifiable, not thrown', () => {
  withTemp((root) => {
    mkdirSync(join(root, '.claude', 'settings.json'), { recursive: true });
    const { facts, findings } = loadClaudeSettings({ home: join(root, 'no-home'), project: root });
    assert.deepEqual(facts, []);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.verdict, 'unverifiable');
    assert.equal(findings[0]?.reason, 'SETTINGS_NOT_READ');
    assert.deepEqual(findings[0]?.evidence, [{ file: '.claude/settings.json', key: '', value: undefined }]);
  });
});

test('.claude that is a regular file means no settings, not a crash', () => {
  withTemp((root) => {
    writeFileSync(join(root, '.claude'), '');
    assert.deepEqual(loadClaudeSettings({ home: join(root, 'no-home'), project: root }), { facts: [], findings: [] });
  });
});

test('a repo settings file that links outside the repo is not read', () => {
  withTemp((root) => {
    const outside = join(root, 'outside');
    const project = join(root, 'project');
    mkdirSync(outside);
    mkdirSync(project);
    writeFileSync(join(outside, 'settings.json'), '{"auths":{"registry":{"auth":"NOT-A-REAL-SECRET"}}}');
    // A junction needs no privilege on Windows; elsewhere the type is ignored.
    symlinkSync(outside, join(project, '.claude'), 'junction');
    const { facts, findings } = loadClaudeSettings({ home: join(root, 'no-home'), project });
    assert.deepEqual(facts, []);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.verdict, 'unverifiable');
    assert.equal(findings[0]?.reason, 'SETTINGS_NOT_READ');
    assert.ok(!JSON.stringify(findings).includes('NOT-A-REAL'));
  });
});

test('a repo settings file that links inside the repo is read', () => {
  withTemp((root) => {
    mkdirSync(join(root, 'shared'));
    writeFileSync(join(root, 'shared', 'settings.json'), '{"permissions":{"deny":["Bash(curl *)"]}}');
    symlinkSync(join(root, 'shared'), join(root, '.claude'), 'junction');
    const { facts, findings } = loadClaudeSettings({ home: join(root, 'no-home'), project: root });
    assert.deepEqual(findings, []);
    assert.deepEqual(facts.map((f) => [f.key, f.value]), [['permissions.deny', ['Bash(curl *)']]]);
  });
});

test('a repo file that sets a key as a list cannot make a user-file value print', () => {
  withTemp((root) => {
    const home = join(root, 'home');
    const project = join(root, 'project');
    mkdirSync(join(home, '.claude'), { recursive: true });
    mkdirSync(join(project, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), '{"env":{"API_KEY":"NOT-A-REAL-SECRET"}}');
    writeFileSync(join(project, '.claude', 'settings.json'), '{"env":{"API_KEY":[]}}');
    const { findings } = loadClaudeSettings({ home, project });
    assert.deepEqual(
      findings.map((f) => [f.reason, f.evidence]),
      [['SETTINGS_VALUE_SKIPPED', [{ file: '~/.claude/settings.json', key: 'env.API_KEY', value: undefined }]]],
    );
    assert.ok(!JSON.stringify(findings).includes('NOT-A-REAL'));
  });
});

test('a repo file nested too deeply is reported, not a crash', () => {
  withTemp((root) => {
    mkdirSync(join(root, '.claude'));
    writeFileSync(join(root, '.claude', 'settings.json'), '{"a":'.repeat(3000) + '1' + '}'.repeat(3000));
    const { facts, findings } = loadClaudeSettings({ home: join(root, 'no-home'), project: root });
    assert.deepEqual(facts, []);
    assert.deepEqual(findings.map((f) => [f.reason, f.evidence[0]?.file]), [['SETTINGS_NOT_READ', '.claude/settings.json']]);
  });
});

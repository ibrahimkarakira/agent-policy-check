import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExpectations } from '../src/parse/expectations.ts';

// One line in, one expectation (id E01, line 1) or one error out.
const valid: [string, Record<string, unknown>][] = [
  ['never run rm -rf', { kind: 'never-run', words: ['rm', '-rf'] }],
  ['NEVER RUN  git   push --force', { kind: 'never-run', words: ['git', 'push', '--force'] }],
  ['git push needs approval', { kind: 'needs-approval', words: ['git', 'push'] }],
  ['mcp__issues__create_issue needs approval', { kind: 'needs-approval', words: ['mcp__issues__create_issue'] }],
  ['never read .env', { kind: 'never-read', glob: '.env' }],
  ['Never Read secrets/**', { kind: 'never-read', glob: 'secrets/**' }],
  ['no network from the sandbox', { kind: 'no-network' }],
  ['never write outside the project', { kind: 'no-write-outside-project' }],
  ['only these mcp servers: docs, issues', { kind: 'mcp-allowlist', servers: ['docs', 'issues'] }],
  ['Only these MCP servers:docs', { kind: 'mcp-allowlist', servers: ['docs'] }],
  ['budget cap 5 usd', { kind: 'budget-cap', amount: 5, unit: 'usd' }],
  ['budget cap 2.50 USD', { kind: 'budget-cap', amount: 2.5, unit: 'usd' }],
  ['budget cap 200000 tokens', { kind: 'budget-cap', amount: 200000, unit: 'tokens' }],
  ['budget cap 9007199254740991 tokens', { kind: 'budget-cap', amount: 9007199254740991, unit: 'tokens' }],
  ['no bypass mode', { kind: 'no-bypass-mode' }],
  ['Hooks Fail Closed', { kind: 'hooks-fail-closed' }],
];

const invalid: [string, string][] = [
  ['please be careful', 'line 1: unrecognised expectation'],
  ['never run', 'line 1: unrecognised expectation'],
  ['needs approval', 'line 1: unrecognised expectation'],
  ['never read', 'line 1: unrecognised expectation'],
  ['only these mcp servers:', 'line 1: only these mcp servers: needs at least one server name'],
  ['only these mcp servers: docs,, issues', 'line 1: only these mcp servers: empty server name'],
  ['budget cap 0 usd', 'line 1: budget cap must be a positive number'],
  ['budget cap 1.5 tokens', 'line 1: budget cap in tokens must be a whole number'],
  [`budget cap ${'9'.repeat(400)} usd`, 'line 1: budget cap is too large'],
  ['budget cap 9007199254740993 tokens', 'line 1: budget cap is too large'],
  ['budget cap 5 euro','line 1: unrecognised expectation'],
  ['never run git push needs approval', 'line 1: ambiguous expectation, matches never-run and needs-approval'],
];

for (const [line, expected] of valid) {
  test(`parses: ${line}`, () => {
    assert.deepEqual(parseExpectations(line), {
      expectations: [{ id: 'E01', line: 1, ...expected }],
      errors: [],
    });
  });
}

for (const [line, error] of invalid) {
  test(`rejects: ${line}`, () => {
    assert.deepEqual(parseExpectations(line), { expectations: [], errors: [error] });
  });
}

test('the roadmap sample parses with ids, comments, blank lines and CRLF', () => {
  const text = [
    '# agent-expectations.txt (synthetic example)',
    '',
    '[no-rm]      never run rm -rf',
    '[push-ask]   git push needs approval',
    '   # indented comment',
    'never read .env',
    '[mcp-set]    only these mcp servers: docs, issues',
  ].join('\r\n');
  const { expectations, errors } = parseExpectations(text);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    expectations.map((e) => [e.id, e.line, e.kind]),
    [
      ['no-rm', 3, 'never-run'],
      ['push-ask', 4, 'needs-approval'],
      ['E03', 6, 'never-read'],
      ['mcp-set', 7, 'mcp-allowlist'],
    ],
  );
});

test('an unknown line is reported with its line number and nothing is silently kept', () => {
  const { errors } = parseExpectations('never run rm -rf\n\nplease be careful\n');
  assert.deepEqual(errors, ['line 3: unrecognised expectation']);
});

test('a duplicate id fails, including a clash with a generated id', () => {
  assert.deepEqual(parseExpectations('[a] no bypass mode\n[a] hooks fail closed').errors, [
    'line 2: duplicate id a (first used on line 1)',
  ]);
  assert.deepEqual(parseExpectations('no bypass mode\n[E01] hooks fail closed').errors, [
    'line 2: duplicate id E01 (first used on line 1)',
  ]);
});

test('a malformed id prefix is an error', () => {
  assert.deepEqual(parseExpectations('[] no bypass mode').errors, ['line 1: unrecognised expectation']);
  assert.deepEqual(parseExpectations('[bad id] no bypass mode').errors, ['line 1: unrecognised expectation']);
});

test('every error in the file is reported, not just the first', () => {
  assert.deepEqual(parseExpectations('be nice\nno bypass mode\nbe kind').errors, [
    'line 1: unrecognised expectation',
    'line 3: unrecognised expectation',
  ]);
});

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

function runCheck(contents: string | null) {
  const dir = mkdtempSync(join(tmpdir(), 'apc-expect-'));
  try {
    const file = join(dir, 'expectations.txt');
    if (contents !== null) writeFileSync(file, contents);
    return spawnSync(process.execPath, [cli, 'check', '--expect', file], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('CLI: a parse error exits 2 with file and line on stderr', () => {
  const r = runCheck('never run rm -rf\n\nplease be careful\n');
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /expectations\.txt: line 3: unrecognised expectation/);
});

test('CLI: a missing expectations file exits 2', () => {
  const r = runCheck(null);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot read expectations file/);
});

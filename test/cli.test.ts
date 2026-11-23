import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

function run(...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

test('--version prints the package version and exits 0', () => {
  const r = run('--version');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), pkg.version);
  assert.equal(r.stdout.trim(), '0.0.1');
});

test('--help lists every command and exits 0', () => {
  const r = run('--help');
  assert.equal(r.status, 0, r.stderr);
  for (const cmd of ['check', 'init', 'list-rules', 'explain']) {
    assert.match(r.stdout, new RegExp(`^\\s+${cmd}\\b`, 'm'), `help is missing ${cmd}`);
  }
});

test('an unknown option is a usage error: exit 2, message on stderr', () => {
  const r = run('--no-such-flag');
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /no-such-flag/);
});

test('an unknown command is a usage error: exit 2', () => {
  const r = run('frobnicate');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown command: frobnicate/);
});

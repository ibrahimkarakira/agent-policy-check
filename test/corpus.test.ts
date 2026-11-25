// Walks corpus/<good|bad|unverifiable>/<case>/: loads the case's settings (the case directory is
// the repo root, `home/` stands in for the home directory), judges every expectation in
// expectations.txt and compares verdict and reason with expected.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding } from '../src/finding.ts';
import { loadClaudeSettings } from '../src/load/claude.ts';
import { parseExpectations } from '../src/parse/expectations.ts';
import { neverRunClaude } from '../src/rules/never-run.ts';

const root = join(import.meta.dirname, '..', 'corpus');
const cases = ['good', 'bad', 'unverifiable']
  .filter((group) => existsSync(join(root, group)))
  .flatMap((group) => readdirSync(join(root, group)).map((name) => join(group, name)));

type Expected = Record<string, { verdict: Finding['verdict']; reason?: string }>;

function judge(dir: string): Expected {
  const { expectations, errors } = parseExpectations(readFileSync(join(dir, 'expectations.txt'), 'utf8'));
  assert.deepEqual(errors, []);
  const { facts, findings } = loadClaudeSettings({ home: join(dir, 'home'), project: dir });
  assert.deepEqual(findings, []);
  const out: Expected = {};
  for (const e of expectations) {
    if (e.kind !== 'never-run') throw new Error(`no rule for ${e.kind} yet`);
    const f = neverRunClaude(e, facts);
    out[f.id] = f.reason === undefined ? { verdict: f.verdict } : { verdict: f.verdict, reason: f.reason };
  }
  return out;
}

let passed = 0;
for (const name of cases) {
  test(`corpus ${name}`, () => {
    const dir = join(root, name);
    const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8')) as Expected;
    assert.deepEqual(judge(dir), expected);
    passed++;
  });
}

test('corpus summary', () => {
  process.stdout.write(`corpus: ${passed}/${cases.length} cases match expected.json\n`);
  assert.ok(cases.length >= 10);
  assert.equal(passed, cases.length);
});

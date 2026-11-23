import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Finding } from '../src/finding.ts';
import { renderText } from '../src/report/text.ts';

// Hand-built findings; every value is invented.
const findings: Finding[] = [
  {
    id: 'no-rm',
    rule: 'never-run',
    agent: 'claude',
    verdict: 'pass',
    evidence: [{ file: '.claude/settings.json', key: 'permissions.deny', value: ['Bash(rm -rf *)'] }],
    caveats: ['Deny rules match the command form, not every way to delete files'],
    docs: ['https://code.claude.com/docs/en/permissions'],
  },
  {
    id: 'no-yolo',
    rule: 'no-bypass',
    agent: 'claude',
    verdict: 'fail',
    reason: 'NO_MECHANISM',
    evidence: [{ file: '.claude/settings.json', key: 'permissions.disableBypassPermissionsMode', value: null }],
    caveats: [],
    docs: ['https://code.claude.com/docs/en/settings-reference'],
  },
  {
    id: 'hooks',
    rule: 'hooks-fail-closed',
    agent: 'codex',
    verdict: 'unverifiable',
    reason: 'HOOK_SCRIPT_OPAQUE',
    evidence: [],
    caveats: [],
    docs: [],
  },
];

function golden(name: string): string {
  return readFileSync(new URL(`./golden/${name}`, import.meta.url), 'utf8');
}

test('text report: one line per finding plus a summary', () => {
  assert.equal(renderText(findings), golden('text-default.txt'));
});

test('text report --verbose: evidence, caveats and docs under each finding', () => {
  assert.equal(renderText(findings, { verbose: true }), golden('text-verbose.txt'));
});

test('text report with no findings still prints the summary', () => {
  assert.equal(renderText([]), 'summary: 0 pass, 0 fail, 0 unverifiable\n');
});

test('control and bidi characters from config files are escaped, not printed raw', () => {
  const hostile: Finding = {
    id: 'x\u001b[2Jy',
    rule: 'never-run',
    agent: 'claude',
    verdict: 'fail',
    reason: 'NO_MECHANISM',
    evidence: [{ file: 'a\u202eb.json', key: 'k\r\nFAKE', value: 'v\u001b]0;t\u0007' }],
    caveats: ['c\u061cd'],
    docs: [],
  };
  const out = renderText([hostile], { verbose: true });
  assert.doesNotMatch(out, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/);
  assert.match(out, /x\\u001b\[2Jy/);
  assert.match(out, /caveat: c\\u061cd/);
  assert.match(out, /a\\u202eb\.json k\\u000d\\u000aFAKE = /);
});

test('evidence values that JSON cannot encode still print', () => {
  const f: Finding = {
    id: 'cap',
    rule: 'budget-cap',
    agent: 'codex',
    verdict: 'pass',
    evidence: [
      { file: '.codex/config.toml', key: 'features.rollout_budget.limit_tokens', value: 10n },
      { file: '.codex/config.toml', key: 'missing', value: undefined },
    ],
    caveats: [],
    docs: [],
  };
  const out = renderText([f], { verbose: true });
  assert.match(out, /limit_tokens = 10\n/);
  assert.match(out, /missing = undefined\n/);
});

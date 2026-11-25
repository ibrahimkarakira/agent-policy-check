import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Fact } from '../src/facts.ts';
import { bashRuleMatches, neverRunClaude } from '../src/rules/never-run.ts';

// Each row applies a matching rule stated on https://code.claude.com/docs/en/permissions
// ("Wildcard patterns", "Tool name wildcards", "Match all uses of a tool") to `rm -rf`; the page's
// own rows use npm, git and ls.
const cases: [rule: string, command: string, matches: boolean][] = [
  ['Bash(rm -rf *)', 'rm -rf', true], // trailing ` *` also matches the bare command
  ['Bash(rm -rf *)', 'rm -rf /tmp/x', true],
  ['Bash(rm -rf:*)', 'rm -rf', true], // `:*` is the same trailing wildcard
  ['Bash(rm -rf)', 'rm -rf', true], // no `*`: one exact command
  ['Bash(rm -rf)', 'rm -rf /tmp/x', false],
  ['Bash(rm *)', 'rm -rf', true],
  ['Bash(rm -r *)', 'rm -rf', false], // the space before `*` is part of the rule
  ['Bash(rm -r*)', 'rm -rf', true], // as `Bash(ls*)` matches `lsof`
  ['Bash(ls *)', 'lsof', false],
  ['Bash(* -rf *)', 'rm -rf', false], // not the only wildcard: no bare-command match
  ['Bash(* -rf)', 'rm -rf', true],
  ['Bash(rm:* -rf)', 'rm -rf', false], // `:*` only counts at the end; here the colon is literal
  ['Bash', 'rm -rf', true],
  ['Bash(*)', 'rm -rf', true],
];

// Assumptions the page does not state; kept so a change in behaviour is visible.
const assumed: [rule: string, command: string, matches: boolean][] = [
  ['Bash(RM -RF *)', 'rm -rf', false], // [UNCLEAR] the page states case rules only for PowerShell and WebFetch
  ['Bash(rm.* *)', 'rm -rf', false], // `*` is the only wildcard, so regex characters are literal
  ['Read(rm -rf *)', 'rm -rf', false], // a rule for another tool never matches a Bash command
];

for (const [rule, command, matches] of [...cases, ...assumed]) {
  test(`${rule} ${matches ? 'matches' : 'does not match'} ${command}`, () => {
    assert.equal(bashRuleMatches(rule, command), matches);
  });
}

test('tool-name globs count only where the page allows them (deny and ask)', () => {
  for (const rule of ['*', 'B*', 'Ba*h']) assert.equal(bashRuleMatches(rule, 'rm -rf', true), true, rule);
  for (const rule of ['*', 'B*']) assert.equal(bashRuleMatches(rule, 'rm -rf'), false, rule);
  for (const rule of ['mcp__*', 'Bas', 'R*']) assert.equal(bashRuleMatches(rule, 'rm -rf', true), false, rule);
});

test('a rule of many wildcards and a missing literal is judged without exponential blow-up', () => {
  const t = Date.now();
  assert.equal(bashRuleMatches(`Bash(${'*'.repeat(50)}X)`, 'rm -rf /tmp/some/longer/path'), false);
  assert.equal(bashRuleMatches(`Bash(${'*a'.repeat(25)}X)`, 'a'.repeat(200)), false);
  assert.ok(Date.now() - t < 200, `took ${Date.now() - t} ms`);
});

const fact = (key: string, value: unknown, file = '.claude/settings.json'): Fact => ({
  agent: 'claude',
  key,
  value,
  file,
  scope: 'project',
});
const exp = { id: 'no-rm', kind: 'never-run', words: ['rm', '-rf'] } as const;

test('a matching deny rule passes, cites permissions.deny and carries the bypass caveat', () => {
  const f = neverRunClaude(exp, [fact('permissions.deny', ['Bash(curl *)', 'Bash(rm -rf *)'])]);
  assert.equal(f.verdict, 'pass');
  assert.equal(f.reason, undefined);
  assert.deepEqual(f.evidence, [{ file: '.claude/settings.json', key: 'permissions.deny', value: 'Bash(rm -rf *)' }]);
  assert.match(f.caveats[0] ?? '', /isn't a security boundary/);
  assert.ok(JSON.stringify(f).includes("isn't a security boundary"));
});

test('deny wins even when an allow rule in another file also matches', () => {
  const f = neverRunClaude(exp, [
    fact('permissions.allow', ['Bash(rm -rf build)'], '.claude/settings.local.json'),
    fact('permissions.deny', ['Bash(rm *)'], '~/.claude/settings.json'),
  ]);
  assert.equal(f.verdict, 'pass');
});

test('deny "*" removes every tool, Bash included: pass', () => {
  const f = neverRunClaude(exp, [fact('permissions.deny', ['*'])]);
  assert.equal(f.verdict, 'pass');
  assert.deepEqual(f.evidence, [{ file: '.claude/settings.json', key: 'permissions.deny', value: '*' }]);
});

test('a deny rule that matches only the bare command, not its arguments: fail RULE_TOO_WEAK', () => {
  for (const rule of ['Bash(rm -rf)', 'Bash(* -rf)']) {
    const f = neverRunClaude(exp, [fact('permissions.deny', [rule])]);
    assert.equal(f.verdict, 'fail', rule);
    assert.equal(f.reason, 'RULE_TOO_WEAK', rule);
    assert.deepEqual(f.evidence, [{ file: '.claude/settings.json', key: 'permissions.deny', value: rule }]);
  }
});

test('a rule that names the command with only some arguments: fail RULE_TOO_WEAK with evidence', () => {
  for (const [key, rule] of [
    ['permissions.deny', 'Bash(rm -rf /tmp *)'],
    ['permissions.ask', 'Bash(rm -rf build)'],
    ['permissions.allow', 'Bash(rm -rf build)'],
  ] as const) {
    const f = neverRunClaude(exp, [fact(key, [rule])]);
    assert.equal(f.verdict, 'fail', rule);
    assert.equal(f.reason, 'RULE_TOO_WEAK', rule);
    assert.deepEqual(f.evidence, [{ file: '.claude/settings.json', key, value: rule }]);
  }
});

test('only allow or ask covers it: fail RULE_TOO_WEAK', () => {
  for (const key of ['permissions.allow', 'permissions.ask']) {
    const f = neverRunClaude(exp, [fact(key, ['Bash(rm -rf *)'])]);
    assert.equal(f.verdict, 'fail');
    assert.equal(f.reason, 'RULE_TOO_WEAK');
    assert.deepEqual(f.evidence, [{ file: '.claude/settings.json', key, value: 'Bash(rm -rf *)' }]);
  }
});

test('ask "*" is weaker than deny; allow "*" is skipped by Claude Code', () => {
  assert.equal(neverRunClaude(exp, [fact('permissions.ask', ['*'])]).reason, 'RULE_TOO_WEAK');
  assert.equal(neverRunClaude(exp, [fact('permissions.allow', ['*'])]).reason, 'NO_MECHANISM');
});

test('nothing covers it: fail NO_MECHANISM; non-string and non-list values are ignored', () => {
  const f = neverRunClaude(exp, [fact('permissions.deny', [42, 'Bash(rm -r *)']), fact('permissions.ask', 'Bash')]);
  assert.equal(f.verdict, 'fail');
  assert.equal(f.reason, 'NO_MECHANISM');
});

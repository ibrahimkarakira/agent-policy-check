// never-run, Claude Code branch: `never run rm -rf` holds at form level when a rule in the merged
// `permissions.deny` matches `rm -rf` and also `rm -rf` followed by arguments. A deny rule that
// matches only the bare command (`Bash(rm -rf)`, `Bash(* -rf)`) or only some arguments
// (`Bash(rm -rf /tmp *)`) leaves `rm -rf /` allowed, so it is RULE_TOO_WEAK. Matching follows https://code.claude.com/docs/en/permissions ("Wildcard patterns",
// "Tool name wildcards", "Match all uses of a tool"):
//   - `Bash` and `Bash(*)` match every command;
//   - in deny and ask, a bare tool-name glob that matches `Bash` (for example `*`) does too;
//     allow skips such globs;
//   - `*` stands for any text; everything else is literal ([UNCLEAR] whether Bash matching is
//     case-sensitive: the page does not say; we compare case-sensitively);
//   - a trailing ` *` that is the rule's only wildcard also matches the bare command
//     (`Bash(rm -rf *)` matches `rm -rf`); the space is part of the rule;
//   - a trailing `:*` is the same as ` *`; a `:*` anywhere else is literal.
// Deny is evaluated before ask and allow, so an allow rule can never weaken a matching deny.
// Hooks are not judged here yet (D06).
import type { Fact } from '../facts.ts';
import type { Evidence, Finding } from '../finding.ts';

const DOCS = [
  'https://code.claude.com/docs/en/permissions#wildcard-patterns',
  'https://code.claude.com/docs/en/permissions#bash-rule-limits',
];

// Quoted from the permissions page, "What a Bash rule doesn't match".
const CAVEAT =
  'Judged at form level. A Bash rule matches the command text Claude writes, after Claude Code splits ' +
  'compound commands and strips wrappers. It does not match the same program invoked in a different form ' +
  '(for example by path or inside sh -c), so a deny rule covers the invocation Claude usually ' +
  "produces and isn't a security boundary around the program.";

// `*` matches any text, everything else is literal. Greedy two-pointer match that backtracks only
// to the last `*`: O(pattern * text), so a hostile rule from a repo settings file cannot stall it.
function globMatches(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] !== '*' && pattern[p] === text[t]) {
      p++;
      t++;
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p++;
      mark = t;
    } else if (star >= 0) {
      p = star + 1;
      t = ++mark;
    } else {
      return false;
    }
  }
  while (pattern[p] === '*') p++;
  return p === pattern.length;
}

// The pattern inside `Bash(...)`, with a trailing `:*` rewritten to ` *`; undefined for other rules.
function bashPattern(rule: string): string | undefined {
  const m = /^Bash\((.*)\)$/s.exec(rule);
  if (!m) return undefined;
  const pattern = m[1] ?? '';
  return pattern.endsWith(':*') ? `${pattern.slice(0, -2)} *` : pattern;
}

// toolGlobs: the rule comes from deny or ask, where a bare tool-name glob such as `*` is honoured.
export function bashRuleMatches(rule: string, command: string, toolGlobs = false): boolean {
  if (rule === 'Bash') return true;
  if (toolGlobs && !rule.includes('(') && globMatches(rule, 'Bash')) return true;
  const pattern = bashPattern(rule);
  if (pattern === undefined) return false;
  const stars = pattern.split('*').length - 1;
  if (stars === 1 && pattern.endsWith(' *') && command === pattern.slice(0, -2)) return true;
  return globMatches(pattern, command);
}

// A rule covers the command form when it matches the bare command and the command with
// arguments. Two argument strings ending in different characters rule out a pattern that ends
// in a literal, so only a trailing wildcard (or a whole-tool rule) passes.
function covers(rule: string, command: string): boolean {
  return [command, `${command} x`, `${command} /`].every((c) => bashRuleMatches(rule, c, true));
}

// A rule names the command when it matches the bare command or its pattern starts with the
// command plus a space (`Bash(rm -rf /tmp *)`, `Bash(rm -rf build)`): it covers some of the
// command's uses, so it is shown as RULE_TOO_WEAK evidence rather than hidden behind NO_MECHANISM.
// ponytail: a literal-prefix test; a rule that reaches the command only through a leading `*`
// with arguments (`Bash(* -rf /tmp)`) still reads as NO_MECHANISM. Glob intersection if it matters.
function names(rule: string, command: string, toolGlobs: boolean): boolean {
  return bashRuleMatches(rule, command, toolGlobs) || (bashPattern(rule)?.startsWith(`${command} `) ?? false);
}

// Every rule string under `key` that satisfies `test`, with the file it came from.
function matching(facts: readonly Fact[], key: string, test: (rule: string) => boolean): Evidence[] {
  return facts
    .filter((f) => f.agent === 'claude' && f.key === key && Array.isArray(f.value))
    .flatMap((f) =>
      (f.value as unknown[])
        .filter((r): r is string => typeof r === 'string' && test(r))
        .map((value) => ({ file: f.file, key, value })),
    );
}

export function neverRunClaude(
  expectation: { readonly id: string; readonly words: readonly string[] },
  facts: readonly Fact[],
): Finding {
  const command = expectation.words.join(' ');
  const base = { id: expectation.id, rule: 'never-run', agent: 'claude', caveats: [CAVEAT], docs: DOCS } as const;
  const deny = matching(facts, 'permissions.deny', (r) => covers(r, command));
  if (deny.length > 0) return { ...base, verdict: 'pass', evidence: deny };
  const weaker = [
    ...matching(facts, 'permissions.deny', (r) => names(r, command, true)),
    ...matching(facts, 'permissions.ask', (r) => names(r, command, true)),
    ...matching(facts, 'permissions.allow', (r) => names(r, command, false)),
  ];
  if (weaker.length > 0) return { ...base, verdict: 'fail', reason: 'RULE_TOO_WEAK', evidence: weaker };
  return { ...base, verdict: 'fail', reason: 'NO_MECHANISM', evidence: [] };
}

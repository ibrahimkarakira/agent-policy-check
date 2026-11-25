import type { Agent, Fact } from './facts.ts';

// pass: the files read declare a mechanism the vendor documents as enforcing the
//   expectation, and nothing in those files overrides it.
// fail: a file read contradicts the expectation, or no mechanism is declared.
// unverifiable: the answer depends on something we cannot read (managed settings,
//   hook script contents, OS support, a CLI-only flag).
export type Verdict = 'pass' | 'fail' | 'unverifiable';

// Stable strings: users may match on them, so never rename one; add new ones.
export type ReasonCode =
  | 'NO_MECHANISM'
  | 'MANAGED_NOT_PROVIDED'
  | 'HOOK_SCRIPT_OPAQUE'
  | 'PLATFORM_UNSUPPORTED'
  | 'NO_CONFIG_FOUND'
  | 'SETTINGS_PARSE_ERROR'
  | 'SETTINGS_NOT_READ'
  | 'SETTINGS_VALUE_SKIPPED'
  // A rule names the command but in `allow` or `ask`, not `deny`, or a `deny` rule matches only
  // the bare command or only some of its arguments (`Bash(rm -rf /tmp *)`), not every use.
  | 'RULE_TOO_WEAK';

// The part of a Fact a finding cites. value is undefined when the key is absent.
export type Evidence = Pick<Fact, 'file' | 'key' | 'value'>;

export interface Finding {
  // Expectation id from the expectations file, for example `no-net`.
  readonly id: string;
  // Rule module that judged it, for example `no-network`.
  readonly rule: string;
  readonly agent: Agent;
  readonly verdict: Verdict;
  // Why it is not a plain pass. Absent on most passes.
  readonly reason?: ReasonCode;
  readonly evidence: readonly Evidence[];
  readonly caveats: readonly string[];
  readonly docs: readonly string[];
}

import type { Evidence, Finding, Verdict } from '../finding.ts';

export interface TextOptions {
  readonly verbose?: boolean;
}

const VERDICTS: readonly Verdict[] = ['pass', 'fail', 'unverifiable'];

// C0, DEL, C1, and every bidi formatting character in Unicode UAX #9 section 2
// (ALM, LRM, RLM, LRE..RLO, LRI..PDI), the class abused by "Trojan Source"
// (CVE-2021-42574, https://trojansource.codes/). Escapes only, so the set is
// readable here. Every string can come from a config file someone else wrote.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function escape(s: string): string {
  return s.replace(UNSAFE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'bigint') return `${value}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return '[unprintable]';
  }
}

function line(f: Finding): string {
  const reason = f.reason ? `: ${f.reason}` : '';
  return `${f.verdict.toUpperCase().padEnd(12)}  ${f.agent.padEnd(6)}  ${escape(f.id)} (${escape(f.rule)})${reason}`;
}

function evidenceLine(e: Evidence): string {
  return `    evidence: ${escape(e.file)} ${escape(e.key)} = ${escape(formatValue(e.value))}`;
}

function details(f: Finding): string[] {
  return [
    ...f.evidence.map(evidenceLine),
    ...f.caveats.map((c) => `    caveat: ${escape(c)}`),
    ...f.docs.map((d) => `    docs: ${escape(d)}`),
  ];
}

// One line per finding, then a summary line. --verbose adds evidence, caveats and docs.
export function renderText(findings: readonly Finding[], options: TextOptions = {}): string {
  const lines = findings.flatMap((f) => (options.verbose ? [line(f), ...details(f)] : [line(f)]));
  const counts = VERDICTS.map((v) => `${findings.filter((f) => f.verdict === v).length} ${v}`);
  return [...lines, `summary: ${counts.join(', ')}`].join('\n') + '\n';
}

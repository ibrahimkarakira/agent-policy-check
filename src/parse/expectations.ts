// Parses an expectations file: one plain-language line per expectation, a fixed set of
// phrases, nothing inferred. Grammar (phrases case-insensitive; command words, globs and
// server names keep their case):
//   never run <command words>              never read <path glob>
//   <tool or command words> needs approval no network from the sandbox
//   never write outside the project        only these mcp servers: <name>, <name>
//   budget cap <number> usd|tokens         no bypass mode
//   hooks fail closed
// Optional `[id]` prefix (letters, digits, `.`, `_`, `-`); without one the id is `E01`,
// `E02`, ... by position among the expectations. Blank lines and lines starting with `#`
// are skipped; `#` later in a line is not a comment. Anything else is an error with its
// line number: an unknown line is never silently ignored.

export type ExpectationBody =
  | { readonly kind: 'never-run'; readonly words: readonly string[] }
  | { readonly kind: 'needs-approval'; readonly words: readonly string[] }
  | { readonly kind: 'never-read'; readonly glob: string }
  | { readonly kind: 'no-network' }
  | { readonly kind: 'no-write-outside-project' }
  | { readonly kind: 'mcp-allowlist'; readonly servers: readonly string[] }
  | { readonly kind: 'budget-cap'; readonly amount: number; readonly unit: 'usd' | 'tokens' }
  | { readonly kind: 'no-bypass-mode' }
  | { readonly kind: 'hooks-fail-closed' };

export type Expectation = { readonly id: string; readonly line: number } & ExpectationBody;

export interface Parsed {
  readonly expectations: readonly Expectation[];
  // `line N: message`, in file order. Empty when the file is valid.
  readonly errors: readonly string[];
}

// A phrase returns the body, an error message, or null when the line is not this phrase.
type Phrase = (text: string, words: readonly string[]) => ExpectationBody | string | null;

const fixed =
  (phrase: string, body: ExpectationBody): Phrase =>
  (text) =>
    text.toLowerCase() === phrase ? body : null;

const PHRASES: readonly Phrase[] = [
  fixed('no network from the sandbox', { kind: 'no-network' }),
  fixed('never write outside the project', { kind: 'no-write-outside-project' }),
  fixed('no bypass mode', { kind: 'no-bypass-mode' }),
  fixed('hooks fail closed', { kind: 'hooks-fail-closed' }),
  (text, words) =>
    words.length > 2 && /^never run /i.test(text) ? { kind: 'never-run', words: words.slice(2) } : null,
  (text, words) =>
    words.length > 2 && /^never read /i.test(text) ? { kind: 'never-read', glob: words.slice(2).join(' ') } : null,
  (text, words) =>
    words.length > 2 && / needs approval$/i.test(text) ? { kind: 'needs-approval', words: words.slice(0, -2) } : null,
  (text) => {
    const m = /^only these mcp servers:(.*)$/i.exec(text);
    if (!m) return null;
    const list = (m[1] ?? '').trim();
    if (list === '') return 'only these mcp servers: needs at least one server name';
    const servers = list.split(',').map((s) => s.trim());
    if (servers.includes('')) return 'only these mcp servers: empty server name';
    return { kind: 'mcp-allowlist', servers };
  },
  (text) => {
    const m = /^budget cap (\d+(?:\.\d+)?) (usd|tokens)$/i.exec(text);
    if (!m) return null;
    const amount = Number(m[1]);
    const unit = m[2]?.toLowerCase() === 'usd' ? 'usd' : 'tokens';
    if (!Number.isFinite(amount)) return 'budget cap is too large';
    if (!(amount > 0)) return 'budget cap must be a positive number';
    if (unit === 'tokens' && !Number.isInteger(amount)) return 'budget cap in tokens must be a whole number';
    // Above 2^53 - 1 a token count is silently rounded, so the cap would not be the one written.
    if (unit === 'tokens' && !Number.isSafeInteger(amount)) return 'budget cap is too large';
    return { kind: 'budget-cap', amount, unit };
  },
];

const ID_PREFIX = /^\[([A-Za-z0-9._-]+)\]\s*(.*)$/;

export function parseExpectations(source: string): Parsed {
  const expectations: Expectation[] = [];
  const errors: string[] = [];
  const idLines = new Map<string, number>();

  source.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;

    let rest = trimmed;
    let id: string | undefined;
    if (rest.startsWith('[')) {
      const m = ID_PREFIX.exec(rest);
      if (!m) {
        errors.push(`line ${line}: unrecognised expectation`);
        return;
      }
      id = m[1];
      rest = m[2] ?? '';
    }

    const words = rest.split(/\s+/).filter((w) => w !== '');
    const text = words.join(' ');
    const matches = PHRASES.map((phrase) => phrase(text, words)).filter((r) => r !== null);
    if (matches.length === 0) {
      errors.push(`line ${line}: unrecognised expectation`);
      return;
    }
    if (matches.length > 1) {
      const kinds = matches.map((r) => (typeof r === 'string' ? '?' : r.kind)).join(' and ');
      errors.push(`line ${line}: ambiguous expectation, matches ${kinds}`);
      return;
    }
    const body = matches[0]!;
    if (typeof body === 'string') {
      errors.push(`line ${line}: ${body}`);
      return;
    }

    const finalId = id ?? `E${String(expectations.length + 1).padStart(2, '0')}`;
    const first = idLines.get(finalId);
    if (first !== undefined) {
      errors.push(`line ${line}: duplicate id ${finalId} (first used on line ${first})`);
      return;
    }
    idLines.set(finalId, line);
    expectations.push({ id: finalId, line, ...body });
  });

  return errors.length > 0 ? { expectations: [], errors } : { expectations, errors };
}

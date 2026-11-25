// Reads the three Claude Code settings files a repository and its user control and
// turns them into Facts, merged the way Claude Code merges them
// (https://code.claude.com/docs/en/settings#settings-precedence):
//   - scalar keys: the highest-precedence file wins (local over project over user);
//   - list keys: concatenated across files, duplicates dropped ("Lists merge instead
//     of overriding"); each Fact keeps the entries its own file contributed;
//   - objects: merged key by key, so every leaf is judged on its own.
// Exceptions handled (same page, "Lists merge instead of overriding" and "The file can't
// set that value"):
//   - fallbackModel and modelPicker are taken whole from the highest file, never merged;
//   - modelPicker, and permissions.defaultMode `auto` / `bypassPermissions`, are ignored
//     in project and local files, so the next lower file wins. A dropped `bypassPermissions`
//     is still reported (SETTINGS_VALUE_SKIPPED): versions before v2.1.257 honour it;
//   - a non-list value for a key another file sets as a list is reported and skipped, so
//     it never hides the lower files' lists.
// Not handled: modelSettings (resolved per model together with effortLevel; merged key by
// key here) and telemetry variables in a project or local `env` block, which Claude Code
// ignores. availableModels only differs when managed settings set it.
// Managed settings and --settings are not read here.
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { Fact, Scope } from '../facts.ts';
import type { Finding } from '../finding.ts';

export interface ClaudeRoots {
  // Directory that holds `.claude/settings.json` for the user scope (the home directory).
  readonly home: string;
  // Repository root.
  readonly project: string;
}

export interface Loaded {
  readonly facts: readonly Fact[];
  readonly findings: readonly Finding[];
}

const DOCS = 'https://code.claude.com/docs/en/settings';

// Highest precedence first.
const SOURCES: readonly { scope: Scope; root: keyof ClaudeRoots; name: string; shown: string }[] = [
  { scope: 'local', root: 'project', name: 'settings.local.json', shown: '.claude/settings.local.json' },
  { scope: 'project', root: 'project', name: 'settings.json', shown: '.claude/settings.json' },
  { scope: 'user', root: 'home', name: 'settings.json', shown: '~/.claude/settings.json' },
];

// Keys taken whole from the highest file that sets them: never merged, never flattened.
const WHOLE_VALUES = new Set(['fallbackModel', 'modelPicker']);

// Values Claude Code ignores when they come from a project or local file.
function ignoredInRepoFile(key: string, value: unknown): boolean {
  if (key === 'modelPicker') return true;
  return key === 'permissions.defaultMode' && (value === 'auto' || value === 'bypassPermissions');
}

export function loadClaudeSettings(roots: ClaudeRoots): Loaded {
  const facts: Fact[] = [];
  const findings: Finding[] = [];
  // Per Fact key: the entries already contributed (lists) or null (scalar taken).
  const seen = new Map<string, Set<string> | null>();

  const files: { src: (typeof SOURCES)[number]; entries: [string, unknown][] }[] = [];
  for (const src of SOURCES) {
    const read = readSettings(src, roots);
    if (read === undefined) continue;
    if ('finding' in read) findings.push(read.finding);
    else {
      const entries = leaves(read.settings, '', 0);
      if (entries === undefined) findings.push(notRead(src.shown, `nests objects deeper than ${MAX_DEPTH} levels`));
      else files.push({ src, entries });
    }
  }
  // A key some file sets as a list is a list key; a non-list value for it elsewhere is one
  // the schema rejects. It must not displace the lists below it.
  // ponytail: no schema, so if the list is the wrong one (a scalar key set to a list),
  // the valid scalar is the one reported; ship the schema's key types if that bites.
  const listKeys = new Set(
    files.flatMap((f) => f.entries.filter(([k, v]) => Array.isArray(v) && !WHOLE_VALUES.has(k)).map(([k]) => k)),
  );

  for (const { src, entries } of files) {
    for (const [key, value] of entries) {
      const fact = (v: unknown): Fact => ({ agent: 'claude', key, value: v, file: src.shown, scope: src.scope });
      if (src.scope !== 'user' && ignoredInRepoFile(key, value)) {
        if (value === 'bypassPermissions') findings.push(olderVersionsHonour(src.shown, key, value));
        continue;
      }
      if (listKeys.has(key) && !Array.isArray(value)) {
        // A repo file alone can make a key a list key, so never echo a user-file value here:
        // `"env": {"API_KEY": []}` in the repo would otherwise print the user's API_KEY.
        findings.push(notAList(src.shown, key, src.scope === 'user' ? undefined : value));
        continue;
      }
      const prior = seen.get(key);
      if (Array.isArray(value) && !WHOLE_VALUES.has(key) && prior !== null) {
        const taken = prior ?? new Set<string>();
        const fresh = value.filter((v) => !taken.has(JSON.stringify(v)));
        for (const v of fresh) taken.add(JSON.stringify(v));
        seen.set(key, taken);
        // An explicit empty list is kept as a fact (unset and empty can differ);
        // a list whose entries all came from a higher file adds nothing.
        if (fresh.length > 0 || value.length === 0) facts.push(fact(fresh));
      } else if (prior === undefined) {
        seen.set(key, null);
        facts.push(fact(value));
      }
    }
  }
  return { facts, findings };
}

type ReadResult = { readonly settings: Record<string, unknown> } | { readonly finding: Finding } | undefined;

// undefined: no file. A finding: a file Claude Code would not load, or one we did not read.
function readSettings(src: (typeof SOURCES)[number], roots: ClaudeRoots): ReadResult {
  let text: string;
  try {
    const real = realpathSync(join(roots[src.root], '.claude', src.name));
    // The repo controls its own files: a symlink or junction out of it could point at
    // runner secrets, which would then be printed as facts. Never read those.
    if (src.root === 'project' && !isInside(realpathSync(roots.project), real)) {
      return { finding: notRead(src.shown, 'resolves to a path outside the repository (symlink or junction)') };
    }
    text = readFileSync(real, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    // No file, or `.claude` is not a directory: Claude Code finds nothing to load either.
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;
    return { finding: notRead(src.shown, `could not be read (${code ?? 'unknown error'})`) };
  }
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value)
      ? { settings: value }
      : { finding: parseError(src.shown, 'top level is not a JSON object') };
  } catch (e) {
    return { finding: parseError(src.shown, e instanceof Error ? e.message : String(e)) };
  }
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '' && !isAbsolute(rel) && rel.split(sep)[0] !== '..';
}

// No real setting nests anywhere near this; a repo file that does would otherwise blow the
// call stack (JSON.parse accepts far deeper nesting) and crash the whole audit.
const MAX_DEPTH = 64;

// undefined: the file nests deeper than MAX_DEPTH.
function leaves(obj: Record<string, unknown>, prefix: string, depth: number): [string, unknown][] | undefined {
  if (depth > MAX_DEPTH) return undefined;
  const out: [string, unknown][] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = keyOf(prefix, k);
    if (!isObject(v) || WHOLE_VALUES.has(key)) {
      out.push([key, v]);
      continue;
    }
    const inner = leaves(v, key, depth + 1);
    if (inner === undefined) return undefined;
    for (const e of inner) out.push(e);
  }
  return out;
}

// Plain segments join with '.'. A segment holding '.', '[', ']' or '"' (or an empty one)
// is written as ["..."], so a literal top-level "permissions.defaultMode" key, which
// Claude Code ignores, can never yield the same Fact key as the nested setting.
function keyOf(prefix: string, k: string): string {
  if (!/^[^.[\]"]+$/.test(k)) return `${prefix}[${JSON.stringify(k)}]`;
  return prefix ? `${prefix}.${k}` : k;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// The parser's message can quote the file's text (a secret in `env`, or whatever a
// symlinked file holds), so only the position is kept.
function parseError(file: string, message: string): Finding {
  const where = /at position \d+(?: \(line \d+ column \d+\))?/.exec(message)?.[0];
  const detail = where ? `not valid JSON ${where}` : 'not valid JSON';
  return {
    id: 'settings-file',
    rule: 'load-claude',
    agent: 'claude',
    verdict: 'fail',
    reason: 'SETTINGS_PARSE_ERROR',
    evidence: [{ file, key: '', value: undefined }],
    caveats: [
      `Not a strict JSON object (${detail}). Claude Code does not load this file, so nothing in it is in effect.`,
    ],
    docs: [`${DOCS}#fix-a-broken-settings-file`],
  };
}

function valueSkipped(file: string, key: string, value: unknown, caveat: string, anchor: string): Finding {
  return {
    id: 'settings-file',
    rule: 'load-claude',
    agent: 'claude',
    verdict: 'unverifiable',
    reason: 'SETTINGS_VALUE_SKIPPED',
    evidence: [{ file, key, value }],
    caveats: [caveat],
    docs: [`${DOCS}#${anchor}`],
  };
}

// https://code.claude.com/docs/en/settings, "The file can't set that value".
function olderVersionsHonour(file: string, key: string, value: unknown): Finding {
  return valueSkipped(
    file,
    key,
    value,
    'Claude Code v2.1.257 and later ignore this value in a project or local file, so it is not a fact here. ' +
      'Before v2.1.257 it took effect from any file and turns off permission prompts.',
    'a-value-you-set-is-ignored',
  );
}

// Same page, "Fix a broken settings file": a value the schema rejects is skipped, or the
// whole file does not load; either way it does not replace the lists in lower files.
function notAList(file: string, key: string, value: unknown): Finding {
  return valueSkipped(
    file,
    key,
    value,
    'Another settings file sets this key as a list, but this file does not. Claude Code rejects the value ' +
      '(skipping it or the whole file), so it was not merged; the other files still apply.' +
      (value === undefined ? ' The value is not shown: it comes from your user file.' : ''),
    'fix-a-broken-settings-file',
  );
}

function notRead(file: string, detail: string): Finding {
  return {
    id: 'settings-file',
    rule: 'load-claude',
    agent: 'claude',
    verdict: 'unverifiable',
    reason: 'SETTINGS_NOT_READ',
    evidence: [{ file, key: '', value: undefined }],
    caveats: [`This file ${detail}, so its content was not checked.`],
    docs: [`${DOCS}#settings-files`],
  };
}

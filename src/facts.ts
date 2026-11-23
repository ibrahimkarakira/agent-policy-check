// The normalised view of every config file read. Loaders produce Facts, rules
// read them, reporters cite them as evidence. Nothing here executes config.

export type Agent = 'claude' | 'codex';

// Where a value came from. user, project, local and managed are the Claude Code
// settings scopes; cli is the command-line layer (for example --settings), which
// sits above the files and below managed (https://code.claude.com/docs/en/settings).
export type Scope = 'user' | 'project' | 'local' | 'managed' | 'cli';

export interface Fact {
  readonly agent: Agent;
  // Dotted path inside the file, for example `permissions.deny`.
  readonly key: string;
  // As parsed from the file. Untrusted: reporters must escape it before printing.
  readonly value: unknown;
  // Path of the file the value was read from, as shown to the user.
  readonly file: string;
  readonly scope: Scope;
}

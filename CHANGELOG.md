# Changelog

## Unreleased

- Project scaffold: TypeScript CLI with `--version` and `--help`, esbuild bundle, `node:test` tests, `npm run check` and `npm run check:linux`, community files (#1).
- Core types: `Fact` (agent, key, value, file, scope), `Finding` with the `pass | fail | unverifiable` verdict and stable reason codes, and a text reporter that escapes control and bidi characters from config values (#3).
- Claude settings loader: reads user, project and local settings as strict JSON, merges list keys across files and takes scalars local over project over user, keeps each fact's file and scope, reports `SETTINGS_PARSE_ERROR` for a file Claude Code would not load, and `SETTINGS_VALUE_SKIPPED` for a repo-file `bypassPermissions` (older versions honour it) or a non-list value for a list key (#9).
- Expectations parser: the nine fixed phrases from the grammar, optional `[id]` prefix with `E01`-style ids when absent, `#` comment and blank lines skipped; unknown, ambiguous or duplicate-id lines are errors with their line number, and `check --expect <file>` exits 2 on any of them (#10).

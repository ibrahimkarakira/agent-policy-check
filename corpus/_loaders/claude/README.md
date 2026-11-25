# Claude settings loader fixtures

Invented settings files for `test/load-claude.test.ts`. Each case has `home/` (stands in for the
user's home directory) and `project/` (the repository root). A missing file is part of the case.

- `merge`: user, project and local files; lists merge, scalars take local over project over user.
- `trailing-comma`: a project file that is not strict JSON; no user or local file.
- `repo-scope`: values Claude Code ignores in project and local files. `modelPicker` is taken whole
  from the user file; `defaultMode` `auto` and `bypassPermissions` do not take effect from project or
  local, so the user `default` is the value in effect. The local `bypassPermissions` is still reported,
  because Claude Code before v2.1.257 honoured it from any file.
- `list-type`: local sets `permissions.deny` to a string while project and user set lists. The
  string is a value the schema rejects, so it is reported and skipped; the project and user deny
  lists stay in effect.

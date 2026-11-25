# Corpus

Invented configurations, one case per directory: `good/<case>/` should pass, `bad/<case>/` should
fail. A case directory is laid out as a repository root (`.claude/settings.json`), with an optional
`home/` standing in for the home directory. `expectations.txt` lists what the case expects and
`expected.json` gives the verdict and reason code per expectation id. `test/corpus.test.ts` runs
every case and prints how many match. `_loaders/` holds loader fixtures, not cases.

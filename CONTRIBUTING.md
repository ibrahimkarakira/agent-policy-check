# Contributing

Thanks for helping. The short version: open an issue first, keep the PR small, add a test, run the local check.

## Flow

1. Open an issue (bug or rule request) and say what you want to change and why.
2. One PR per issue, about 50 to 400 changed lines. Link the issue with `Closes #<n>`.
3. Code changes come with a test that fails before the change and passes after it.
4. Fixtures are synthetic, invented configs only. Never paste a real config that holds private paths, server names or tokens.
5. If an AI assistant helped write the change, say so in the PR description.

## Setup

Node 22.18 or newer (the CLI itself runs on any Node 22; the tests need 22.18+, see below).

```
npm ci
npm run check
```

## Commands

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` over `src/` and `test/` (strict) |
| `npm run build` | esbuild bundles `src/cli.ts` into one file, `dist/cli.js` |
| `npm test` | `node --test` runs `test/**/*.test.ts` against the built `dist/cli.js` |
| `npm run check` | typecheck, build, test in order; stops at the first failure and prints each step's exit code |
| `npm run check:linux` | the same `npm ci && npm run check` inside `docker run --rm node:22`; the repo is mounted read-only and copied into the container without `node_modules`, `dist` and `.git`, so your local tree is not touched |

There is no CI in this repo. Every PR carries the `npm run check` command and its output from the author's machine. Linux is checked in Docker; macOS is not tested yet.

## Decision: how TypeScript tests run

Tests are `.ts` files run directly by `node --test`, using Node's built-in type stripping. It is on by default from Node 22.18.0 (https://nodejs.org/api/typescript.html), so no flag, no loader and no compile step for tests is needed. Type stripping does no type checking, which is why `npm run check` runs `tsc --noEmit` first. Only erasable TypeScript syntax is allowed (`erasableSyntaxOnly` in `tsconfig.json`): no enums, no namespaces, no parameter properties.

Fallback if a Node 22 release before 22.18 must be supported for development: compile tests with `tsc` to `build/` and run `node --test build/`.

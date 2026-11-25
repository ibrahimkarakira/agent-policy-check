import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseExpectations } from './parse/expectations.ts';

// Replaced at build time from package.json by scripts/build.mjs.
declare const __VERSION__: string;

const EXIT_USAGE = 2;

const HELP = `agent-policy-check ${__VERSION__}
Check that your Claude Code, Codex and MCP config really enforces your limits.

Usage: agent-policy-check [command] [options]

Commands:
  check        check the config against your expectations file (default)
  init         write a starter agent-expectations.txt
  list-rules   list rule ids, grammar and what each rule reads
  explain      show evidence keys, vendor docs and known limits for a rule

Options:
  --expect <file>  expectations file (default agent-expectations.txt)
  -h, --help       show this help
  -v, --version    print the version
`;

const COMMANDS = new Set(['check', 'init', 'list-rules', 'explain']);

function usageError(message: string): number {
  process.stderr.write(`agent-policy-check: ${message}\nRun agent-policy-check --help for usage.\n`);
  return EXIT_USAGE;
}

function main(argv: string[]): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        expect: { type: 'string', default: 'agent-expectations.txt' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error: unknown) {
    return usageError(error instanceof Error ? error.message : String(error));
  }

  if (parsed.values.version) {
    process.stdout.write(`${__VERSION__}\n`);
    return 0;
  }
  if (parsed.values.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const command = parsed.positionals[0] ?? 'check';
  if (!COMMANDS.has(command)) {
    return usageError(`unknown command: ${command}`);
  }
  if (command === 'check') {
    const file = parsed.values.expect;
    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch (error: unknown) {
      return usageError(`cannot read expectations file ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const { errors } = parseExpectations(source);
    if (errors.length > 0) {
      process.stderr.write(errors.map((e) => `${file}: ${e}
`).join(''));
      return EXIT_USAGE;
    }
  }
  return usageError(`${command} is not implemented yet`);
}

process.exitCode = main(process.argv.slice(2));

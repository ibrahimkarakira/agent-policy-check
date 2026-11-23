import { parseArgs } from 'node:util';

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
  -h, --help     show this help
  -v, --version  print the version
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
  return usageError(`${command} is not implemented yet`);
}

process.exitCode = main(process.argv.slice(2));

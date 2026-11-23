// One command to prove a change: type check, build, tests.
//   npm run check        runs the steps on this machine
//   npm run check:linux  runs `npm ci && npm run check` in a node:22 container.
//                        The repo is mounted read-only and copied without
//                        node_modules, dist and .git, so the host tree is never touched.
// Stops at the first failing step and exits with its code.
import { spawnSync } from 'node:child_process';

const IMAGE = 'node:22';

const LINUX_SCRIPT = [
  'set -e',
  'tar -C /src --exclude=./node_modules --exclude=./dist --exclude=./.git -cf /tmp/src.tar .',
  'mkdir /work',
  'tar -C /work -xf /tmp/src.tar',
  'cd /work',
  'node --version',
  'npm ci --no-audit --no-fund',
  'npm run check',
].join(' && ');

const steps = process.argv.includes('--linux')
  ? [['linux', 'docker', ['run', '--rm', '-v', `${process.cwd()}:/src:ro`, IMAGE, 'sh', '-c', LINUX_SCRIPT], false]]
  : [
      // shell: true lets Windows resolve npm.cmd; the command strings are constants.
      ['typecheck', 'npm run typecheck', [], true],
      ['build', 'npm run build', [], true],
      ['test', 'npm test', [], true],
    ];

for (const [name, cmd, args, shell] of steps) {
  process.stdout.write(`\n== ${name}: ${[cmd, ...args].join(' ')}\n`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell });
  const code = r.error ? 1 : (r.status ?? 1);
  if (r.error) process.stderr.write(`${r.error.message}\n`);
  process.stdout.write(`== ${name}: exit ${code}\n`);
  if (code !== 0) process.exit(code);
}
process.stdout.write('\n== check passed\n');

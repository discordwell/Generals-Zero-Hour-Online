/**
 * Native oracle build harness.
 *
 * Keeps the Layer 3 C++ oracle reproducible from npm on Windows.  The
 * preferred toolchain is the conda `oracle` env documented in
 * tools/oracle/README.md, because this repo intentionally builds the oracle
 * with mingw-w64 rather than with the host compiler.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ORACLE_SOURCE_DIR = resolve(process.cwd(), 'tools/oracle');
export const ORACLE_BUILD_DIR = resolve(process.cwd(), 'tools/oracle/build');
export const ORACLE_BIN = resolve(ORACLE_BUILD_DIR, 'oracle.exe');

export interface OracleBuildOptions {
  force?: boolean;
  stdio?: 'inherit' | 'pipe';
}

interface CommandSpec {
  command: string;
  args: string[];
}

interface CondaEnvList {
  envs?: string[];
}

function commandExists(command: string): boolean {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return result.status === 0;
}

function prependPathEntries(env: NodeJS.ProcessEnv, entries: string[]): NodeJS.ProcessEnv {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  const currentPath = env[pathKey] ?? '';
  return {
    ...env,
    [pathKey]: [...entries, currentPath].filter((entry) => entry.length > 0).join(delimiter),
  };
}

function getOracleInputPaths(): string[] {
  const srcDir = join(ORACLE_SOURCE_DIR, 'src');
  const sourceFiles = readdirSync(srcDir)
    .filter((entry) => entry.endsWith('.cpp') || entry.endsWith('.h') || entry.endsWith('.hpp'))
    .map((entry) => join(srcDir, entry));
  return [join(ORACLE_SOURCE_DIR, 'CMakeLists.txt'), ...sourceFiles];
}

export function isOracleBinaryFresh(
  binaryPath = ORACLE_BIN,
  inputPaths = getOracleInputPaths(),
): boolean {
  if (!existsSync(binaryPath)) {
    return false;
  }
  const binaryMtime = statSync(binaryPath).mtimeMs;
  return inputPaths.every((inputPath) => existsSync(inputPath) && statSync(inputPath).mtimeMs <= binaryMtime);
}

export function buildCondaOracleBuildScript(): string {
  return [
    'conda run -n oracle cmake -S tools/oracle -B tools/oracle/build -G "Unix Makefiles" ' +
      '-DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++ -DCMAKE_MAKE_PROGRAM=make',
    'conda run -n oracle cmake --build tools/oracle/build',
  ].join(' && ');
}

function getBuildCommands(): CommandSpec[] {
  const condaEnv = process.env.ORACLE_CONDA_ENV?.trim() || 'oracle';
  if (commandExists('conda')) {
    return [
      {
        command: 'conda',
        args: [
          'run',
          '-n',
          condaEnv,
          'cmake',
          '-S',
          'tools/oracle',
          '-B',
          'tools/oracle/build',
          '-G',
          'Unix Makefiles',
          '-DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++',
          '-DCMAKE_MAKE_PROGRAM=make',
        ],
      },
      {
        command: 'conda',
        args: ['run', '-n', condaEnv, 'cmake', '--build', 'tools/oracle/build'],
      },
    ];
  }

  if (commandExists('cmake') && commandExists('mingw32-make')) {
    return [
      {
        command: 'cmake',
        args: [
          '-S',
          'tools/oracle',
          '-B',
          'tools/oracle/build',
          '-G',
          'MinGW Makefiles',
          '-DCMAKE_MAKE_PROGRAM=mingw32-make',
        ],
      },
      { command: 'cmake', args: ['--build', 'tools/oracle/build'] },
    ];
  }

  if (commandExists('cmake') && commandExists('make')) {
    return [
      {
        command: 'cmake',
        args: [
          '-S',
          'tools/oracle',
          '-B',
          'tools/oracle/build',
          '-G',
          'Unix Makefiles',
          '-DCMAKE_MAKE_PROGRAM=make',
        ],
      },
      { command: 'cmake', args: ['--build', 'tools/oracle/build'] },
    ];
  }

  throw new Error(
    'No native oracle toolchain found. Install/use the conda env from tools/oracle/README.md, ' +
      'or put cmake plus make/mingw32-make on PATH.',
  );
}

function getCondaEnvPrefix(condaEnv: string): string | null {
  if (!commandExists('conda')) {
    return null;
  }
  const result = spawnSync('conda', ['env', 'list', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || result.stdout.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout) as CondaEnvList;
    const normalizedName = condaEnv.toLowerCase();
    return (parsed.envs ?? []).find((envPath) => {
      const normalizedPath = envPath.replaceAll('\\', '/').toLowerCase();
      return normalizedPath.endsWith(`/${normalizedName}`);
    }) ?? null;
  } catch {
    return null;
  }
}

export function getOracleRuntimeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const explicitRuntimePath = env.ORACLE_RUNTIME_PATH?.trim();
  if (explicitRuntimePath) {
    return prependPathEntries(env, explicitRuntimePath.split(delimiter).filter((entry) => entry.length > 0));
  }

  const condaEnv = env.ORACLE_CONDA_ENV?.trim() || 'oracle';
  const condaPrefix = getCondaEnvPrefix(condaEnv);
  if (!condaPrefix) {
    return env;
  }

  return prependPathEntries(env, [
    join(condaPrefix, 'Library/mingw-w64/bin'),
    join(condaPrefix, 'Library/usr/bin'),
    join(condaPrefix, 'Library/bin'),
    join(condaPrefix, 'Scripts'),
    join(condaPrefix, 'bin'),
  ]);
}

function runCommand(spec: CommandSpec, stdio: 'inherit' | 'pipe'): void {
  const result = spawnSync(spec.command, spec.args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio,
  });
  if (result.status !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    const detail = stderr.length > 0 ? `\n${stderr}` : '';
    throw new Error(`Native oracle build failed: ${spec.command} ${spec.args.join(' ')}${detail}`);
  }
}

export function ensureOracleBuilt(options: OracleBuildOptions = {}): void {
  if (!options.force && process.env.ORACLE_SKIP_BUILD === '1') {
    return;
  }
  if (!options.force && isOracleBinaryFresh()) {
    return;
  }

  for (const spec of getBuildCommands()) {
    runCommand(spec, options.stdio ?? 'inherit');
  }

  if (!existsSync(ORACLE_BIN)) {
    throw new Error(`Native oracle build did not produce ${ORACLE_BIN}`);
  }
}

function isCliEntry(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(entry).href);
}

if (isCliEntry()) {
  try {
    ensureOracleBuilt({ force: process.argv.includes('--force') });
    process.stdout.write(`Native oracle ready: ${ORACLE_BIN}\n`);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
  }
}

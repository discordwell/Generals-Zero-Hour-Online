import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildCondaOracleBuildScript, getOracleRuntimeEnv, isOracleBinaryFresh } from './oracle-build.js';

describe('oracle build harness', () => {
  it('treats the native oracle as stale when a source input is newer', () => {
    const dir = mkdtempSync(join(tmpdir(), 'generals-oracle-build-'));
    try {
      const binary = join(dir, 'oracle.exe');
      const input = join(dir, 'main.cpp');
      writeFileSync(binary, 'binary');
      writeFileSync(input, 'source');

      const oldTime = new Date('2026-01-01T00:00:00Z');
      const newTime = new Date('2026-01-02T00:00:00Z');
      utimesSync(binary, oldTime, oldTime);
      utimesSync(input, newTime, newTime);

      expect(isOracleBinaryFresh(binary, [input])).toBe(false);

      utimesSync(binary, newTime, newTime);
      expect(isOracleBinaryFresh(binary, [input])).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('builds through the mingw-w64 conda toolchain used by the C++ oracle', () => {
    expect(buildCondaOracleBuildScript()).toContain('-DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++');
    expect(buildCondaOracleBuildScript()).toContain('cmake --build tools/oracle/build');
  });

  it('prepends explicit native runtime paths for oracle.exe DLL lookup', () => {
    const env = getOracleRuntimeEnv({
      ORACLE_RUNTIME_PATH: 'C:\\oracle\\bin;C:\\oracle\\lib',
      PATH: 'C:\\windows',
    });

    expect(env.PATH).toBe('C:\\oracle\\bin;C:\\oracle\\lib;C:\\windows');
  });
});

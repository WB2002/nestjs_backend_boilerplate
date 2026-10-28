import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from 'jest';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const requireFromRepo = createRequire(path.join(repoRoot, 'package.json'));

function resolveFromPackage(
  parentPackageName: string,
  packageName: string,
): string {
  const parentPkgJson = requireFromRepo.resolve(
    `${parentPackageName}/package.json`,
  );
  const requireFromParent = createRequire(parentPkgJson);
  return requireFromParent.resolve(packageName);
}

/** Integration tests: real `pg` and Testcontainers (no unit-test shims). */
const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: [
    '/node_modules/',
    String.raw`/\.worktrees/`,
    '/dist/',
  ],
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.integration.json',
      },
    ],
  },
  transformIgnorePatterns: [
    String.raw`/node_modules/(?!.*(?:sanitize-html|htmlparser2|entities|domelementtype|domhandler|domutils|dom-serializer|escape-string-regexp|is-plain-object|@nestjs/bullmq|@nestjs/bull-shared|bullmq|msgpackr)(?:/|$))`,
  ],
  testEnvironment: 'node',
  testEnvironmentOptions: {
    customExportConditions: ['node', 'require', 'import', 'default'],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^sanitize-html$': '<rootDir>/jest/sanitize-html-shim.cjs',
    '^pg$': '<rootDir>/jest/pg-require.cjs',
    '^pg-pool$': resolveFromPackage('pg', 'pg-pool'),
    '^pg-connection-string$': resolveFromPackage('pg', 'pg-connection-string'),
  },
};

export default config;

import type { Config } from 'jest';

/** Integration tests: real `pg` and `@nestjs/bullmq` (no unit-test shims). */
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
        tsconfig: 'tsconfig.spec.json',
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
  },
};

export default config;

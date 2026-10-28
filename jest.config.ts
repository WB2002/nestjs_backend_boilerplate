import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  // Only application tests under src/ (ignore .worktrees/ copies of the repo).
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
  collectCoverageFrom: ['src/core/http-client/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  testEnvironmentOptions: {
    customExportConditions: ['node', 'require', 'import', 'default'],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^sanitize-html$': '<rootDir>/jest/sanitize-html-shim.cjs',
    '^@nestjs/bullmq$': '<rootDir>/jest/nestjs-bullmq-shim.cjs',
    '^pg$': '<rootDir>/jest/pg-shim.cjs',
  },
};

export default config;

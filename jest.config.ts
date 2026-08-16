import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.spec.json',
      },
    ],
  },
  transformIgnorePatterns: [
    String.raw`/node_modules/(?!.*(?:sanitize-html|htmlparser2|entities|domelementtype|domhandler|domutils|dom-serializer|escape-string-regexp|is-plain-object)(?:/|$))`,
  ],
  collectCoverageFrom: ['src/core/http-client/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};

export default config;

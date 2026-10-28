import type { Config } from 'jest';
import base from './jest.config.ts';

const config: Config = {
  ...base,
  roots: ['<rootDir>/test/property'],
  testRegex: '.*\\.property\\.spec\\.ts$',
  collectCoverageFrom: [],
};

export default config;

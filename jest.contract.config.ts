import type { Config } from 'jest';
import base from './jest.config.ts';

const config: Config = {
  ...base,
  roots: ['<rootDir>/test/contracts'],
  testRegex: '.*\\.(contract|drift)\\.spec\\.ts$',
  collectCoverageFrom: [],
};

export default config;

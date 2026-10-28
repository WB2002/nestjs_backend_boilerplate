/** @type {import('@stryker-mutator/api').PartialStrykerOptions} */
const mutateFiles = process.env.MUTATE_FILES
  ? process.env.MUTATE_FILES.split(',').filter(Boolean)
  : [];

export default {
  packageManager: 'pnpm',
  plugins: ['@stryker-mutator/jest-runner'],
  testRunner: 'jest',
  jest: {
    configFile: 'jest.config.ts',
  },
  mutate:
    mutateFiles.length > 0
      ? mutateFiles
      : ['src/core/overload/priority/should-shed-priority-request.ts'],
  reporters: ['html', 'clear-text', 'progress'],
  htmlReporter: {
    fileName: 'reports/mutation/mutation.html',
  },
  thresholds: {
    high: 80,
    low: 60,
    break: 50,
  },
  timeoutMS: 60000,
};

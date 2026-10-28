import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierPlugin from 'eslint-plugin-prettier';
import eslintConfigPrettier from 'eslint-config-prettier';
import securityPlugin from 'eslint-plugin-security';
import sonarjsPlugin from 'eslint-plugin-sonarjs';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['node_modules', 'dist', '.eslintrc.js'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  securityPlugin.configs.recommended,
  sonarjsPlugin.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.spec.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.ts'],
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      'prettier/prettier': 'error',
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'sonarjs/no-unused-vars': 'off',
      'sonarjs/cognitive-complexity': ['warn', 20],
      'sonarjs/different-types-comparison': 'warn',
      'sonarjs/slow-regex': 'warn',
      'sonarjs/no-hardcoded-ip': 'warn',
      'sonarjs/no-invariant-returns': 'warn',
      'sonarjs/no-nested-conditional': 'warn',
      'sonarjs/no-nested-template-literals': 'warn',
      'sonarjs/hashing': 'warn',
      'sonarjs/no-all-duplicated-branches': 'warn',
      'sonarjs/function-return-type': 'warn',
      'sonarjs/publicly-writable-directories': 'warn',
      'sonarjs/os-command': 'warn',
      'sonarjs/no-clear-text-protocols': 'warn',
      'sonarjs/void-use': 'warn',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.integration.spec.ts'],
    rules: {
      'sonarjs/no-clear-text-protocols': 'off',
      'sonarjs/no-hardcoded-ip': 'off',
      'sonarjs/different-types-comparison': 'off',
      'sonarjs/no-alphabetical-sort': 'off',
      'sonarjs/no-unused-vars': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['src/common/sanitization/constants/sql-injection.constants.ts'],
    rules: {
      'no-useless-escape': 'off',
      'sonarjs/slow-regex': 'off',
    },
  },
  // Must be last so Prettier and ESLint do not fight over formatting rules.
  eslintConfigPrettier,
);

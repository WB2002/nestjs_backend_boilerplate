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
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        {
          selector: 'enumMember',
          format: ['PascalCase'],
        },
        {
          selector: ['objectLiteralProperty', 'typeProperty'],
          format: null,
        },
        {
          selector: 'import',
          format: null,
        },
        {
          selector: 'function',
          format: ['camelCase', 'PascalCase'],
        },
        {
          selector: 'classProperty',
          filter: { regex: '^_id$', match: true },
          format: null,
        },
        {
          selector: 'classProperty',
          filter: { regex: '^enabled$', match: true },
          format: null,
        },
        {
          selector: ['classProperty', 'variable', 'parameter'],
          format: ['camelCase'],
          filter: {
            regex: '^(is|has|can|should)[A-Z].+',
            match: true,
          },
        },
        {
          selector: ['variable', 'parameter', 'classProperty'],
          types: ['boolean'],
          format: ['camelCase'],
          prefix: ['is', 'has', 'can', 'should'],
        },
        {
          selector: 'variable',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
          filter: {
            regex: '^_(never|exhaustive)$',
            match: true,
          },
        },
        {
          selector: 'parameter',
          leadingUnderscore: 'allow',
          filter: { regex: '^_', match: true },
          format: ['camelCase'],
        },
        {
          selector: 'parameter',
          modifiers: ['unused'],
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'variable',
          modifiers: ['const'],
          format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
        },
        {
          selector: 'default',
          format: ['camelCase'],
          leadingUnderscore: 'forbid',
        },
      ],
      'id-denylist': ['error', 'data', 'result', 'item', 'temp', 'obj', 'val'],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='eval']",
          message:
            'eval() is forbidden in application code (obfuscation/exfil risk).',
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: 'new Function() is forbidden in application code.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'node:vm',
              message: 'Dynamic vm execution is forbidden in application code.',
            },
            {
              name: 'vm',
              message: 'Dynamic vm execution is forbidden in application code.',
            },
          ],
        },
      ],
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
    files: ['test/security/semgrep-fixtures/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      'sonarjs/code-eval': 'off',
      'security/detect-eval-with-expression': 'off',
    },
  },
  {
    files: ['src/common/sanitization/constants/sql-injection.constants.ts'],
    rules: {
      'no-useless-escape': 'off',
      'sonarjs/slow-regex': 'off',
      'security/detect-unsafe-regex': 'off',
    },
  },
  {
    files: ['src/core/feature-flag/tests/feature-flag.repository.spec.ts'],
    rules: {
      'sonarjs/os-command': 'off',
    },
  },
  {
    files: [
      'src/core/redaction/redact-log-message.ts',
      'src/common/uploads/scanners/clamav-file-scanner.ts',
    ],
    rules: {
      'sonarjs/slow-regex': 'off',
    },
  },
  // Must be last so Prettier and ESLint do not fight over formatting rules.
  eslintConfigPrettier,
);

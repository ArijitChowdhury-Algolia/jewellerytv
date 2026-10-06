import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'evaluation/**',
      '**/archive/**',
      '**/archived/**',
      '**/runs/**',
      '**/evidence/**',
      'shared/catalogueFacetValues.json',
      'src/catalog/fixtures.json',
      'dist/**',
      'node_modules/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    // Existing legacy modules retain a recorded baseline until their owners can
    // remediate them. New Concierge modules are checked strictly below.
    files: [
      'server/**/*.{ts,tsx}',
      'shared/**/*.{ts,tsx}',
      'src/**/*.{ts,tsx}',
      'tests/**/*.{ts,tsx}',
    ],
    ignores: ['server/config.ts', 'shared/concierge/**/*', 'tests/concierge/**/*'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
  {
    files: [
      'server/config.ts',
      'shared/concierge/**/*.{ts,tsx}',
      'src/concierge/**/*.{ts,tsx}',
      'tests/concierge/**/*.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);

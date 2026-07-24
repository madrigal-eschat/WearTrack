import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  { ignores: ['node_modules/'] },
  {
    rules: {
      'max-len': ['error', { code: 80 }],
      curly: ['error', 'all'],
      'brace-style': ['error', '1tbs', { allowSingleLine: false }],
      indent: ['error', 2],
    },
  },
  {
    files: ['src/controllers/**/*.ts'],
    rules: {
      complexity: ['error', 10],
    },
  },
);

import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  { ignores: ['node_modules/'] },
  {
    rules: {
      'max-len': ['error', { code: 80 }],
    },
  },
  {
    files: ['src/controllers/**/*.ts'],
    rules: {
      complexity: ['error', 10],
    },
  },
);

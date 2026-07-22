import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  { ignores: ['node_modules/'] },
  {
    files: ['src/controllers/**/*.ts'],
    rules: {
      complexity: ['error', 10],
    },
  },
);

module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    sourceType: 'module',
    project: ['./packages/**/tsconfig.json', './packages/tests/**/tsconfig.json'],
  },
  env: {
    es6: true,
    node: true,
  },
  plugins: ['@typescript-eslint', 'json', 'prettier', 'jest', 'spellcheck'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:json/recommended',
    'prettier',
    'plugin:jest/recommended',
  ],
  globals: {
    globalThis: false, // it means that it is not writeable
  },
  rules: {
    '@typescript-eslint/no-extra-semi': 'off',
    'no-process-exit': 'error',
    'no-process-env': 'error',
    'no-console': 'error',
    'prettier/prettier': 'error',
    'no-unused-vars': 'off', // it is the same as @typescript-eslint/no-unused-vars which is on
    'jest/no-disabled-tests': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/member-delimiter-style': 'off',
    '@typescript-eslint/ban-ts-ignore': 'off',
    '@typescript-eslint/triple-slash-reference': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
  },
  overrides: [
    {
      files: ['*.ts', '*.tsx'],
      rules: {
        '@typescript-eslint/no-unused-vars': [
          2,
          {
            args: 'none',
          },
        ],
      },
    },
  ],
}

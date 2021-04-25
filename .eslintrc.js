module.exports = {
  env: {
    es6: true,
    node: true,
    commonjs: true,
  },
  extends: [
    'airbnb-base',
  ],
  parserOptions: {
    ecmaVersion: 2018,
  },
  rules: {
    camelcase: 0,
    'no-underscore-dangle': [
      'off',
    ],
    'max-len': [
      'error',
      {
        code: 120,
        ignoreComments: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
      },
    ],
    'no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
      },
    ],
    'no-console': [
      'error', { allow: ['log', 'error', 'warn'] },
    ],
    'no-await-in-loop': ['off'],
  },
};

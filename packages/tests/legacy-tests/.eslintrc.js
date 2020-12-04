// eslint-disable-next-line @typescript-eslint/no-var-requires
const eslint = require('../../../.eslintrc.js')

module.exports = { ...eslint, rules: { ...eslint.rules, '@typescript-eslint/explicit-module-boundary-types': 'off' } }

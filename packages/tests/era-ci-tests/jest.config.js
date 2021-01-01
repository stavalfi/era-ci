/* eslint-disable @typescript-eslint/no-var-requires */

const path = require('path')
const jestConfig = require('../../../jest.config')

module.exports = {
  ...jestConfig,
  testMatch: [path.join(__dirname, '__tests__/**/*.spec.ts')],
}

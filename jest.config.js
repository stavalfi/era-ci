/* eslint-disable @typescript-eslint/no-var-requires */

const path = require('path')
const { pathsToModuleNameMapper } = require('ts-jest/utils')
const { compilerOptions } = require('./tsconfig.json')

module.exports = {
  preset: 'ts-jest',
  testRunner: 'jest-circus/runner',
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, { prefix: path.join(__dirname, 'packages/') }),
  setupFilesAfterEnv: [path.join(__dirname, 'jest.setup.js')],
  globals: {
    'ts-jest': {
      tsConfig: path.join(__dirname, 'tsconfig.json'),
    },
  },
  globalSetup: path.join(__dirname, 'jest-global-setup.js'),
  testMatch: [path.join(__dirname, 'packages/*/__tests__/**/*.spec.ts')],
}

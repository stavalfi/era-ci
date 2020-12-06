/* eslint-disable @typescript-eslint/no-var-requires */

const path = require('path')
const { pathsToModuleNameMapper } = require('ts-jest/utils')
const { compilerOptions } = require('./tsconfig.json')

module.exports = {
  testEnvironment: 'node',
  testRunner: 'jest-circus/runner',
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, { prefix: path.join(__dirname, 'packages/') }),
  setupFilesAfterEnv: [path.join(__dirname, 'jest.setup.js')],
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest'],
  },
  testMatch: [
    path.join(__dirname, 'packages/*/__tests__/**/*.spec.ts'),
    path.join(__dirname, 'packages/tests/*/__tests__/**/*.spec.ts'),
  ],
  globalSetup: path.join(__dirname, 'jest-global-setup.js'),
}

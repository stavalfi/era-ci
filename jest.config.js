/* eslint-disable @typescript-eslint/no-var-requires */

const path = require('path')
const { pathsToModuleNameMapper } = require('ts-jest/utils')
const { compilerOptions } = require('./tsconfig.json')

module.exports = {
  testEnvironment: 'node',
  preset: 'ts-jest',
  testRunner: 'jest-circus/runner',
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, { prefix: path.join(__dirname, 'packages/') }),
  setupFilesAfterEnv: [path.join(__dirname, 'jest.setup.js')],
  globals: {
    'ts-jest': {
      tsconfig: path.join(__dirname, 'tsconfig.json'),
    },
  },
  testMatch: [
    path.join(__dirname, 'packages/*/__tests__/**/*.spec.ts'),
    path.join(__dirname, 'packages/dancer-crawlers/*/__tests__/**/*.spec.ts'),
    path.join(__dirname, 'packages/dancer-crawlers/crawlers/*/__tests__/**/*.spec.ts'),
    path.join(__dirname, 'packages/tests/*/__tests__/**/*.spec.ts'),
  ],
}

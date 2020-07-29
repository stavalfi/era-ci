/* eslint-disable @typescript-eslint/no-var-requires */

const path = require('path')
const execa = require('execa')

const result = execa.sync('yarn', 'workspaces --json info'.split(' '))

const workspacesInfo = JSON.parse(JSON.parse(result.stdout).data)
const packagesAliases = Object.values(workspacesInfo)
  .map(workspaceInfo => workspaceInfo.location)
  .map(packagePath => ({
    [`^${require(path.join(__dirname, packagePath, 'package.json')).name}$`]: path.join(
      __dirname,
      packagePath,
      'src',
      'index.ts',
    ),
  }))
  .reduce((acc, obj) => ({ ...acc, ...obj }), {})

module.exports = {
  preset: 'ts-jest',
  testRunner: 'jest-circus/runner',
  moduleNameMapper: packagesAliases,
  setupFilesAfterEnv: [path.join(__dirname, 'jest.setup.js')],
  globals: {
    'ts-jest': {
      tsConfig: path.join(__dirname, 'tsconfig.json'),
    },
  },
  globalSetup: path.join(__dirname, 'jest-global-setup.js'),
  testMatch: [path.join(__dirname, 'packages/*/__tests__/**/*.spec.ts')],
}

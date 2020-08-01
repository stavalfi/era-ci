/* eslint-disable @typescript-eslint/no-var-requires */

const execa = require('execa')
const ciInfo = require('ci-info')

module.exports = async () => {
  if (ciInfo.isCI) {
    // in the tests of this package, we create git-repos and do commits so we need a git-user.
    await execa.command(`${ciInfo.AZURE_PIPELINES ? 'sudo' : ''} git config --global user.email "test@test.com"`)
    await execa.command(`${ciInfo.AZURE_PIPELINES ? 'sudo' : ''} git config --global user.name "test-user"`)
  }
}

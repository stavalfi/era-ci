/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-undef */
/* eslint-disable no-process-env */

// const npmLogin = require('npm-login-noninteractive')
// const { execSync } = require('child_process')

function timeout() {
  if (process.env.NDD_PID) {
    // we are running ndb for debugging
    return 1000 * 1000
  }
  if (process.env.CI) {
    return 100 * 1000
  }
  return 150 * 1000
}

// function loginToNpmRegistry() {
//   execSync(`npm config set always-auth true`)
//   npmLogin(`username`, 'password', 'root@root.root', 'http://localhost:34873')
// }

function main() {
  jest.setTimeout(timeout())

  // loginToNpmRegistry()

  process.env.ERA_TEST_MODE = 'true'
}

main()

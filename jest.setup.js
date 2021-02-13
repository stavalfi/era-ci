/* eslint-disable no-undef */
/* eslint-disable no-process-env */

function timeout() {
  if (process.env.NDD_PID) {
    // we are running ndb for debugging
    return 1000 * 1000
  }
  if (process.env.CI) {
    return 40 * 1000
  }
  return 300 * 1000
}

jest.setTimeout(timeout())

process.env.ERA_TEST_MODE = 'true'

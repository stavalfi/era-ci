/* eslint-disable no-undef */
/* eslint-disable no-process-env */

function timeout() {
  if (process.env.NDD_PID) {
    // we are running ndb for debugging
    return 1000 * 1000
  }
  if (process.env.CI) {
    return 100 * 1000
  }
  return 30 * 1000
}

jest.setTimeout(timeout())

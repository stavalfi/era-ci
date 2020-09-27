/* eslint-disable @typescript-eslint/no-var-requires */
const execa = require('execa')
const ciInfo = require('ci-info')

const up = () =>
  execa.command(`yarn test-resources:up`, {
    cwd: __dirname,
  })

const down = () =>
  execa.command(`yarn test-resources:down`, {
    cwd: __dirname,
  })

module.exports = async function start() {
  if (!ciInfo.isCI) {
    // in ci, we run this script on time from bitbucket-pipelines.yml (to avoid running this on every package)
    await up().catch(async e => {
      // eslint-disable-next-line no-console
      console.log('failed to load resoruces using docker-compose. deleting all and loading them again...', e)
      await down()
      return up()
    })
  }
}

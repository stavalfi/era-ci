/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-var-requires */

const drc = require('docker-registry-client')
var bunyan = require('bunyan')
// Shared mainline with examples/foo.js to get CLI opts.
const cmd = 'listTags'

var log = bunyan.createLogger({
  name: cmd,
  level: 'info',
})

async function runTask(task, i, retry = 1) {
  try {
    return await task(i)
  } catch (error) {
    if (error?.message?.includes('429')) {
      const t = 1000 * Math.pow(2, retry - 1) + Math.random() * 100
      console.log('waiting: ', t)
      await new Promise(res => setTimeout(res, t))
      return runTask(task, i, retry + 1)
    } else {
      debugger
      throw error
    }
  }
}

async function getTags(i) {
  await runTask(async () => {
    const client = drc.createClientV2({
      name: `localhost:35000/stav1991/repo${i}`,
      log,
      insecure: true,
      maxSchemaVersion: 2, // quay === 2, dockerhub === 1
    })
    const tags = await new Promise((res, rej) => client.listTags((err, tags) => (err ? rej(err) : res(tags))))
    // console.log('stav', i, JSON.stringify(tags, null, 2))
    client.close()
  }, i)
}

getTags(1)

async function getManifestDockerhub() {
  const client = drc.createClientV2({
    name: 'stavalfi/buildkit-poc',
    log,
    insecure: false,
    username: 'stavalfi',
    password: 'stavalfi635383',
    maxSchemaVersion: 2, // quay === 2, dockerhub === 1
  })

  client.getManifest({ ref: 'latest' }, function (err, manifest, res, manifestStr) {
    client.close()
    if (err) {
      console.error(err)
      return
    }
    console.error('# response headers')
    console.error(JSON.stringify(res.headers, null, 4))
    console.error('# manifest')
    console.log(manifest)
  })
}

async function getManifestQuay() {
  const client = drc.createClientV2({
    name: 'quay.io/stav1991/repo1',
    log,
    insecure: false,
    username: 'stavalfi',
    password: 'stavalfi635383',
    maxSchemaVersion: 2, // quay === 2, dockerhub === 1
  })

  client.getManifest({ ref: 'test-build' }, function (err, manifest, res, manifestStr) {
    client.close()
    if (err) {
      console.error(err)
      return
    }
    console.error('# response headers')
    console.error(JSON.stringify(res.headers, null, 4))
    console.error('# manifest')
    console.log(manifest)
  })
}

async function putManifest() {
  const client = drc.createClientV2({
    name: 'quay.io/stav1991/repo1',
    log,
    insecure: false,
    username: 'stavalfi',
    password: 'stavalfi635383',
    maxSchemaVersion: 2, // quay === 2, dockerhub === 1
  })

  client.getManifest({ ref: 'test-build' }, function (err, manifest, res, manifestStr) {
    client.putManifest({ ref: 'test-build2', manifest: manifestStr }, function (uploadErr, res, digest, location) {
      client.close()
      if (err) {
        console.error(err)
        return
      }

      console.log('Upload successful => digest:', digest, 'location:', location)
    })
  })
}

// getManifestDockerhub()

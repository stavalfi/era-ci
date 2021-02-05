/* eslint-disable no-console */

import { QuayClient } from '@era-ci/quay-client'
import fastify from 'fastify'
import Redis from 'ioredis'
import { getConfig } from './config'
import { QuayBuildStatus, QuayNotificationEvents, QueryStringOptions } from './types'
import {
  checkTarGzExist,
  downloadTarGz,
  quayNotificationEventToBuildStatus,
  sendQuayNotificationInRedis,
} from './utils'

export async function startQuayHelperService(
  env: Record<string, string | undefined>,
): Promise<{ address: string; cleanup: () => Promise<unknown> }> {
  const config = getConfig(env)

  const app = fastify({
    logger: {
      prettyPrint: true,
      level: env['ERA_TEST_MODE'] ? 'error' : 'info',
    },
  })

  if (!env.ERA_TEST_MODE) {
    console.log(`starting quay-helper-service with config: ${JSON.stringify(config, null, 2)}`)
  }

  const redisConnection = new Redis(config.redisAddress, {
    lazyConnect: true,
    username: config.redisAuth?.username,
    password: config.redisAuth?.password,
  })
  await redisConnection.connect()

  app.get('/', async (_req, res) => res.send('alive'))

  /**
   * examples:
   * http://127.0.0.1:8080/download-git-repo-tar-gz?git_registry=github&git_org=stavalfi&git_repo=era-ci&commit=master
   * http://127.0.0.1:8080/download-git-repo-tar-gz?git_registry=bitbucket-cloud&git_org=octopoli&git_repo=dancer&commit=master
   * @param options
   */
  app.get<{
    Querystring: QueryStringOptions
  }>('/download-git-repo-tar-gz', async (req, res) => res.send(await downloadTarGz(req.query, config.auth)))

  app.head<{
    Querystring: QueryStringOptions
  }>('/download-git-repo-tar-gz', async (req, res) => res.send(await checkTarGzExist(req.query, config.auth)))

  app.post<{ Params: { event: QuayNotificationEvents }; Body: { build_id: string } }>(
    '/quay-build-notification/:event',
    async (req, res) => {
      const quayBuildStatus = quayNotificationEventToBuildStatus(req.params.event)
      await sendQuayNotificationInRedis({
        build_id: req.body.build_id,
        config,
        quayBuildStatus,
        log: app.log,
        redisConnection,
      })
      res.send()
    },
  )

  app.post<{
    Params: {}
    Body: {
      build_id: string
      quayService: string
      quayToken: string
      quayNamespace: string
      eraTaskId: string
      quayRepoName: string
    }
  }>('/quay-build-notification-pulling', async (req, res) => {
    res.send()

    const quayClient = new QuayClient(
      req.body.quayService,
      req.body.quayToken,
      req.body.quayNamespace,
      {
        error: app.log.error.bind(app.log),
        info: app.log.info.bind(app.log),
        debug: app.log.debug.bind(app.log),
      },
      env,
    )

    let failures404 = 0
    let exitEarly = false
    const getStatus = () =>
      quayClient
        .getBuildStatus({
          quayBuildId: req.body.build_id,
          repoName: req.body.quayRepoName,
          taskId: req.body.eraTaskId,
        })
        .catch(error => {
          if (env.ERA_TEST_MODE && error.code === 'ECONNREFUSED') {
            // the test ended so quay-mock process finished
            exitEarly = true
            return null
          }
          if (error.message.includes('404')) {
            // quay has a delay and they still don't know this build yet. let's wait
            failures404++
            return null
          }
        })

    let status = await getStatus()
    // it looks like quay has a bug and they don't report failure-status in webhook.
    const sleepMs = env.ERA_TEST_MODE ? 100 : 2_000 // so we exit early as possible in tests
    while (
      status !== QuayBuildStatus.cancelled &&
      status !== QuayBuildStatus.complete &&
      status !== QuayBuildStatus.error
    ) {
      if (exitEarly) {
        return
      }
      await new Promise(res => setTimeout(res, sleepMs))
      status = await getStatus()
      if (failures404 === 60) {
        app.log.error(
          `failed to pull build-status from quay because quay dont know this build-id: "${
            req.body.build_id
          }" (which they gave us). (we trying to ask quay every second during ${
            (sleepMs * failures404) / 1_000
          } seconds).`,
        )
        return
      }
    }
    await sendQuayNotificationInRedis({
      build_id: req.body.build_id,
      config,
      quayBuildStatus: status,
      log: app.log,
      redisConnection,
    })
  })

  const address = await app.listen(config.port, '0.0.0.0')
  console.log(`quay-helper-service: "${address}"`)

  let closed = false
  return {
    address,
    cleanup: async () => {
      if (closed) {
        return
      }
      closed = true
      await app.close()
      await redisConnection.disconnect()
      console.log(`closed quay-helper-service: "${address}"`)
    },
  }
}

if (require.main === module) {
  startQuayHelperService(
    // eslint-disable-next-line no-process-env
    process.env,
  )
}

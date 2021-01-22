import type { QuayBuildStatusChangedTopicPayload, QuayNotificationEvents } from '@era-ci/task-queues'
import fastify from 'fastify'
import Redis from 'ioredis'
import { getConfig } from './config'
import { QueryStringOptions } from './types'
import { downloadTarGz, quayNotificationEventToBuildStatus } from './utils'

export async function startQuayHelperService(
  env: Record<string, string | undefined>,
  customLog?: (...values: unknown[]) => void,
): Promise<{ address: string; cleanup: () => Promise<unknown> }> {
  const config = getConfig(env)

  const logger = {
    debug: (log: unknown) => customLog && customLog(log),
    info: (log: unknown) => customLog && customLog(log),
    trace: (log: unknown) => customLog && customLog(log),
    error: (log: unknown) => customLog && customLog(log),
    warn: (log: unknown) => customLog && customLog(log),
    fatal: (log: unknown) => customLog && customLog(log),
    child: () => logger,
  }

  const app = fastify({
    logger: {
      prettyPrint: true,
      level: 'info',
    },
  })

  app.log[env.NC_TEST_MODE ? 'trace' : 'info'](
    `starting quay-helper-service with config: ${JSON.stringify(config, null, 2)}`,
  )

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

  app.post<{ Params: { event: QuayNotificationEvents }; Body: { build_id: string } }>(
    '/quay-build-notification/:event',
    async (req, res) => {
      const quayBuildStatus = quayNotificationEventToBuildStatus(req.params.event)
      const { build_id } = req.body
      const payload: QuayBuildStatusChangedTopicPayload = {
        quayBuildId: build_id,
        quayBuildStatus,
        changeDateMs: Date.now(),
      }
      await redisConnection.publish(config.quayBuildStatusChangedRedisTopic, JSON.stringify(payload))
      res.send()
    },
  )

  const address = await app.listen(config.port, '0.0.0.0')
  app.log.info(`quay-helper-service: "${address}"`)

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
      if (customLog) {
        customLog(`closed quay-helper-service: "${address}"`)
      } else {
        // eslint-disable-next-line no-console
        console.log(`closed quay-helper-service: "${address}"`)
      }
    },
  }
}

if (require.main === module) {
  // eslint-disable-next-line no-process-env
  startQuayHelperService(process.env)
}

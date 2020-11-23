import fastify from 'fastify'
import { getConfig } from './config'
import { QueryStringOptions } from './types'
import { downloadTarGz } from './utils'
import Redis from 'ioredis'
import { QuayBuildStatusChangedTopicPayload, QuayBuildStatus } from '@tahini/quay-task-queue'

export async function startService(env: Record<string, string | undefined>): Promise<string> {
  const config = getConfig(env)

  const redisConnection = new Redis(config.redisAddress, { lazyConnect: true })
  await redisConnection.connect()

  const app = fastify({
    logger: true,
  })

  app.get('/', async (_req, res) => res.send('alive'))

  /**
   * examples:
   * http://127.0.0.1:8080/download-git-repo-tar-gz?git_registry=github&git_org=stavalfi&git_repo=nc&commit=master
   * http://127.0.0.1:8080/download-git-repo-tar-gz?git_registry=bitbucket-cloud&git_org=octopoli&git_repo=dancer&commit=master
   * @param options
   */
  app.get<{
    Querystring: QueryStringOptions
  }>('/download-git-repo-tar-gz', async (req, res) => res.send(downloadTarGz(req.query, config.auth)))

  app.post<{ Body: { build_id: string } }>('/quay-build/queued', async (req, res) => {
    const { build_id } = req.body
    const payload: QuayBuildStatusChangedTopicPayload = {
      quayBuildId: build_id,
      quayBuildStatus: QuayBuildStatus.waiting,
      changeDateMs: Date.now(),
    }
    await redisConnection.publish(config.quayBuildStatusChangedRedisTopic, JSON.stringify(payload))
    res.send()
  })

  app.post<{ Body: { build_id: string } }>('/quay-build/started', async (req, res) => {
    const { build_id } = req.body
    const payload: QuayBuildStatusChangedTopicPayload = {
      quayBuildId: build_id,
      quayBuildStatus: QuayBuildStatus.started,
      changeDateMs: Date.now(),
    }
    await redisConnection.publish(config.quayBuildStatusChangedRedisTopic, JSON.stringify(payload))
    res.send()
  })

  app.post<{ Body: { build_id: string } }>('/quay-build/completed', async (req, res) => {
    const { build_id } = req.body
    const payload: QuayBuildStatusChangedTopicPayload = {
      quayBuildId: build_id,
      quayBuildStatus: QuayBuildStatus.complete,
      changeDateMs: Date.now(),
    }
    await redisConnection.publish(config.quayBuildStatusChangedRedisTopic, JSON.stringify(payload))
    res.send()
  })

  app.post<{ Body: { build_id: string } }>('/quay-build/failed', async (req, res) => {
    const { build_id } = req.body
    const payload: QuayBuildStatusChangedTopicPayload = {
      quayBuildId: build_id,
      quayBuildStatus: QuayBuildStatus.error,
      changeDateMs: Date.now(),
    }
    await redisConnection.publish(config.quayBuildStatusChangedRedisTopic, JSON.stringify(payload))
    res.send()
  })

  return app.listen(config.port)
}

if (require.main === module) {
  // eslint-disable-next-line no-process-env
  startService(process.env)
}

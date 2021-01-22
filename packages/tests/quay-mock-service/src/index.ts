/* eslint-disable no-console */
import chance from 'chance'
import fastify from 'fastify'
import fastifyRateLimiter from 'fastify-rate-limit'
import HttpStatusCodes from 'http-status-codes'
import {
  Config,
  CreateNotificationRequest,
  CreateNotificationResponse,
  CreateRepoRequest,
  CreateRepoResponse,
  Db,
  GetBuildStatusResponse,
  Headers,
  QuayBuildStatus,
  TriggerBuildRequest,
  TriggerBuildResponse,
} from './types'
import { buildDockerFile } from './utils'

export {
  Config,
  CreateRepoRequest,
  CreateRepoResponse,
  GetBuildStatusResponse,
  Headers,
  TriggerBuildRequest,
  TriggerBuildResponse,
}

export async function startQuayMockService(
  config: Config,
): Promise<{ address: string; cleanup: () => Promise<unknown> }> {
  const logger = {
    level: 'debug',
    debug: (log: unknown) => config.customLog(log),
    info: (log: unknown) => config.customLog(log),
    trace: (log: unknown) => config.customLog(log),
    error: (log: unknown) => config.customLog(log),
    warn: (log: unknown) => config.customLog(log),
    fatal: (log: unknown) => config.customLog(log),
    child: () => logger,
  }
  const app = fastify({
    logger: {
      prettyPrint: true,
      level: 'info',
    },
  })

  app.register(fastifyRateLimiter, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindowMs,
  })

  app.addHook<{ Headers: Headers }>('onRequest', async req => {
    if (req.headers.authorization !== `Bearer ${config.token}`) {
      throw new Error(
        `token is invalid. expected: "${`Bearer ${config.token}`}". actual: "${req.headers.Authorization}".`,
      )
    }
  })

  const db: Db = {
    namespaces: {
      [config.namespace]: {
        namespace: config.namespace,
        repos: {},
      },
    },
  }

  const cleanups: (() => Promise<unknown>)[] = []

  app.get<{
    Params: never
    Querystring: never
    Body: never
    Reply: 'alive'
    Headers: Headers
  }>('/', async (_req, res) => {
    res.send('alive')
  })

  app.post<{
    Params: never
    Querystring: never
    Body: CreateRepoRequest
    Reply: CreateRepoResponse | { error_message: 'Repository already exists' }
    Headers: Headers
  }>('/api/v1/repository', async (req, res) => {
    const repo = db.namespaces[req.body.namespace].repos[req.body.repository]
    if (repo) {
      res.code(HttpStatusCodes.BAD_REQUEST)
      return res.send({ error_message: 'Repository already exists' })
    } else {
      db.namespaces[req.body.namespace].repos[req.body.repository] = {
        repo: req.body.repository,
        builds: {},
        notifications: {},
      }
      return res.send({
        kind: 'image',
        namespace: req.body.namespace,
        name: req.body.repository,
      })
    }
  })

  app.get<{
    Params: {
      quayBuildId: string
    }
    Querystring: never
    Body: never
    Reply: GetBuildStatusResponse
    Headers: Headers
  }>('/api/v1/repository/build/:quayBuildId/status', async (req, res) => {
    for (const namespace of Object.values(db.namespaces)) {
      for (const repo of Object.values(namespace.repos)) {
        if (repo.builds[req.params.quayBuildId]) {
          return res.send({
            status: '',
            error: null,
            display_name: '',
            repository: { namespace: namespace.namespace, name: repo.repo },
            subdirectory: '',
            started: '',
            tags: [],
            archive_url: '',
            pull_robot: null,
            trigger: null,
            trigger_metadata: '',
            context: '',
            is_writer: true,
            phase: repo.builds[req.params.quayBuildId].status,
            resource_key: null,
            manual_user: '',
            id: repo.builds[req.params.quayBuildId].buildId,
            dockerfile_path: '',
          })
        }
      }
    }
    throw new Error(`build-id not found`)
  })

  app.delete<{
    Params: {
      quayBuildId: string
    }
    Querystring: never
    Body: never
    Reply: never
    Headers: Headers
  }>('/api/v1/repository/build/:quayBuildId', async (req, res) => {
    for (const namespace of Object.values(db.namespaces)) {
      for (const repo of Object.values(namespace.repos)) {
        if (repo.builds[req.params.quayBuildId]) {
          repo.builds[req.params.quayBuildId].status = QuayBuildStatus.cancelled
          return res.send()
        }
      }
    }
    throw new Error(`build-id not found`)
  })

  app.post<{
    Params: {
      repoName: string
    }
    Querystring: never
    Body: CreateNotificationRequest
    Reply: CreateNotificationResponse
    Headers: Headers
  }>('/api/v1/repository/:repoName/notification/', async (req, res) => {
    if (req.body.method !== 'webhook') {
      throw new Error(`only webhook is supported`)
    }
    for (const namespace of Object.values(db.namespaces)) {
      const repo = namespace.repos[req.params.repoName]
      if (repo) {
        const notificationId = chance().hash().slice(0, 8)
        repo.notifications[notificationId] = {
          event: req.body.event,
          method: req.body.method,
          notificationId,
          webhookAddress: req.body.config.url,
        }
        return res.send()
      }
    }
    throw new Error(`repo-name not found`)
  })

  app.post<{
    Params: {
      namespace: string
      repoName: string
    }
    Querystring: never
    Body: TriggerBuildRequest
    Reply: TriggerBuildResponse
    Headers: Headers
  }>('/api/v1/repository/:namespace/:repoName/build/', async (req, res) => {
    const repo = db.namespaces[req.params.namespace].repos[req.params.repoName]
    if (!repo) {
      throw new Error(`repo not found`)
    }
    const buildId = chance().hash().slice(0, 8)
    db.namespaces[req.params.namespace].repos[req.params.repoName].builds[buildId] = {
      buildId,
      status: QuayBuildStatus.waiting,
    }

    const build = db.namespaces[req.params.namespace].repos[req.params.repoName].builds[buildId]

    app.log.info(`build-id: "${buildId}" - start building dockerfile`)

    await res.send({
      status: '',
      error: null,
      display_name: chance().hash().slice(0, 8),
      repository: { namespace: req.params.namespace, name: req.params.repoName },
      subdirectory: '',
      started: new Date().toISOString(),
      tags: req.body.docker_tags,
      archive_url: req.body.archive_url,
      pull_robot: null,
      trigger: null,
      trigger_metadata: '',
      context: req.body.context,
      is_writer: true,
      phase: build.status,
      resource_key: null,
      manual_user: '',
      id: build.buildId,
      dockerfile_path: req.body.dockerfile_path,
    })

    await buildDockerFile({
      ...req.body,
      ...req.params,
      build,
      buildId,
      cleanups,
      db,
      log: app.log,
      config,
    })
  })

  const address = await app.listen(0)
  app.log.info(`quay-mock-service: "${address}"`)
  let closed = false
  return {
    address,
    cleanup: async () => {
      if (closed) {
        return
      }
      closed = true
      app.log.debug(`closing quay-mock-service: "${address}"`)
      await app.close()
      await Promise.allSettled(cleanups.map(f => f()))
    },
  }
}

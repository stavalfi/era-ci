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
import { NotificationsListResult } from '@era-ci/quay-client'
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
  const app = fastify({
    logger: {
      prettyPrint: true,
      level: config.isTestMode ? 'error' : 'info',
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

  app.get<{
    Params: {
      namespace: string
      repoName: string
    }
    Querystring: never
    Reply: NotificationsListResult
    Headers: Headers
  }>('/api/v1/repository/:namespace/:repoName/notification/', async (req, res) => {
    const repo = db.namespaces[req.params.namespace].repos[req.params.repoName]
    if (repo) {
      return res.send({
        notifications: Object.values(repo.notifications).map(n => ({
          event_config: {},
          uuid: n.notificationId,
          title: n.event,
          number_of_failures: 0,
          method: n.method,
          config: {
            url: n.webhookAddress,
          },
          event: n.event,
        })),
      })
    } else {
      throw new Error(`repo-name not found`)
    }
  })

  app.post<{
    Params: {
      namespace: string
      repoName: string
    }
    Querystring: never
    Body: CreateNotificationRequest
    Reply: CreateNotificationResponse
    Headers: Headers
  }>('/api/v1/repository/:namespace/:repoName/notification/', async (req, res) => {
    if (req.body.method !== 'webhook') {
      throw new Error(`only webhook is supported`)
    }
    const repo = db.namespaces[req.params.namespace].repos[req.params.repoName]
    if (repo) {
      const isNotificationAlreadySet = Object.values(repo.notifications).some(
        n => n.event === req.body.event && n.method === req.body.method && n.webhookAddress === req.body.config.url,
      )
      if (isNotificationAlreadySet) {
        throw new Error(`notification was already set - looks like a bug`)
      }
      const notificationId = chance().hash().slice(0, 8)
      repo.notifications[notificationId] = {
        event: req.body.event,
        method: req.body.method,
        notificationId,
        webhookAddress: req.body.config.url,
      }
      return res.send()
    } else {
      throw new Error(`repo-name not found`)
    }
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

    console.log(`build-id: "${buildId}" - start building dockerfile`)

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
      config,
    })
  })

  const address = await app.listen(config.port ?? 0)
  console.log(`quay-mock-service: "${address}"`)
  let closed = false
  return {
    address,
    cleanup: async () => {
      if (closed) {
        return
      }
      closed = true
      await app.close()
      await Promise.all(cleanups.map(f => f()))
      console.log(`closed quay-mock-service: "${address}"`)
    },
  }
}

// this is for local runs of the era-ci on itself
if (require.main === module) {
  startQuayMockService({
    port: 9876,
    isTestMode: false,
    dockerRegistryAddress: `http://localhost:35000`,
    namespace: 'org1',
    token: 'fake-mock-quay-token',
    rateLimit: {
      max: 1000,
      timeWindowMs: 1000,
    },
  })
}

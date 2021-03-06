/// <reference path="../../../../declarations.d.ts" />

/* eslint-disable no-console */

import { NotificationsListResult } from '@era-ci/quay-client'
import { queue } from 'async'
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
import pino from 'pino'
import pinoPretty from 'pino-pretty'

export {
  Config,
  CreateRepoRequest,
  CreateRepoResponse,
  GetBuildStatusResponse,
  Headers,
  TriggerBuildRequest,
  TriggerBuildResponse,
  Db as QuayMockDb,
}

export async function startQuayMockService(
  config: Config,
): Promise<{ db: Db; address: string; cleanup: () => Promise<unknown> }> {
  const app = fastify({
    logger: pino({
      level: config.isTestMode ? 'error' : 'info',
      prettyPrint: true,
      prettifier: pinoPretty,
    }),
  })

  app.register(fastifyRateLimiter, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindowMs,
  })

  app.addHook<{ Headers: Headers }>('onRequest', async req => {
    if (req.headers.authorization !== `Bearer ${config.token}`) {
      throw new Error(
        `quay-mock - token is invalid. expected: "${`Bearer ${config.token}`}". actual: "${
          req.headers.Authorization
        }".`,
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

  const taskQueues = queue<() => Promise<unknown>>(async task => {
    await task()
  }, 1)

  cleanups.push(async () => {
    if (!taskQueues.idle()) {
      // drain will not resolve if the queue is empty so we drain if it's not empty
      await taskQueues.drain()
    }
    taskQueues.kill()
  })

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
      namespace: string
      repoName: string
    }
    Querystring: never
    Body: never
    Reply: GetBuildStatusResponse
    Headers: Headers
  }>('/api/v1/repository/:namespace/:repoName/build/:quayBuildId/status', async (req, res) => {
    for (const repo of Object.values(db.namespaces[req.params.namespace].repos)) {
      if (repo.builds[req.params.quayBuildId]) {
        return res.send({
          status: '',
          error: null,
          display_name: '',
          repository: { namespace: req.params.namespace, name: repo.repo },
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
    throw new Error(`quay-mock - build-id not found`)
  })

  app.delete<{
    Params: {
      quayBuildId: string
      namespace: string
      repoName: string
    }
    Querystring: never
    Body: never
    Reply: never
    Headers: Headers
  }>('/api/v1/repository/:namespace/:repoName/build/:quayBuildId', async (req, res) => {
    for (const repo of Object.values(db.namespaces[req.params.namespace].repos)) {
      if (repo.builds[req.params.quayBuildId]) {
        repo.builds[req.params.quayBuildId].status = QuayBuildStatus.cancelled
        return res.send()
      }
    }
    throw new Error(`quay-mock - build-id not found`)
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
      throw new Error(`quay-mock - repo-name not found`)
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
      throw new Error(`quay-mock - only webhook is supported`)
    }
    const repo = db.namespaces[req.params.namespace].repos[req.params.repoName]
    if (repo) {
      const isNotificationAlreadySet = Object.values(repo.notifications).some(
        n => n.event === req.body.event && n.method === req.body.method && n.webhookAddress === req.body.config.url,
      )
      if (isNotificationAlreadySet) {
        console.log(
          `quay-mock - notification was already set - ignoring request and returning 200 (this is what real quay does)`,
        )
        return res.send()
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
      throw new Error(`quay-mock - repo-name not found`)
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
    const buildId = chance().hash().slice(0, 8)
    console.log(`quay-mock - build-id: "${buildId}", repo: "${req.params.repoName}" - created build-id`)
    if (req.body.context[0] !== '/') {
      throw new Error(
        `quay-mock - build-id: "${buildId}", repo: "${req.params.repoName}" - first char of context must be "/". received: "${req.body.context}" (without this, real quay builds won't work)`,
      )
    }
    if (req.body.context[req.body.context.length - 1] === '/') {
      throw new Error(
        `quay-mock - build-id: "${buildId}", repo: "${req.params.repoName}" - last char of context can't be "/". received: "${req.body.context}" (with this, real quay builds won't work)`,
      )
    }
    if (req.body.dockerfile_path[0] !== '/') {
      throw new Error(
        `quay-mock - build-id: "${buildId}", repo: "${req.params.repoName}" - first char of dockerfile_path must be "/". received: "${req.body.context}" (without this, real quay builds won't work)`,
      )
    }
    const repo = db.namespaces[req.params.namespace].repos[req.params.repoName]
    if (!repo) {
      throw new Error(`quay-mock - build-id: "${buildId}", repo: "${req.params.repoName}" - repo not found`)
    }
    db.namespaces[req.params.namespace].repos[req.params.repoName].builds[buildId] = {
      buildId,
      status: QuayBuildStatus.waiting,
    }

    const build = db.namespaces[req.params.namespace].repos[req.params.repoName].builds[buildId]

    console.log(`quay-mock - build-id: "${buildId}", repo: "${req.params.repoName}" - start building Dockerfile`)

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

    taskQueues.push(() =>
      buildDockerFile({
        ...req.body,
        ...req.params,
        build,
        buildId,
        cleanups,
        db,
        config,
      }),
    )
  })

  const address = await app.listen(config.port ?? 0)
  console.log(`quay-mock - "${address}"`)
  let closed = false
  return {
    db,
    address,
    cleanup: async () => {
      if (closed) {
        return
      }
      closed = true
      await app.close()
      await Promise.all(cleanups.map(f => f()))
      console.log(`quay-mock - closed: "${address}"`)
    },
  }
}

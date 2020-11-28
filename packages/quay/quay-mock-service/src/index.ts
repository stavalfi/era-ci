import { buildFullDockerImageName } from '@tahini/nc'
import chance from 'chance'
import compressing from 'compressing'
import { createFile, createFolder } from 'create-folder-structure'
import execa from 'execa'
import fastify from 'fastify'
import fastifyRateLimiter from 'fastify-rate-limit'
import fs from 'fs'
import got from 'got'
import HttpStatusCodes from 'http-status-codes'
import path from 'path'
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
  QuayNotificationEvents,
  TriggerBuildRequest,
  TriggerBuildResponse,
} from './types'
import { notify } from './utils'

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
      level: 'error',
    },
  })

  app.register(fastifyRateLimiter, {
    max: 10,
    timeWindow: 1 * 1000,
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

  app.get<{
    Params: never
    Querystring: never
    Body: never
    Reply: 'alive'
    Headers: Headers
  }>('/', async (_req, res) => res.send('alive'))

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
        const notificationId = chance().hash()
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
    const buildId = chance().hash()
    db.namespaces[req.params.namespace].repos[req.params.repoName].builds[buildId] = {
      buildId,
      status: QuayBuildStatus.waiting,
    }

    const build = db.namespaces[req.params.namespace].repos[req.params.repoName].builds[buildId]

    res.send({
      status: '',
      error: null,
      display_name: chance().hash(),
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
    try {
      await notify({
        db,
        event: QuayNotificationEvents.buildQueued,
        buildId,
        repoName: req.params.repoName,
      })

      build.status = QuayBuildStatus.started

      await notify({
        db,
        event: QuayNotificationEvents.buildStart,
        buildId,
        repoName: req.params.repoName,
      })

      const tarPath = await createFile()
      await new Promise((res, rej) =>
        got.stream(req.body.archive_url).pipe(fs.createWriteStream(tarPath)).once('finish', res).once('error', rej),
      )

      const extractedContextPath = await createFolder()

      await compressing.tar.uncompress(tarPath, extractedContextPath)

      for (const imageTag of req.body.docker_tags) {
        const image = buildFullDockerImageName({
          dockerOrganizationName: req.params.namespace,
          imageName: req.params.repoName,
          dockerRegistry: config.dockerRegistryAddress,
          imageTag,
        })

        await execa.command(
          `docker build -f Dockerfile -t ${image} ${path.join(extractedContextPath, req.body.context)}`,
          {
            cwd: path.dirname(path.join(extractedContextPath, req.body.dockerfile_path)),
            stdio: 'inherit',
          },
        )
        await execa.command(`docker push ${image}`, {
          stdio: 'inherit',
        })
        if ((build.status as QuayBuildStatus) !== QuayBuildStatus.cancelled) {
          build.status = QuayBuildStatus.complete
          await notify({
            db,
            event: QuayNotificationEvents.buildSuccess,
            buildId,
            repoName: req.params.repoName,
          })
        }
      }
    } catch (e) {
      if ((build.status as QuayBuildStatus) !== QuayBuildStatus.cancelled) {
        build.status = QuayBuildStatus.error
        await notify({
          db,
          event: QuayNotificationEvents.buildFailure,
          buildId,
          repoName: req.params.repoName,
        })
        app.log.error(e)
      }
    }
  })

  let closed = false
  return {
    address: await app.listen(0),
    cleanup: async () => {
      if (closed) {
        return
      }
      closed = true
      await app.close()
    },
  }
}

/* eslint-disable no-console */
import { buildFullDockerImageName } from '@era-ci/utils'
import compressing from 'compressing'
import { createFile, createFolder } from 'create-folder-structure'
import execa from 'execa'
import fs from 'fs'
import got from 'got'
import path from 'path'
import { Build, Config, Db, QuayBuildStatus, QuayNotificationEvents } from './types'

export async function notify({
  db,
  repoName,
  buildId,
  event,
}: {
  db: Db
  buildId: string
  repoName: string
  event: QuayNotificationEvents
}): Promise<void> {
  for (const namespace of Object.values(db.namespaces)) {
    const repo = namespace.repos[repoName]
    if (repo) {
      for (const notification of Object.values(repo.notifications)) {
        if (notification.event === event) {
          switch (notification.method) {
            case 'webhook':
              await got.post(notification.webhookAddress, {
                json: {
                  build_id: buildId,
                },
              })
          }
        }
      }
    }
  }
}

export async function buildDockerFile({
  db,
  repoName,
  buildId,
  archive_url,
  docker_tags,
  build,
  namespace,
  config,
  context,
  dockerfile_path,
  cleanups,
}: {
  config: Config
  db: Db
  archive_url: string
  buildId: string
  docker_tags: string[]
  namespace: string
  repoName: string
  build: Build
  cleanups: (() => Promise<unknown>)[]
  context: string
  dockerfile_path: string
}): Promise<void> {
  try {
    await notify({
      db,
      event: QuayNotificationEvents.buildQueued,
      buildId,
      repoName,
    })

    build.status = QuayBuildStatus.started

    await notify({
      db,
      event: QuayNotificationEvents.buildStart,
      buildId,
      repoName,
    })

    const tarPath = await createFile()
    await new Promise((res, rej) =>
      got.stream(archive_url).pipe(fs.createWriteStream(tarPath)).once('finish', res).once('error', rej),
    )

    const extractedContextPath = await createFolder()

    await compressing.tar.uncompress(tarPath, extractedContextPath)

    for (const imageTag of docker_tags) {
      const image = buildFullDockerImageName({
        dockerOrganizationName: namespace,
        imageName: repoName,
        dockerRegistry: config.dockerRegistryAddress,
        imageTag,
      })

      const p = execa.command(`docker build -f Dockerfile -t ${image} ${path.join(extractedContextPath, context)}`, {
        cwd: path.dirname(path.join(extractedContextPath, dockerfile_path)),
        stdio: 'pipe',
        env: {
          DOCKER_BUILDKIT: '1',
        },
      })

      cleanups.push(async () => p.kill())

      await p

      await execa.command(`docker push ${image}`, {
        stdio: 'pipe',
      })

      await execa.command(`docker rmi ${image}`, {
        stdio: 'pipe',
      })

      if ((build.status as QuayBuildStatus) !== QuayBuildStatus.cancelled) {
        build.status = QuayBuildStatus.complete
        await notify({
          db,
          event: QuayNotificationEvents.buildSuccess,
          buildId,
          repoName,
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
        repoName,
      }).catch(notifyError => {
        if (notifyError.code === 'ECONNREFUSED') {
          console.error(
            `stav4 [${repoName}] - quay-helper-service is down. probably because the test is over so we can ignore this error: ${notifyError}`,
          )
        }
      })
    }
    console.error(`failed to build-push image: ${repoName}`, e)
  }
}

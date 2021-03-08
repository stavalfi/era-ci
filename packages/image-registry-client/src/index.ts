/// <reference path="../../../declarations.d.ts" />

import { createClientV2 } from '@stavalfi/docker-registry-client'
import bunyan from 'bunyan'
import { buildFullDockerImageName } from '@era-ci/utils'

type Options = {
  registry: string
  auth?: {
    username: string
    token: string
  }
}

const log = bunyan.createLogger({
  name: 'docker-registry-client',
  level: 'error',
})

export const getClient = ({ dockerOrg, repo, auth, registry }: { dockerOrg: string; repo: string } & Options) =>
  createClientV2({
    name: buildFullDockerImageName({
      dockerRegistry: registry,
      dockerOrganizationName: dockerOrg,
      imageName: repo,
    }),
    log,
    insecure: registry.includes('http://'),
    username: auth?.username,
    password: auth?.token,
    // if some docker-registry doesn't support it, maybe we need to change it from 2 to 1. just for him (or in a retry process)
    maxSchemaVersion: 2,
  })

async function runTask<T>(task: () => Promise<T>, retry = 1): Promise<T> {
  try {
    return await task()
  } catch (error) {
    if (error?.message?.includes('429')) {
      if (retry >= 7) {
        throw error
      }
      // from got: https://github.com/sindresorhus/got#retry
      const sleepMs = 1000 * Math.pow(2, retry - 1) + Math.random() * 100
      await new Promise(res => setTimeout(res, sleepMs))
      return runTask(task, retry + 1)
    } else {
      throw error
    }
  }
}

export const listTags = (options: { dockerOrg: string; repo: string } & Options): Promise<string[]> => {
  const client = getClient(options)
  return runTask(
    () =>
      new Promise<string[]>((res, rej) =>
        client.listTags((err, tags) => {
          if (err) {
            rej(err)
          } else {
            res(tags.tags)
          }
          client.close()
        }),
      ),
  ).catch(error => {
    if (error?.message?.includes('NAME_UNKNOWN')) {
      return []
    } else {
      throw error
    }
  })
}

export const addTagToRemoteImage = async (
  options: { dockerOrg: string; repo: string; fromTag: string; toTag: string } & Options,
): Promise<void> => {
  const client = getClient(options)
  try {
    const manifestStr = await runTask(
      () =>
        new Promise<string>((res, rej) =>
          client.getManifest({ ref: options.fromTag }, (err, _manifest, _response, manifestStr) =>
            err ? rej(err) : res(manifestStr),
          ),
        ),
    )
    return await runTask(
      () =>
        new Promise<void>((res, rej) =>
          client.putManifest({ ref: options.toTag, manifest: manifestStr }, err => (err ? rej(err) : res())),
        ),
    )
  } finally {
    client.close()
  }
}

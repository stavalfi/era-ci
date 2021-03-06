import { Logger } from '@era-ci/core'
import { listTags } from '@era-ci/image-registry-client'
import { distructPackageJsonName, getPackages } from '@era-ci/utils'
import execa from 'execa'
import fs from 'fs'
import _ from 'lodash'
import path from 'path'
import semver from 'semver'
import { ResultingArtifact, TestFuncs } from './types'

async function latestNpmPackageDistTags(
  packageName: string,
  npmRegistry: string,
): Promise<{ [key: string]: string } | undefined> {
  try {
    const result = await execa.command(`npm view ${packageName} --json --registry ${npmRegistry}`, {
      stdio: 'pipe',
    })
    const resultJson = JSON.parse(result.stdout) || {}
    const distTags = resultJson['dist-tags'] as { [key: string]: string }
    return distTags
  } catch (e) {
    if (!e.message.includes('code E404')) {
      throw e
    }
  }
}

async function latestNpmPackageVersion(packageName: string, npmRegistry: string): Promise<string | undefined> {
  const distTags = await latestNpmPackageDistTags(packageName, npmRegistry)
  return distTags?.['latest']
}

async function publishedNpmPackageVersions(packageName: string, npmRegistry: string): Promise<Array<string>> {
  try {
    const npmRegistryAddress = npmRegistry
    const command = `npm view ${packageName} --json --registry ${npmRegistryAddress}`
    const result = await execa.command(command, { stdio: 'pipe' })
    const resultJson = JSON.parse(result.stdout) || {}
    return resultJson.versions
  } catch (e) {
    if (e.message.includes('code E404')) {
      return []
    } else {
      throw e
    }
  }
}

export const getPublishResult = (testFuncs: TestFuncs) => async ({
  toOriginalName,
  repoPath,
  testLogger,
  npm,
  processEnv,
}: {
  toOriginalName: (artifactName: string) => string
  repoPath: string
  testLogger: Logger
  npm: {
    npmRegistry: string
    npmRegistryUsername: string
    npmRegistryEmail: string
    npmRegistryPassword: string
  }
  processEnv: NodeJS.ProcessEnv
}): Promise<Map<string, ResultingArtifact>> => {
  const packagesPaths = await getPackages({ repoPath, processEnv }).then(r => Object.values(r).map(w => w.location))
  const packages = _.flatMap(
    await Promise.all(
      packagesPaths
        .map(packagePath => JSON.parse(fs.readFileSync(path.join(packagePath, 'package.json'), 'utf-8')).name)
        .map<Promise<[string, ResultingArtifact][]>>(async (packageName: string) => {
          const [allNpmVersions, highestNpmVersion, dockerTags] = await Promise.all([
            publishedNpmPackageVersions(packageName, testFuncs.getResources().npmRegistry.address),
            latestNpmPackageVersion(packageName, testFuncs.getResources().npmRegistry.address),
            listTags({
              dockerOrg: testFuncs.getResources().quayNamespace,
              repo: distructPackageJsonName(packageName).name,
              registry: testFuncs.getResources().dockerRegistry,
            }).then(tags => [
              ...tags.filter(tag => !semver.valid(tag)),
              ...semver.sort(tags.filter(tag => semver.valid(tag))),
            ]),
          ])
          const r: ResultingArtifact = {
            npm: {
              versions: allNpmVersions,
              highestVersion: highestNpmVersion,
            },
            docker: {
              tags: dockerTags,
            },
          }
          return [
            [packageName, r],
            [toOriginalName(packageName), r],
          ]
        }),
    ),
  )

  const published = packages.filter(
    ([, artifact]) =>
      artifact.docker.tags.length > 0 || artifact.npm.versions.length > 0 || artifact.npm.highestVersion,
  )
  return new Map(published)
}

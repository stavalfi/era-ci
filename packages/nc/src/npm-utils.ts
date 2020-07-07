import execa from 'execa'
import { ServerInfo } from './types'
import isIp from 'is-ip'
import ncLog from '@tahini/log'
import fse from 'fs-extra'
import path from 'path'
import os from 'os'
import { Redis } from 'ioredis'

const log = ncLog('ci:npm-utils')

export async function npmRegistryLogin({
  npmRegistry,
  npmRegistryEmail,
  npmRegistryToken,
  npmRegistryUsername,
}: {
  npmRegistry: ServerInfo
  npmRegistryUsername: string
  npmRegistryToken: string
  npmRegistryEmail: string
}): Promise<void> {
  const withPort = isIp.v4(npmRegistry.host) || npmRegistry.host === 'localhost' ? `:${npmRegistry.port}` : ''
  const npmRegistryAddress = `${npmRegistry.host}${withPort}`
  // only login in tests. publishing in non-interactive mode is very buggy and tricky.
  // ---------------------------------------------------------------------------------
  // it's an ugly why to check if we are in a test but at least,
  // it doesn't use env-var (that the user can use by mistake) or addtional ci-parameter.
  if (npmRegistryEmail === 'root@root.root') {
    const npmLoginPath = require.resolve('.bin/npm-login-noninteractive')
    log('logging in to npm-registry: "%s"', npmRegistryAddress)
    // `npm-login-noninteractive` has a node-api but it prints logs so this is ugly workaround to avoid printing the logs
    await execa.command(
      `${npmLoginPath} -u ${npmRegistryUsername} -p ${npmRegistryToken} -e ${npmRegistryEmail} -r ${npmRegistryAddress}`,
    )
    log('logged in to npm-registry: "%s"', npmRegistryAddress)
  } else {
    await fse.writeFile(path.join(os.homedir(), '.npmrc'), `//${npmRegistryAddress}/:_authToken=${npmRegistryToken}`)
  }
}

export async function isNpmHashAlreadyPulished(
  packageName: string,
  currentPackageHash: string,
  npmRegistry: ServerInfo,
) {
  const command = `npm view ${packageName}@latest-hash--${currentPackageHash} --json --registry ${npmRegistry.protocol}://${npmRegistry.host}:${npmRegistry.port}`
  try {
    await execa.command(command)
    return true
  } catch (e) {
    if (e.message.includes('code E404')) {
      return false
    } else {
      throw e
    }
  }
}

export async function getNpmLatestVersionInfo(
  packageName: string,
  npmRegistry: ServerInfo,
  redisClient: Redis,
): Promise<
  | {
      latestVersion?: string
      // it can be undefine if the ci failed after publishing the package but before setting this tag remotely.
      // in this case, the local-hash will be different and we will push again. its ok.
      latestVersionHash?: string
      allVersions: string[]
    }
  | undefined
> {
  try {
    const command = `npm view ${packageName} --json --registry ${npmRegistry.protocol}://${npmRegistry.host}:${npmRegistry.port}`
    log('searching the latest tag and hash: "%s"', command)
    const result = await execa.command(command)
    const resultJson = JSON.parse(result.stdout) || {}
    const allVersions: string[] = resultJson['versions'] || []
    const distTags = resultJson['dist-tags'] as { [key: string]: string }
    const latestVersion = distTags['latest']
    const latestVersionHashResult = Object.entries(distTags).find(
      ([key, value]) => value === latestVersion && key.startsWith('latest-hash--'),
    )?.[0]

    const latest = {
      latestVersionHash: latestVersionHashResult?.replace('latest-hash--', ''),
      latestVersion,
      allVersions,
    }
    log('latest tag and hash for "%s" are: "%O"', packageName, latest)
    return latest
  } catch (e) {
    if (e.message.includes('code E404')) {
      log(`"%s" weren't published`, packageName)
    } else {
      throw e
    }
  }
}

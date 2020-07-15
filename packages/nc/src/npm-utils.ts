import execa from 'execa'
import { ServerInfo } from './types'
import isIp from 'is-ip'
import { logger } from '@tahini/log'
import fse from 'fs-extra'
import path from 'path'
import os from 'os'

const log = logger('npm-utils')

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
  const npmRegistryAddress = `${npmRegistry.protocol}://${npmRegistry.host}${withPort}`
  // only login in tests. publishing in non-interactive mode is very buggy and tricky.
  // ---------------------------------------------------------------------------------
  // it's an ugly why to check if we are in a test but at least,
  // it doesn't use env-var (that the user can use by mistake) or addtional ci-parameter.
  if (npmRegistryEmail === 'root@root.root') {
    const npmLoginPath = require.resolve('.bin/npm-login-noninteractive')
    log.debug(`logging in to npm-registry: "${npmRegistryAddress}"`)
    // `npm-login-noninteractive` has a node-api but it prints logs so this is ugly workaround to avoid printing the logs
    await execa.command(
      `${npmLoginPath} -u ${npmRegistryUsername} -p ${npmRegistryToken} -e ${npmRegistryEmail} -r ${npmRegistryAddress}`,
    )
    log.debug(`logged in to npm-registry: "${npmRegistryAddress}"`)
  } else {
    await fse.writeFile(path.join(os.homedir(), '.npmrc'), `//${npmRegistryAddress}/:_authToken=${npmRegistryToken}`)
  }
}

export async function getNpmhighestVersionInfo(
  packageName: string,
  npmRegistry: ServerInfo,
): Promise<
  | {
      highestVersion?: string
      allVersions: string[]
    }
  | undefined
> {
  try {
    const command = `npm view ${packageName} --json --registry ${npmRegistry.protocol}://${npmRegistry.host}:${npmRegistry.port}`
    log.debug(`searching the latest tag and hash: "${command}"`)
    const result = await execa.command(command)
    const resultJson = JSON.parse(result.stdout) || {}
    const allVersions: string[] = resultJson['versions'] || []
    const distTags = resultJson['dist-tags'] as { [key: string]: string }
    const highestVersion = distTags['latest']

    const latest = {
      highestVersion,
      allVersions,
    }
    log.debug(`latest tag and hash for "${packageName}" are: "${latest}"`)
    return latest
  } catch (e) {
    if (e.message.includes('code E404')) {
      log.debug(`"${packageName}" weren't published`)
    } else {
      throw e
    }
  }
}

export async function isNpmVersionAlreadyPulished({
  npmRegistry,
  packageName,
  packageVersion,
}: {
  packageName: string
  packageVersion: string
  npmRegistry: ServerInfo
}) {
  const command = `npm view ${packageName}@${packageVersion} --json --registry ${npmRegistry.protocol}://${npmRegistry.host}:${npmRegistry.port}`
  try {
    const { stdout } = await execa.command(command)
    return Boolean(stdout) // for some reaosn, if the version is not found, it doesn't throw an error. but the stdout is empty.
  } catch (e) {
    if (e.message.includes('code E404')) {
      return false
    } else {
      throw e
    }
  }
}

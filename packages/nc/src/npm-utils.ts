import { ServerInfo } from './types'
import isIp from 'is-ip'
import { logger } from '@tahini/log'
import fse from 'fs-extra'
import path from 'path'
import os from 'os'
import _ from 'lodash'
import { execaCommand } from './utils'

const log = logger('npm-utils')

export function getNpmRegistryAddress(npmRegistry: ServerInfo): string {
  if (isIp.v4(npmRegistry.host) || npmRegistry.host === 'localhost') {
    return `${npmRegistry.protocol}://${npmRegistry.host}:${npmRegistry.port}`
  } else {
    return `${npmRegistry.protocol}://${npmRegistry.host}`
  }
}

export async function npmRegistryLogin({
  npmRegistry,
  npmRegistryEmail,
  npmRegistryToken,
  npmRegistryUsername,
  silent,
  repoPath,
}: {
  silent?: boolean
  npmRegistry: ServerInfo
  npmRegistryUsername: string
  npmRegistryToken: string
  npmRegistryEmail: string
  repoPath: string
}): Promise<void> {
  const npmRegistryAddress = getNpmRegistryAddress(npmRegistry)
  // only login in tests. publishing in non-interactive mode is very buggy and tricky.
  // ---------------------------------------------------------------------------------
  // it's an ugly why to check if we are in a test but at least,
  // it doesn't use env-var (that the user can use by mistake) or addtional ci-parameter.
  if (npmRegistryEmail === 'root@root.root') {
    const npmLoginPath = require.resolve('.bin/npm-login-noninteractive')

    if (!silent) {
      log.verbose(`logging in to npm-registry: "${npmRegistryAddress}"`)
    }
    // `npm-login-noninteractive` has a node-api but it prints logs so this is ugly workaround to avoid printing the logs
    await execaCommand(
      `${npmLoginPath} -u ${npmRegistryUsername} -p ${npmRegistryToken} -e ${npmRegistryEmail} -r ${npmRegistryAddress}`,
      { cwd: repoPath, stdio: 'pipe' },
    )
    if (!silent) {
      log.verbose(`logged in to npm-registry: "${npmRegistryAddress}"`)
    }
  } else {
    await fse.writeFile(path.join(os.homedir(), '.npmrc'), `//${npmRegistryAddress}/:_authToken=${npmRegistryToken}`)
  }
}

export async function getNpmhighestVersionInfo(
  packageName: string,
  npmRegistry: ServerInfo,
  repoPath: string,
): Promise<
  | {
      highestVersion?: string
      allVersions: string[]
    }
  | undefined
> {
  try {
    const command = `npm view ${packageName} --json --registry ${getNpmRegistryAddress(npmRegistry)}`
    log.verbose(`searching the latest tag and hash: "${command}"`)
    const result = await execaCommand(command, { cwd: repoPath, stdio: 'pipe' })
    const resultJson = JSON.parse(result.stdout) || {}
    const allVersions: string[] = resultJson['versions'] || []
    const distTags = resultJson['dist-tags'] as { [key: string]: string }
    const highestVersion = distTags['latest']

    const latest = {
      highestVersion,
      allVersions,
    }
    log.verbose(
      `latest tag and hash for "${packageName}" are: "${JSON.stringify(_.omit(latest, ['allVersions']), null, 2)}"`,
    )
    return latest
  } catch (e) {
    if (e.message.includes('code E404')) {
      log.verbose(`"${packageName}" weren't published`)
    } else {
      throw e
    }
  }
}

export async function isNpmVersionAlreadyPulished({
  npmRegistry,
  packageName,
  packageVersion,
  repoPath,
}: {
  packageName: string
  packageVersion: string
  npmRegistry: ServerInfo
  repoPath: string
}) {
  const command = `npm view ${packageName}@${packageVersion} --json --registry ${getNpmRegistryAddress(npmRegistry)}`
  try {
    const { stdout } = await execaCommand(command, { cwd: repoPath, stdio: 'pipe' })
    return Boolean(stdout) // for some reaosn, if the version is not found, it doesn't throw an error. but the stdout is empty.
  } catch (e) {
    if (e.message.includes('code E404')) {
      return false
    } else {
      throw e
    }
  }
}

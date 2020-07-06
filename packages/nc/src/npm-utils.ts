import execa from 'execa'
import { ServerInfo } from './types'
import isIp from 'is-ip'
import ncLog from '@tahini/log'
import fse from 'fs-extra'
import path from 'path'
import os from 'os'

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

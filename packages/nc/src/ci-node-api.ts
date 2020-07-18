import execa, { StdioOption } from 'execa'
import { CiOptions } from './types'

export { CiOptions }

export const runCiCli = async (
  ciOptions: CiOptions,
  runOptions?: {
    stdio?: 'pipe' | 'ignore' | 'inherit' | readonly StdioOption[]
    reject?: boolean
  },
): Promise<execa.ExecaChildProcess> => {
  const ciCliPath = require.resolve('@tahini/nc/dist/src/index.js')

  const command = `\
  node --unhandled-rejections=strict ${ciCliPath}\
    --log-file ${ciOptions.logFilePath} \
    --cwd ${ciOptions.repoPath} \
    --master-build=${ciOptions.isMasterBuild} \
    --dry-run=${ciOptions.isDryRun} \
    --skip-tests=${ciOptions.skipTests} \
    --docker-registry ${ciOptions.dockerRegistry.protocol}://${ciOptions.dockerRegistry.host}:${
    ciOptions.dockerRegistry.port
  } \
    --npm-registry ${ciOptions.npmRegistry.protocol}://${ciOptions.npmRegistry.host}:${ciOptions.npmRegistry.port} \
    --git-repo ${ciOptions.gitServer.protocol}://${ciOptions.gitServer.host}:${ciOptions.gitServer.port}/${
    ciOptions.gitOrganizationName
  }/${ciOptions.gitRepositoryName} \
    --docker-repository ${ciOptions.dockerOrganizationName} \
    ${ciOptions.auth.dockerRegistryToken ? `--docker-registry-token ${ciOptions.auth.dockerRegistryToken}` : ''} \
    ${
      ciOptions.auth.dockerRegistryUsername ? `--docker-registry-username ${ciOptions.auth.dockerRegistryUsername}` : ''
    } \
    --git-server-token ${ciOptions.auth.gitServerToken} \
    --git-server-username ${ciOptions.auth.gitServerUsername} \
    --npm-registry-username ${ciOptions.auth.npmRegistryUsername} \
    --npm-registry-email ${ciOptions.auth.npmRegistryEmail} \
    --npm-registry-token ${ciOptions.auth.npmRegistryToken} \
    ${ciOptions.auth.redisPassword ? `--redis-password ${ciOptions.auth.redisPassword}` : ''} \
    --redis-server ${ciOptions.redisServer.host}:${ciOptions.redisServer.port}
  `

  return execa.command(command, {
    stdio: runOptions?.stdio || 'inherit',
    reject: runOptions?.reject ?? true,
  })
}

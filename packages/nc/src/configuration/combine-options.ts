import parseGitUrl from 'git-url-parse'
import redisUrlParse from 'redis-url-parse'
import urlParse from 'url-parse'
import { CiOptions, ConfigFileOptions, Protocol, ServerInfo, TargetInfo, TargetType } from '../types'
import { execaCommand } from '../utils'

function isProtocolSupported(protocol: string): protocol is Protocol {
  return Object.values(Protocol).includes(protocol as Protocol)
}

function getPort(procotol: Protocol, port: number | string): number {
  if (port === 0) {
    return port
  }
  return Number(port) || (procotol === Protocol.http ? 80 : 443)
}

function getServerInfoFromTarget<Target extends TargetType, DeploymentClient>(
  targetInfo: TargetInfo<Target, DeploymentClient, string>,
): ServerInfo {
  const parsed = urlParse(targetInfo.registry)
  const protocol = parsed.protocol.replace(':', '')
  const protocolError = (protocol: string) => {
    const allowedProtocols = Object.values(Protocol).join(' or ')
    return new Error(
      `url must contain protocol: "${allowedProtocols}". received protocol: "${protocol}" -->> "${targetInfo.registry}"`,
    )
  }
  if (!isProtocolSupported(protocol)) {
    throw protocolError(protocol)
  }
  return {
    host: parsed.hostname,
    port: getPort(protocol, parsed.port),
    protocol: protocol,
  }
}

export async function combineOptions<DeploymentClient>({
  cliOptions,
  configFileOptions,
}: {
  configFileOptions: ConfigFileOptions<DeploymentClient>
  cliOptions: { repoPath: string }
}): Promise<CiOptions<DeploymentClient>> {
  const { stdout: gitUrl } = await execaCommand(`git config --get remote.origin.url`, {
    stdio: 'pipe',
    cwd: cliOptions.repoPath,
  })
  const parsedGitUrl = parseGitUrl(gitUrl)
  const parsedRedisServer = redisUrlParse(configFileOptions.redis.redisServer)

  return {
    startFlowDateUtc: new Date().toISOString(),
    repoPath: cliOptions.repoPath,
    logFilePath: configFileOptions.logFilePath,
    git: {
      gitRepoUrl: gitUrl,
      gitOrganizationName: parsedGitUrl.organization,
      gitRepositoryName: parsedGitUrl.name,
      auth: {
        token: configFileOptions.git.auth.token,
        username: configFileOptions.git.auth.username,
      },
    },
    redis: {
      redisServer: {
        host: parsedRedisServer.host,
        port: parsedRedisServer.port,
      },
      auth: {
        password: configFileOptions.redis.auth.password,
      },
    },
    targetsInfo:
      configFileOptions.targetsInfo &&
      Object.fromEntries(
        Object.entries(configFileOptions.targetsInfo)
          .filter(([targetType, info]) => targetType && info)
          .map(([targetType, info]) => {
            const registry = getServerInfoFromTarget(info!)
            if (!registry) {
              throw new Error(`can't parse url: "${info?.registry}". can't extract protocol, host and port`)
            }
            return [
              targetType,
              {
                ...info!,
                shouldPublish: info!.shouldPublish,
                registry,
                publishAuth: info!.publishAuth,
                shouldDeploy: info!.shouldDeploy,
                deployment: info!.deployment,
              },
            ]
          }),
      ),
  }
}

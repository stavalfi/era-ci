import { ConfigFileOptions, CiOptions, Protocol } from '../types'
import urlParse from 'url-parse'
import execa from 'execa'
import parseGitUrl from 'git-url-parse'
import redisUrlParse from 'redis-url-parse'

function isProtocolSupported(url: string, protocol: string): protocol is Protocol {
  return Object.values(Protocol).includes(protocol as Protocol)
}

function getPort(procotol: Protocol, port: number | string): number {
  return Number(port) || (procotol === Protocol.http ? 80 : 443)
}

export async function combineOptions<DeploymentClient>({
  cliOptions,
  configFileOptions,
}: {
  configFileOptions: ConfigFileOptions<DeploymentClient>
  cliOptions: { repoPath: string }
}): Promise<CiOptions<DeploymentClient>> {
  const { stdout: gitUrl } = await execa.command(`git config --get remote.origin.url`, { stdio: 'pipe' })
  const parsedGitUrl = parseGitUrl(gitUrl)
  const parsedNpmRegistry = urlParse(configFileOptions.npmRegistryUrl)
  const parsedRedisServer = redisUrlParse(configFileOptions.redisServerUrl)
  const parsedDockerRegistry = urlParse(configFileOptions.dockerRegistryUrl)

  const dockerProtocol = parsedDockerRegistry.protocol.replace(':', '')
  const npmProtocol = parsedNpmRegistry.protocol.replace(':', '')
  const protocolError = (url: string, protocol: string) => {
    const allowedProtocols = Object.values(Protocol).join(' or ')
    return new Error(
      `url must contain protocol: "${allowedProtocols}". received protocol: "${dockerProtocol}" -->> ${configFileOptions.dockerRegistryUrl}`,
    )
  }
  if (!isProtocolSupported(configFileOptions.dockerRegistryUrl, dockerProtocol)) {
    throw protocolError(configFileOptions.dockerRegistryUrl, dockerProtocol)
  }
  if (!isProtocolSupported(configFileOptions.npmRegistryUrl, npmProtocol)) {
    throw protocolError(configFileOptions.npmRegistryUrl, npmProtocol)
  }

  return {
    repoPath: cliOptions.repoPath,
    shouldDeploy: configFileOptions.shouldDeploy,
    ...('deployment' in configFileOptions && {
      shouldDeploy: configFileOptions.shouldDeploy,
      deployment: configFileOptions.deployment,
    }),
    shouldPublish: configFileOptions.shouldPublish,
    dockerOrganizationName: configFileOptions.dockerOrganizationName,
    dockerRegistry: {
      host: parsedDockerRegistry.hostname,
      port: getPort(dockerProtocol, parsedDockerRegistry.port),
      protocol: dockerProtocol,
    },
    redisServer: {
      host: parsedRedisServer.host,
      port: parsedRedisServer.port,
    },
    npmRegistry: {
      host: parsedNpmRegistry.hostname,
      port: getPort(npmProtocol, parsedNpmRegistry.port),
      protocol: npmProtocol,
    },
    gitRepoUrl: gitUrl,
    gitOrganizationName: parsedGitUrl.organization,
    gitRepositoryName: parsedGitUrl.name,
    auth: {
      gitServerToken: parsedGitUrl.token,
      gitServerUsername: parsedGitUrl.user,
      npmRegistryEmail: configFileOptions.npmRegistryEmail,
      npmRegistryUsername: parsedNpmRegistry.username,
      npmRegistryToken: parsedNpmRegistry.password,
      dockerRegistryUsername: parsedDockerRegistry.username,
      dockerRegistryToken: parsedDockerRegistry.password,
      redisPassword: parsedRedisServer.password,
    },
  }
}

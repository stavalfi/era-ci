import execa from 'execa'
import { ServerInfo, Protocol } from '../../src/types'
import { GitServer, starGittServer } from './git-server-testkit'

type Deployment = { serverInfo: ServerInfo; cleanup: () => Promise<unknown> }

async function startDockerImage(fullDockerImageName: string, port: number): Promise<Deployment> {
  const { stdout: dockerRegistryContainerId } = await execa.command(
    `docker run -d -p 0:${port} ${fullDockerImageName}`,
    { stdio: 'pipe' },
  )
  const { stdout: dockerRegistryPort } = await execa.command(
    `docker inspect --format="{{(index (index .NetworkSettings.Ports \\"${port}/tcp\\") 0).HostPort}}" ${dockerRegistryContainerId}`,
    {
      shell: true,
      stdio: 'pipe',
    },
  )
  return {
    cleanup: () =>
      execa.command(`docker kill ${dockerRegistryContainerId}`, { stdio: 'pipe' }).then(
        () => execa.command(`docker rm ${dockerRegistryContainerId}`, { stdio: 'pipe' }),
        () => Promise.resolve(),
      ),
    serverInfo: {
      protocol: Protocol.http,
      port: Number(dockerRegistryPort),
      host: 'localhost',
    },
  }
}

export function prepareTestResources() {
  let dockerRegistry: Deployment
  let npmRegistryDeployment: Deployment
  let redisDeployment: Deployment
  let gitServer: GitServer

  // verdaccio allow us to login as any user & password & email
  const verdaccioCardentials = {
    npmRegistryUsername: 'root',
    npmRegistryToken: 'root',
    npmRegistryEmail: 'root@root.root',
  }

  beforeAll(async () => {
    gitServer = await starGittServer()
    const deployments = await Promise.all([
      startDockerImage('verdaccio/verdaccio', 4873),
      startDockerImage('redis', 6379),
      startDockerImage('registry:2', 5000),
    ])
    npmRegistryDeployment = deployments[0]
    redisDeployment = deployments[1]
    dockerRegistry = deployments[2]
  })
  afterAll(async () => {
    await Promise.all(
      [
        gitServer && gitServer.close(),
        npmRegistryDeployment && npmRegistryDeployment.cleanup(),
        redisDeployment && redisDeployment.cleanup(),
        dockerRegistry && dockerRegistry.cleanup(),
      ].filter(Boolean),
    ).catch(() => Promise.resolve())
  })

  return {
    get: () => ({
      npmRegistry: {
        host: npmRegistryDeployment.serverInfo.host,
        port: npmRegistryDeployment.serverInfo.port,
        protocol: npmRegistryDeployment.serverInfo.protocol,
        auth: verdaccioCardentials,
      },
      dockerRegistry: {
        host: dockerRegistry.serverInfo.host,
        port: dockerRegistry.serverInfo.port,
        protocol: dockerRegistry.serverInfo.protocol,
      },
      redisServer: {
        host: redisDeployment.serverInfo.host,
        port: redisDeployment.serverInfo.port,
      },
      gitServer,
    }),
  }
}

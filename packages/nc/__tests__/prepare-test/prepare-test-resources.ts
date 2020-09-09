import { Protocol, ServerInfo } from '../../src/types'
import { GitServer, starGittServer } from './git-server-testkit'

type Deployment = { serverInfo: ServerInfo; cleanup: () => Promise<unknown> }

export function prepareTestResources() {
  let dockerRegistry: Deployment
  let npmRegistryDeployment: Deployment
  let redisDeployment: Deployment
  let gitServer: GitServer

  // verdaccio allow us to login as any user & password & email
  const verdaccioCardentials = {
    username: 'root',
    token: 'root',
    email: 'root@root.root',
  }

  beforeAll(async () => {
    gitServer = await starGittServer()
    npmRegistryDeployment = {
      cleanup: () => Promise.resolve(),
      serverInfo: {
        host: 'localhost',
        port: 34873,
        protocol: Protocol.http,
      },
    }
    redisDeployment = {
      cleanup: () => Promise.resolve(),
      serverInfo: {
        host: 'localhost',
        port: 36379,
      },
    }
    dockerRegistry = {
      cleanup: () => Promise.resolve(),
      serverInfo: {
        host: 'localhost',
        port: 35000,
        protocol: Protocol.http,
      },
    }
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

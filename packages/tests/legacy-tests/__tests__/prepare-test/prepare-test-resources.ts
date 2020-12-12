import { GitServer, starGittServer } from './git-server-testkit'

type Deployment = { address: string; cleanup: () => Promise<unknown> }

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
      address: `http://localhost:34873`,
    }
    redisDeployment = {
      cleanup: () => Promise.resolve(),
      address: `redis://localhost:36379`,
    }
    dockerRegistry = {
      cleanup: () => Promise.resolve(),
      address: `http://localhost:35000`,
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
        address: npmRegistryDeployment.address,
        auth: verdaccioCardentials,
      },
      dockerRegistry: dockerRegistry.address,
      redisServer: redisDeployment.address,
      gitServer,
    }),
  }
}
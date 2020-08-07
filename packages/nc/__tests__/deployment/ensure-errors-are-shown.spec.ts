import chance from 'chance'
import { newEnv } from '../prepare-test'
import { TargetType } from '../prepare-test/types'

const { createRepo } = newEnv()

test('make sure that errors from initializeDeploymentClient function are shown', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.docker,
      },
    ],
  })

  const error = `error-${chance().hash()}`

  const result = await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
        shouldDeploy: true,
        deploymentStrigifiedSection: `\
          {
            initializeDeploymentClient: async () => Promise.reject('${error}'),
            deploy: async () => Promise.reject('we wont be here1'),
            destroyDeploymentClient: async () => Promise.reject('we wont be here2'),
          }`,
      },
    },
    execaOptions: { reject: false, stdio: 'pipe' },
  })
  expect(result.ciProcessResult.stderr).toMatch(error)
})

test('make sure that errors from deploy function are shown', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.docker,
      },
    ],
  })

  const error = `error-${chance().hash()}`

  const result = await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
        shouldDeploy: true,
        deploymentStrigifiedSection: `\
          {
            initializeDeploymentClient: async () => Promise.resolve(),
            deploy: async () => Promise.reject('${error}'),
            destroyDeploymentClient: async () => Promise.reject('we wont be here2'),
          }`,
      },
    },
    execaOptions: { reject: false, stdio: 'pipe' },
  })
  expect(result.ciProcessResult.stderr).toMatch(error)
})

test('make sure that errors from destroyDeploymentClient function are shown', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.docker,
      },
    ],
  })

  const error = `error-${chance().hash()}`

  const result = await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
        shouldDeploy: true,
        deploymentStrigifiedSection: `\
          {
            initializeDeploymentClient: async () => Promise.resolve(),
            deploy: async () => Promise.resolve(),
            destroyDeploymentClient: async () => Promise.reject('${error}'),
          }`,
      },
    },
    execaOptions: { reject: false, stdio: 'pipe' },
  })
  expect(result.ciProcessResult.stderr).toMatch(error)
})

import chance from 'chance'
import expect from 'expect'
import { newEnv, test } from '../prepare-test'
import { TargetType } from '../prepare-test/types'

const { createRepo } = newEnv(test)

test('make sure that errors from initializeDeploymentClient function are shown', async t => {
  const { runCi } = await createRepo(t, {
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.docker,
      },
    ],
  })

  const error = `error-${chance().hash().slice(0, 8)}`

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

test('make sure that errors from deploy function are shown', async t => {
  const { runCi } = await createRepo(t, {
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.docker,
      },
    ],
  })

  const error = `error-${chance().hash().slice(0, 8)}`

  const result = await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
        shouldDeploy: true,
        deploymentStrigifiedSection: `\
          {
            initializeDeploymentClient: () => Promise.resolve(),
            deploy: async () => Promise.reject('${error}'),
            destroyDeploymentClient: async () => Promise.reject('we wont be here2'),
          }`,
      },
    },
    execaOptions: { reject: false, stdio: 'pipe' },
  })
  expect(result.ciProcessResult.stderr).toMatch(error)
})

test('make sure that errors from destroyDeploymentClient function are shown', async t => {
  const { runCi } = await createRepo(t, {
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.docker,
      },
    ],
  })

  const error = `error-${chance().hash().slice(0, 8)}`

  const result = await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
        shouldDeploy: true,
        deploymentStrigifiedSection: `\
          {
            initializeDeploymentClient: () => Promise.resolve(),
            deploy: () => Promise.resolve(),
            destroyDeploymentClient: async () => Promise.reject('${error}'),
          }`,
      },
    },
    execaOptions: { reject: false, stdio: 'pipe' },
  })
  expect(result.ciProcessResult.stderr).toMatch(error)
})

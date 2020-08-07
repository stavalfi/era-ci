import { newEnv } from '../prepare-test'
import { TargetType } from '../prepare-test/types'
import chance from 'chance'

const { createRepo } = newEnv()

test('1 package - make sure that app dont crush when we skip deployment', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.docker,
      },
    ],
  })

  const master = await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })

  expect(master.published.get('a')?.docker?.tags).toEqual(['1.0.0'])
})

test('1 package - make sure we skip deployment', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.docker,
      },
    ],
  })

  await expect(
    runCi({
      targetsInfo: {
        docker: {
          shouldPublish: true,
          shouldDeploy: false,
          deploymentStrigifiedSection: `\
          {
            initializeDeploymentClient: async () => Promise.reject('error1'),
            deploy: async () => Promise.reject('error2'),
            destroyDeploymentClient: async () => Promise.reject('error3'),
          }`,
        },
      },
    }),
  ).resolves.toBeTruthy()
})

test('1 package - ensure deploymentClient is passed to other functions', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.docker,
      },
    ],
  })

  const expectedDeploymentClient = chance().hash()

  const result = await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
        shouldDeploy: true,
        deploymentStrigifiedSection: `\
  {
    initializeDeploymentClient: async () => "${expectedDeploymentClient}",
    deploy: async ({ deploymentClient }) => console.log("deploy-${expectedDeploymentClient}"),
    destroyDeploymentClient: async ({ deploymentClient }) => console.log("destroyDeploymentClient-${expectedDeploymentClient}"),
  }`,
      },
    },
    execaOptions: { stdio: 'pipe' },
  })

  expect(result.ciProcessResult.stdout).toMatch(`deploy-${expectedDeploymentClient}`)
  expect(result.ciProcessResult.stdout).toMatch(`destroyDeploymentClient-${expectedDeploymentClient}`)
})

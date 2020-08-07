import { newEnv } from '../prepare-test'
import { TargetType } from '../prepare-test/types'
import chance from 'chance'
import { manageTest } from '../prepare-test/test-helpers'

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

test('1 package - ensure only published packages are passed to deploy-function', async () => {
  const bTest = await manageTest()

  const { runCi, toActualName } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.docker,
      },
      {
        name: 'b',
        version: '1.0.0',
        targetType: TargetType.docker,
        scripts: { test: bTest.testScript },
      },
      {
        name: 'c',
        version: '1.0.0',
      },
      {
        name: 'd',
        version: '1.0.0',
        targetType: TargetType.npm,
      },
    ],
  })

  await bTest.makeTestsFail()

  const result = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
        shouldDeploy: true,
        deploymentStrigifiedSection: `\
    {
      initializeDeploymentClient: async () => Promise.resolve(),
      deploy: async ({ artifactToDeploy }) => console.log("deploy-"+artifactToDeploy.packageJson?.name),
      destroyDeploymentClient: async ({ deploymentClient }) => Promise.resolve(),
    }`,
      },
      docker: {
        shouldPublish: true,
        shouldDeploy: true,
        deploymentStrigifiedSection: `\
    {
      initializeDeploymentClient: async () => Promise.resolve(),
      deploy: async ({ artifactToDeploy }) => console.log("deploy-"+artifactToDeploy.packageJson?.name),
      destroyDeploymentClient: async ({ deploymentClient }) => Promise.resolve(),
    }`,
      },
    },
    execaOptions: {
      stdio: 'pipe',
      reject: false, // tests of package-b will fail so the ci will fail
    },
  })

  expect(result.ciProcessResult.stdout).toMatch(`deploy-${toActualName('a')}`)
  expect(result.ciProcessResult.stdout).toMatch(`deploy-${toActualName('d')}`)
})

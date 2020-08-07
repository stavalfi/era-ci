import { newEnv } from '../prepare-test'
import { manageTest } from '../prepare-test/test-helpers'
import { TargetType } from '../prepare-test/types'

const { createRepo } = newEnv()

test('packages with failed tests wont deploy', async () => {
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
  expect(result.ciProcessResult.stdout).toMatch(`deploy-${toActualName('c')}`)
})

// reason for this test/feature:
// if the k8s-cluster is out of sync with the master branch, it maybe because
// someone is manually manage the deployments in the k8s-cluster.
// he probably has a good reason to. maybe revert a deployment due to a bug in production.
// to make sure that other merges of PRs won't bring back the bug of one of the micro-services,
// we need to make sure that only changed packages in the current flow can be deployed.
describe('ensure only if package was not published in the current flow, it will not be deployed', () => {
  test('no deployment if package didnt change', async () => {
    const aDeployment = await manageTest()
    const { runCi } = await createRepo({
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          targetType: TargetType.docker,
        },
      ],
    })

    const runCiOptions = {
      targetsInfo: {
        docker: {
          shouldPublish: true,
          shouldDeploy: true,
          deploymentStrigifiedSection: `\
                {
                    initializeDeploymentClient: async () => Promise.resolve(),
                    deploy: async ({ artifactToDeploy }) => {
                        if(artifactToDeploy.packageJson.name?.startsWith("a")){
                          require('child_process').execSync('${aDeployment.testScript}')
                        }
                    },
                    destroyDeploymentClient: async ({ deploymentClient }) => Promise.resolve(),
                }`,
        },
      },
    }

    await aDeployment.makeTestsPass()
    await expect(runCi(runCiOptions)).resolves.toBeTruthy()

    await aDeployment.makeTestsFail()
    await expect(runCi(runCiOptions)).resolves.toBeTruthy()
  })

  test('no deployment if other package changed', async () => {
    const aDeployment = await manageTest()
    const { runCi, addRandomFileToPackage } = await createRepo({
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
        },
      ],
    })

    const runCiOptions = {
      targetsInfo: {
        docker: {
          shouldPublish: true,
          shouldDeploy: true,
          deploymentStrigifiedSection: `\
                {
                  initializeDeploymentClient: async () => Promise.resolve(),
                  deploy: async ({ artifactToDeploy }) => {
                      if(artifactToDeploy.packageJson.name?.startsWith("a")){
                        require('child_process').execSync('${aDeployment.testScript}')
                      }
                  },
                  destroyDeploymentClient: async ({ deploymentClient }) => Promise.resolve(),
                }`,
        },
      },
    }

    await aDeployment.makeTestsPass()

    await expect(runCi(runCiOptions)).resolves.toBeTruthy()

    await aDeployment.makeTestsFail()
    await addRandomFileToPackage('b')

    await expect(runCi(runCiOptions)).resolves.toBeTruthy()
  })
})

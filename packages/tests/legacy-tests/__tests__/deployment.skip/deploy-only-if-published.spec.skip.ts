import expect from 'expect'
import { newEnv } from '../prepare-test'
import { manageStepResult } from '../prepare-test/test-helpers'
import { TargetType, TestOptions } from '../prepare-test/types'

const { createRepo } = newEnv()

test('packages with failed tests wont deploy', async () => {
  const bTest = await manageStepResult()

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
        scripts: { test: bTest.stepScript },
      },
      {
        name: 'c',
        version: '1.0.0',
        targetType: TargetType.npm,
      },
    ],
  })

  await bTest.makeStepFail()

  const result = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
        shouldDeploy: true,
        deploymentStrigifiedSection: `\
    {
      initializeDeploymentClient: () => Promise.resolve(),
      deploy: async ({ artifactToDeploy }) => console.log("deploy-"+artifactToDeploy.packageJson?.name),
      destroyDeploymentClient: async ({ deploymentClient }) => Promise.resolve(),
    }`,
      },
      docker: {
        shouldPublish: true,
        shouldDeploy: true,
        deploymentStrigifiedSection: `\
    {
      initializeDeploymentClient: () => Promise.resolve(),
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

// usecase: incase the developer revert a PR, we want to re-deploy the previous deployment again!
test(`deployment succeed but there will be an addtional deployment in the next flow`, async () => {
  const aDeployment = await manageStepResult()
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
                    initializeDeploymentClient: () => Promise.resolve(),
                    deploy: async ({ artifactToDeploy }) => {
                        if(artifactToDeploy.packageJson.name?.startsWith("a")){
                          require ('child_process').execSync('${aDeployment.stepScript}')
                        }
                    },
                    destroyDeploymentClient: async ({ deploymentClient }) => Promise.resolve(),
                }`,
      },
    },
  }

  await aDeployment.makeStepPass()
  await expect(runCi(runCiOptions)).resolves.toBeTruthy()

  await aDeployment.makeStepFail()
  await expect(runCi(runCiOptions)).rejects.toBeTruthy()
})

// usecase: i don't really have one. it's just the same behavior as if the deployment succeed -> we will redeploy anyway.
test(`deployment failed but there will be an addtional deployment in the next flow`, async () => {
  const aDeployment = await manageStepResult()
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.docker,
      },
    ],
  })

  const runCiOptions: TestOptions = {
    targetsInfo: {
      docker: {
        shouldPublish: true,
        shouldDeploy: true,
        deploymentStrigifiedSection: `\
                {
                    initializeDeploymentClient: () => Promise.resolve(),
                    deploy: async ({ artifactToDeploy }) => {
                        if(artifactToDeploy.packageJson.name?.startsWith("a")){
                          require('child_process').execSync('${aDeployment.stepScript}',{stdio:'inherit'})
                        }
                    },
                    destroyDeploymentClient: async ({ deploymentClient }) => Promise.resolve(),
                }`,
      },
    },
    execaOptions: {
      stdio: 'pipe',
    },
  }

  await aDeployment.makeStepFail()
  await expect(runCi(runCiOptions)).rejects.toEqual(
    expect.objectContaining({
      stderr: expect.stringMatching(aDeployment.expectedContentInLog()),
    }),
  )

  await aDeployment.makeStepPass()
  await expect(runCi(runCiOptions)).resolves.toBeTruthy()
})

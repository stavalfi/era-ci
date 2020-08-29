import ciInfo from 'ci-info'
import { createFile } from 'create-folder-structure'
import execa from 'execa'
import { ConfigFileOptions } from './packages/nc/src/index'

export default async (): Promise<ConfigFileOptions<void>> => {
  const {
    DOCKER_HUB_USERNAME,
    DOCKER_HUB_TOKEN,
    NPM_USERNAME,
    NPM_TOKEN,
    REDIS_PASSWORD,
    REDIS_ENDPOINT,
    K8S_CLUSTER_TOKEN,
    GIT_SERVER_USERNAME,
    GIT_SERVER_TOKEN,
    // eslint-disable-next-line no-process-env
  } = process.env

  const isMasterBuild = Boolean(ciInfo.isCI && !ciInfo.isPR)

  const k8sProjectId = `dancer-staging-new`
  const k8sClusterName = `stav-k8s-cd`
  const k8sClusterZoneName = `us-central1-c`

  const packageNameToDeploymentName = (packageName: string) => packageName
  const packageNameToContainerName = (packageName: string) => packageName

  const shouldPublish = isMasterBuild
  const shouldDeploy = false

  return {
    logFilePath: './nc.log',
    git: {
      auth: {
        username: GIT_SERVER_USERNAME!,
        token: GIT_SERVER_TOKEN!,
      },
    },
    redis: {
      redisServer: `redis://${REDIS_ENDPOINT}/`,
      auth: {
        password: REDIS_PASSWORD!,
      },
    },
    // @ts-expect-error // i cant import NpmScopeAccess - need to fix it
    targetsInfo: {
      npm: {
        shouldPublish,
        npmScopeAccess: 'public',
        registry: `https://registry.npmjs.org/`,
        publishAuth: {
          email: 'stavalfi@gmail.com',
          username: NPM_USERNAME!,
          token: NPM_TOKEN!,
        },
        shouldDeploy,
      },
      docker: {
        shouldPublish,
        registry: `https://registry.hub.docker.com/`,
        publishAuth: {
          username: DOCKER_HUB_USERNAME!,
          token: DOCKER_HUB_TOKEN!,
        },
        dockerOrganizationName: 'stavalfi',
        shouldDeploy,
        deployment: {
          initializeDeploymentClient: async () => {
            const { stdout: keyContent } = await execa.command(`echo ${K8S_CLUSTER_TOKEN} | base64 -d`, {
              stdio: 'pipe',
              shell: true,
            })
            const k8sKeyPath = await createFile(keyContent)
            await execa.command(
              `gcloud auth activate-service-account --key-file=${k8sKeyPath} --project ${k8sProjectId}`,
            )
            await execa.command(
              `gcloud container clusters get-credentials ${k8sClusterName} --zone ${k8sClusterZoneName} --project ${k8sProjectId}`,
            )
          },
          deploy: async ({ artifactToDeploy }) => {
            const packageName = artifactToDeploy.packageJson.name!
            const deploymentName = packageNameToDeploymentName(packageName)
            const containerName = packageNameToContainerName(packageName)
            const fullImageName = artifactToDeploy.fullImageName
            await execa.command(
              `kubectl set image deployment/${deploymentName} ${containerName}=${fullImageName} --record`,
            )
          },
          destroyDeploymentClient: async () => Promise.resolve(),
        },
      },
    },
  }
}

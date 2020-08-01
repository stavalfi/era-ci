import { ConfigFileOptions } from './packages/nc/src/index'
import ciInfo from 'ci-info'
import { createFile } from 'create-folder-structure'
import execa from 'execa'

export default async (): Promise<ConfigFileOptions<void>> => {
  const {
    DOCKER_HUB_USERNAME,
    DOCKER_HUB_TOKEN,
    NPM_USERNAME,
    NPM_TOKEN,
    REDIS_PASSWORD,
    REDIS_ENDPOINT,
    K8S_CLUSTER_TOKEN,
    // eslint-disable-next-line no-process-env
  } = process.env

  const isMasterBuild = Boolean(ciInfo.isCI && !ciInfo.isPR)

  const k8sProjectId = `dancer-staging-new`
  const k8sClusterName = `stav-k8s-cd`
  const k8sClusterZoneName = `us-central1-c`

  const packageNameToDeploymentName = (packageName: string) => packageName
  const packageNameToContainerName = (packageName: string) => packageName

  return {
    shouldPublish: isMasterBuild,
    shouldDeploy: isMasterBuild,
    dockerOrganizationName: 'stavalfi',
    dockerRegistryUrl: `https://${DOCKER_HUB_USERNAME}:${DOCKER_HUB_TOKEN}@registry.hub.docker.com/`,
    redisServerUrl: `redis://:${REDIS_PASSWORD}@${REDIS_ENDPOINT}/`,
    npmRegistryEmail: 'stavalfi@gmail.com',
    npmRegistryUrl: `https://${NPM_USERNAME}:${NPM_TOKEN}@registry.npmjs.com/`,
    deployment: {
      docker: {
        initializeDeploymentClient: async () => {
          const { stdout: keyContent } = await execa.command(`echo ${K8S_CLUSTER_TOKEN} | base64 -d`, {
            stdio: 'pipe',
            shell: true,
          })
          const k8sKeyPath = await createFile(keyContent)
          await execa.command(`gcloud auth activate-service-account --key-file=${k8sKeyPath} --project ${k8sProjectId}`)
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
  }
}

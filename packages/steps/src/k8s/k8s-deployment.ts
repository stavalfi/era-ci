import {
  skipAsFailedIfArtifactStepResultFailedInCacheConstrain,
  skipAsPassedIfArtifactTargetTypeNotSupportedConstrain,
  skipAsPassedIfStepIsDisabledConstrain,
} from '@era-ci/constrains'
import { createStep, getReturnValue } from '@era-ci/core'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import { TargetType } from '@era-ci/utils'
import * as k8s from '@kubernetes/client-node'
import _ from 'lodash'
import { skipAsPassedIfPackageIsIgnoredFromDeployConstrain } from './skip-as-passed-if-package-is-ignored-from-deploy-constrain'
import { k8sDeploymentConfiguration } from './types'
import { deployAndWait } from './utils'

export const k8sDeployment = createStep<
  LocalSequentalTaskQueue,
  k8sDeploymentConfiguration,
  Required<k8sDeploymentConfiguration>
>({
  stepName: 'k8s-deployment',
  stepGroup: 'k8s-deployment',
  taskQueueClass: LocalSequentalTaskQueue,
  normalizeStepConfigurations: async config => ({
    ...config,
    ignorePackageNames: config.ignorePackageNames ?? [],
  }),
  run: async ({ stepConfigurations, getState, steps, artifacts, log, processEnv }) => {
    let kc: k8s.KubeConfig
    let deploymentApi: k8s.AppsV1Api

    return {
      globalConstrains: [skipAsPassedIfStepIsDisabledConstrain()],
      artifactConstrains: [
        artifact =>
          skipAsPassedIfArtifactTargetTypeNotSupportedConstrain({
            currentArtifact: artifact,
            supportedTargetType: TargetType.docker,
          }),
        artifact =>
          skipAsFailedIfArtifactStepResultFailedInCacheConstrain({
            currentArtifact: artifact,
            stepNameToSearchInCache: 'docker-publish',
            skipAsPassedIfStepNotExists: false,
          }),
        artifact =>
          skipAsPassedIfPackageIsIgnoredFromDeployConstrain({
            currentArtifact: artifact,
          }),
      ],
      onBeforeArtifacts: async () => {
        log.info(`starting to deploy to k8s. Please don't stop the CI manually!`)
        kc = new k8s.KubeConfig()
        kc.loadFromString(Buffer.from(stepConfigurations.kubeConfigBase64, 'base64').toString())
        deploymentApi = kc.makeApiClient(k8s.AppsV1Api)
      },
      onArtifact: async ({ artifact }) => {
        const artifactName = artifact.data.artifact.packageJson.name
        const deploymentName = stepConfigurations.artifactNameToDeploymentName({ artifactName })
        const containerName = stepConfigurations.artifactNameToContainerName({ artifactName })

        const newFullImageName = getReturnValue<string>({
          state: getState(),
          artifacts,
          steps,
          artifactName: artifact.data.artifact.packageJson.name,
          stepGroup: 'docker-publish',
          mapper: _.identity,
        })

        return deployAndWait({
          kc,
          deploymentApi,
          changeCause: `era-ci automation - to image (image-name:<version=git-revision>): ${newFullImageName}`,
          log,
          newFullImageName,
          k8sNamesapce: stepConfigurations.k8sNamesapce,
          deploymentName,
          containerName,
          failDeplomentOnPodError: stepConfigurations.failDeplomentOnPodError,
          isTestMode: Boolean(processEnv['ERA_TEST_MODE']),
        })
      },
    }
  },
})

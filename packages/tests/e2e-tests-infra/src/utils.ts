import { Config, Logger, TaskQueueBase } from '@era-ci/core'
import { cliTableReporter, jsonReporter } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { V1Pod } from '@kubernetes/client-node'
import _ from 'lodash'
import { execaCommand } from '@era-ci/utils'
import { CreateK8sDeployment, FindPodName, GetCleanups, K8sHelpers, TestResources } from './types'
import os from 'os'
import { DeepPartial } from 'ts-essentials'
import colors from 'colors/safe'

function isDeepSubsetOf<T = unknown>({
  subset,
  fullObj,
  path,
}: {
  fullObj: T
  subset: DeepPartial<T>
  path: Array<string>
}): { result: true } | { result: false; problem: string; fullObj: unknown; subset: unknown; path: Array<string> } {
  if (typeof fullObj !== typeof subset) {
    return {
      result: false,
      fullObj,
      subset,
      problem: 'not equal',
      path,
    }
  }
  switch (typeof fullObj) {
    case 'symbol':
    case 'string':
    case 'bigint':
    case 'number':
    case 'boolean':
    case 'undefined':
    case 'function':
      if (fullObj !== subset) {
        return {
          result: false,
          fullObj,
          subset,
          problem: 'not equal',
          path,
        }
      } else {
        return {
          result: true,
        }
      }
    case 'object': {
      if (Array.isArray(fullObj)) {
        if (!Array.isArray(subset)) {
          return {
            result: false,
            fullObj,
            subset,
            problem: 'subset is not array as well',
            path,
          }
        } else {
          // @ts-ignore
          for (const [key, element] of subset.entries()) {
            if (
              fullObj.every(
                e => !isDeepSubsetOf({ fullObj: e, subset: element, path: [...path, key.toString()] }).result,
              )
            ) {
              return {
                result: false,
                fullObj,
                subset: element,
                problem: 'subset is element of array that can not be found in fullObj array',
                path,
              }
            }
          }
          return {
            result: true,
          }
        }
      } else {
        if ((fullObj === null && subset !== null) || (fullObj !== null && subset === null)) {
          return {
            result: false,
            fullObj,
            subset,
            problem: 'not equal',
            path,
          }
        } else {
          if (fullObj === null && subset === null) {
            return {
              result: true,
            }
          }
          if (typeof subset !== 'object') {
            throw new Error(`we can't be here because we already ensured that both has the same type`)
          }
          for (const [key, value] of Object.entries(subset || {})) {
            // @ts-ignore
            const fullObjValue: unknown = (fullObj || {})[key]
            const result = isDeepSubsetOf({ fullObj: fullObjValue, subset: value, path: [...path, key] })
            if (!result.result) {
              return result
            }
          }
          return {
            result: true,
          }
        }
      }
    }
  }
  throw new Error(`we can't be here`)
}

export function isDeepSubset<T>(fullObj: T, subset: DeepPartial<T>): boolean {
  const result = isDeepSubsetOf({ fullObj, subset, path: [] })

  if (result.result) {
    return true
  } else {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2))
    return false
  }
}

export function addReportToStepsAsLastNodes(
  steps: Config<TaskQueueBase<any, any>>['steps'] = [],
): Config<TaskQueueBase<any, any>>['steps'] {
  const stepsCopy = _.cloneDeep(steps)

  const additionalSteps = createLinearStepsGraph([
    jsonReporter(),
    cliTableReporter({ colorizeTable: s => colors.white(s) }),
  ])

  const leafs = stepsCopy.filter(s => s.childrenIndexes.length === 0)

  additionalSteps[0].index = stepsCopy.length
  additionalSteps[0].parentsIndexes = leafs.map(s => s.index)
  additionalSteps[0].childrenIndexes = [stepsCopy.length + 1]
  additionalSteps[1].index = stepsCopy.length + 1
  additionalSteps[1].parentsIndexes = [stepsCopy.length]

  leafs.forEach(leaf => {
    leaf.childrenIndexes = [stepsCopy.length]
  })

  return [...stepsCopy, ...additionalSteps]
}

export const k8sHelpers = ({
  getCleanups,
  getResources,
  createTestLogger,
}: {
  getCleanups: GetCleanups
  getResources: () => TestResources
  createTestLogger: (repoPath: string) => Promise<Logger>
}): K8sHelpers => {
  const createK8sDeployment: CreateK8sDeployment = options =>
    getResources()
      .k8s.deploymentApi.createNamespacedDeployment(options.namespaceName, {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: {
          name: options.deploymentName,
          labels: options.labels,
        },
        spec: {
          progressDeadlineSeconds: options.progressDeadlineSeconds,
          replicas: 1,
          selector: {
            matchLabels: options.labels,
          },
          minReadySeconds: options.minReadySeconds,
          template: {
            metadata: {
              name: options.podName,
              labels: options.labels,
            },
            spec: {
              terminationGracePeriodSeconds: 2,
              containers: [
                {
                  name: options.containerName,
                  image: options.fullImageName,
                  ports: [
                    {
                      containerPort: options.portInContainer,
                    },
                  ],
                },
              ],
            },
          },
        },
      })
      .then(
        r => {
          getCleanups().cleanups.push(() =>
            getResources().k8s.deploymentApi.deleteNamespacedDeployment(r.body.metadata?.name!, options.namespaceName),
          )
          return r.body
        },
        error => {
          throw JSON.stringify(error.response, null, 2)
        },
      )

  const findPodName: FindPodName = async (deploymentName: string): Promise<string | undefined> => {
    const testLogger = await createTestLogger(os.tmpdir())

    const { stdout: podListJsonString } = await execaCommand(
      `kubectl get pods -l=app=${deploymentName} --output json`,
      {
        log: testLogger.createLog('test'),
        stdio: 'pipe',
      },
    )
    const pods: V1Pod[] = JSON.parse(podListJsonString).items
    // the crushed pod with the new image may not deleted yet so we search the valid pod which is running
    return pods.find(pod => pod.status?.conditions?.some(c => c.type === 'Ready' && c.status === 'True'))?.metadata
      ?.name
  }

  return { createK8sDeployment, findPodName }
}

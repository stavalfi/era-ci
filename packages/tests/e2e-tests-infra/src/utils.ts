import { Config, TaskQueueBase } from '@era-ci/core'
import { cliTableReporter, jsonReporter } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { ExecutionContext } from 'ava'
import _ from 'lodash'
import { DeepPartial } from './types'

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

export function isDeepSubset<T>(t: ExecutionContext, fullObj: T, subset: DeepPartial<T>): boolean {
  const result = isDeepSubsetOf({ fullObj, subset, path: [] })

  if (result.result) {
    return true
  } else {
    // eslint-disable-next-line no-console
    t.log(JSON.stringify(result, null, 2))
    return false
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function addReportToStepsAsLastNodes<TaskQueue extends TaskQueueBase<any, any>>(
  steps: Config<TaskQueue>['steps'] = [],
): Config<TaskQueue>['steps'] {
  const stepsCopy = _.cloneDeep(steps)

  const additionalSteps = createLinearStepsGraph([jsonReporter(), cliTableReporter()])

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

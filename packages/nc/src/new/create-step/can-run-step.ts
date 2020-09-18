import _ from 'lodash'
import { Artifact, Graph } from '../../types'
import { CacheTtl } from '../cache'
import { Cache, CanRunStep, StepInfo, StepResultOfPackage, StepStatus } from '../types'
import { didPassOrSkippedAsPassed } from '../utils'

const runAll = async (
  array: { checkName: string; condition: boolean; predicate: () => Promise<{ canRun: boolean; notes: string[] }> }[],
) => {
  const results = await Promise.all(array.filter(x => x.condition).map(x => x.predicate()))
  return {
    canRun: results.every(x => x.canRun),
    notes: _.flatMap(
      results.map(x => x.notes),
      x => x,
    ),
  }
}

async function skipIfPackageResultsInCachePredicate({
  canRunStep,
  cache,
  allPackages,
  currentPackageIndex,
  allSteps,
  currentStepIndex,
}: {
  canRunStep: CanRunStep
  allPackages: Graph<{ artifact: Artifact }>
  currentPackageIndex: number
  cache: Cache
  currentStepIndex: number
  allSteps: Graph<{ stepInfo: StepInfo; stepResult?: StepResultOfPackage }>
}) {
  const result = await cache.step.getStepResult({
    stepId: allSteps[currentStepIndex].data.stepInfo.stepId,
    packageHash: allPackages[currentPackageIndex].data.artifact.packageHash,
    ttlMs: CacheTtl.stepResult,
  })
  if (result?.didStepRun) {
    const isPassed = didPassOrSkippedAsPassed(result.StepStatus)
    const note = `step already run on this package with the same hash in flow-id: "${result.flowId}". result: "${
      isPassed ? 'passed' : 'failed'
    }"`
    if (canRunStep.options?.skipIfPackageResultsInCache) {
      return {
        canRun: false,
        notes: [note],
      }
    } else {
      return {
        canRun: true,
        notes: [`rerun step but ${note}`],
      }
    }
  } else {
    return {
      canRun: true,
      notes: [],
    }
  }
}

async function skipIfSomeDirectPrevStepsFailedOnPackage({
  allSteps,
  currentStepIndex,
}: {
  currentStepIndex: number
  allSteps: Graph<{ stepInfo: StepInfo; stepResult?: StepResultOfPackage }>
}) {
  const notes: string[] = []
  const didAllPreviousPassed = await allSteps[currentStepIndex].parentsIndexes
    .map(i => allSteps[i].data.stepResult!)
    .every(result => [StepStatus.passed, StepStatus.skippedAsPassed].includes(result.status))
  if (didAllPreviousPassed) {
    notes.push(`skipping step because not all previous steps passed`)
  }
  return {
    canRun: didAllPreviousPassed,
    notes,
  }
}

export async function checkIfCanRunStep(options: {
  canRunStep: CanRunStep
  allPackages: Graph<{ artifact: Artifact }>
  currentPackageIndex: number
  cache: Cache
  currentStepIndex: number
  allSteps: Graph<{ stepInfo: StepInfo; stepResult?: StepResultOfPackage }>
}): Promise<{ canRun: boolean; notes: string[] }> {
  const stepPredicate = async () =>
    options.canRunStep.customPredicate
      ? options.canRunStep.customPredicate({
          cache: options.cache,
          allPackages: options.allPackages,
          allSteps: options.allSteps,
          currentStepInfo: options.allSteps[options.currentStepIndex],
        })
      : { canRun: true, notes: [] }

  let canRun = false
  const notes: string[] = []

  const result = await runAll([
    {
      checkName: 'custom-step-predicate',
      condition: !options.canRunStep.options?.runCustomPredicateAsLastCheck,
      predicate: stepPredicate,
    },
    {
      checkName: 'skip-if-package-results-in-cache',
      condition: true,
      predicate: () => skipIfPackageResultsInCachePredicate(options),
    },
    {
      checkName: 'skip-if-some-direct-prev-steps-failed-on-package',
      condition: true,
      predicate: () => skipIfSomeDirectPrevStepsFailedOnPackage(options),
    },
  ])

  canRun = result.canRun
  notes.push(...result.notes)

  if (options.canRunStep.options?.runCustomPredicateAsLastCheck) {
    const result = await runAll([
      {
        checkName: 'custom-step-predicate',
        condition: true,
        predicate: stepPredicate,
      },
    ])
    canRun = result.canRun
    notes.push(...result.notes)
  }

  return {
    canRun,
    notes,
  }
}

import _ from 'lodash'
import { Artifact, Node } from '../types'
import { calculateCombinedStatus, didPassOrSkippedAsPassed } from '../utils'
import { CanRunStepOnArtifact, CanRunStepOnArtifactResult, ExecutionStatus, Status, UserRunStepOptions } from './types'

const runAll = async (
  array: { checkName: string; predicate: () => Promise<CanRunStepOnArtifactResult> }[],
): Promise<CanRunStepOnArtifactResult> => {
  const results = await Promise.all(array.map(x => x.predicate()))
  const canRun = results.every(x => x.canRun)
  const notes = _.uniq(
    _.flatMapDeep(
      results.map((x, i) =>
        x.notes.map(note =>
          array[i].checkName === 'custom-step-predicate' ? note : `${array[i].checkName} - ${note}`,
        ),
      ),
    ),
  )
  if (canRun) {
    return {
      canRun: true,
      notes,
    }
  } else {
    const stepStatus = calculateCombinedStatus(_.flatten(results.map(r => (r.canRun ? [] : [r.stepStatus]))))
    if (stepStatus !== Status.skippedAsFailed && stepStatus !== Status.skippedAsPassed) {
      throw new Error(`we can't be here`)
    }
    return {
      canRun: false,
      notes,
      stepStatus,
    }
  }
}

async function runIfPackageResultsInCache<StepConfigurations>({
  canRunStepOnArtifact,
  cache,
  currentArtifact,
  currentStepInfo,
}: UserRunStepOptions<StepConfigurations> & {
  currentArtifact: Node<{ artifact: Artifact }>
  canRunStepOnArtifact?: CanRunStepOnArtifact<StepConfigurations>
}): Promise<CanRunStepOnArtifactResult> {
  const result = await cache.step.getStepResult({
    stepId: currentStepInfo.data.stepInfo.stepId,
    artifactHash: currentArtifact.data.artifact.packageHash,
  })
  if (
    result?.stepResultOfArtifacts.stepExecutionStatus === ExecutionStatus.aborted ||
    result?.stepResultOfArtifacts.stepExecutionStatus === ExecutionStatus.done
  ) {
    const isPassed = didPassOrSkippedAsPassed(
      result.stepResultOfArtifacts.artifactsResult[currentArtifact.index].data.artifactStepResult.status,
    )
    const note = `step already run on this package with the same hash in flow-id: "${result.flowId}". result: "${
      isPassed ? 'passed' : 'failed'
    }"`
    if (canRunStepOnArtifact?.options?.runIfPackageResultsInCache) {
      return {
        canRun: true,
        notes: [`rerun step but ${note}`],
      }
    } else {
      return {
        canRun: false,
        notes: [note],
        stepStatus: isPassed ? Status.skippedAsPassed : Status.skippedAsFailed,
      }
    }
  } else {
    return {
      canRun: true,
      notes: [],
    }
  }
}

async function runIfSomeDirectParentStepFailedOnPackage<StepConfigurations>({
  stepsResultOfArtifactsByStep,
  currentStepInfo,
  canRunStepOnArtifact,
  currentArtifact,
}: UserRunStepOptions<StepConfigurations> & {
  currentArtifact: Node<{ artifact: Artifact }>
  canRunStepOnArtifact?: CanRunStepOnArtifact<StepConfigurations>
}): Promise<CanRunStepOnArtifactResult> {
  const notes: string[] = []
  const didAllPrevPassed = await currentStepInfo.parentsIndexes
    .map((_result, i) => stepsResultOfArtifactsByStep[i].data)
    .every(
      step =>
        (step.stepExecutionStatus === ExecutionStatus.done || step.stepExecutionStatus === ExecutionStatus.aborted) &&
        [Status.passed, Status.skippedAsPassed].includes(
          step.artifactsResult[currentArtifact.index].data.artifactStepResult.status,
        ),
    )

  if (!didAllPrevPassed) {
    notes.push(`skipping step because not all previous steps passed`)
  }
  if (didAllPrevPassed || canRunStepOnArtifact?.options?.runIfSomeDirectParentStepFailedOnPackage) {
    return {
      canRun: true,
      notes,
    }
  } else {
    return {
      canRun: false,
      notes,
      stepStatus: Status.skippedAsFailed,
    }
  }
}

export async function checkIfCanRunStepOnArtifact<StepConfigurations>(
  options: UserRunStepOptions<StepConfigurations> & {
    currentArtifact: Node<{ artifact: Artifact }>
    canRunStepOnArtifact?: CanRunStepOnArtifact<StepConfigurations>
  },
): Promise<CanRunStepOnArtifactResult> {
  return runAll([
    {
      checkName: 'custom-step-predicate',
      predicate: async () => {
        if (options.canRunStepOnArtifact?.customPredicate) {
          const result = await options.canRunStepOnArtifact.customPredicate(_.omit(options, ['canRunStepOnArtifact']))
          if (result === true) {
            return { canRun: true, notes: [] }
          } else {
            return result
          }
        } else {
          return { canRun: true, notes: [] }
        }
      },
    },
    {
      checkName: 'skip-if-package-results-in-cache',
      predicate: () => runIfPackageResultsInCache(options),
    },
    {
      checkName: 'skip-if-some-direct-prev-steps-failed-on-package',
      predicate: () => runIfSomeDirectParentStepFailedOnPackage(options),
    },
  ])
}

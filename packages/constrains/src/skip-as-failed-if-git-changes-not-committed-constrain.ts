import { ConstrainResultType, createConstrain } from '@era-ci/core'
import { execaCommand, ExecutionStatus, Status } from '@era-ci/utils'

export const skipAsFailedIfGitChangesNotCommitedConstrain = createConstrain<void, void, { isStepEnabled: boolean }>({
  constrainName: 'skip-as-failed-if-step-is-disabled-constrain',
  constrain: async ({ repoPath, log }) => {
    const diffIsEmpty = await execaCommand(`git diff-index --quiet HEAD --`, {
      stdio: 'ignore',
      log,
      cwd: repoPath,
    }).then(
      () => true,
      () => false,
    )
    // not ignored and untracked files
    const noUnteackedFiles = await execaCommand(`git ls-files --exclude-standard --others`, {
      stdio: 'pipe',
      log,
      cwd: repoPath,
    }).then(({ stdout = '' }) => stdout.length === 0)

    if (diffIsEmpty && noUnteackedFiles) {
      return {
        resultType: ConstrainResultType.ignoreThisConstrain,
        result: {
          errors: [],
          notes: [],
        },
      }
    } else {
      return {
        resultType: ConstrainResultType.shouldSkip,
        result: {
          errors: [],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
          notes: [`commit and push your changes (this step sends the remote commit to quay)`].concat(
            noUnteackedFiles ? [] : [`you have new untracked files`],
          ),
        },
      }
    }
  },
})

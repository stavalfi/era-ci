import { createStep } from '@era-ci/core'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus, getPackageTargetTypes, Status, TargetType } from '@era-ci/utils'
import _ from 'lodash'
import { IDependencyMap } from 'package-json-type'
import semver from 'semver'

export const validatePackages = createStep({
  stepName: 'validate-packages',
  stepGroup: 'validate-packages',
  taskQueueClass: LocalSequentalTaskQueue,
  run: ({ artifacts }) => ({
    waitUntilArtifactParentsFinishedParentSteps: false,
    onArtifact: async ({ artifact }) => {
      const problems: Array<string> = []

      if (!artifact.data.artifact.packageJson.name) {
        problems.push(`missing name property in package.json`)
      }

      if (!artifact.data.artifact.packageJson.version) {
        problems.push(`missing version property in package.json`)
      }

      if (!semver.valid(artifact.data.artifact.packageJson.version)) {
        problems.push(`version property in package.json is invalid: "${artifact.data.artifact.packageJson.version}"`)
      }

      const deps: IDependencyMap = {
        ...artifact.data.artifact.packageJson.dependencies,
        ...artifact.data.artifact.packageJson.devDependencies,
        ...artifact.data.artifact.packageJson.peerDependencies,
      }

      const currentArtifactTargetTypes = await getPackageTargetTypes(
        artifact.data.artifact.packagePath,
        artifact.data.artifact.packageJson,
      )

      const depsProblems = _.flatMapDeep(
        await Promise.all(
          Object.entries(deps).map(async ([dep, versionRange]) => {
            const depInMonoRepo = artifacts.find(a => a.data.artifact.packageJson.name === dep)?.data.artifact
            if (!depInMonoRepo) {
              return []
            }
            const depVersion = depInMonoRepo.packageJson.version

            const depProblems: Array<string> = []

            if (depVersion) {
              const isInRange = semver.satisfies(depVersion, versionRange)
              if (isInRange) {
                const depTargetTypes = await getPackageTargetTypes(depInMonoRepo.packagePath, depInMonoRepo.packageJson)
                if (currentArtifactTargetTypes.includes(TargetType.npm) && depTargetTypes.length === 0) {
                  depProblems.push(
                    `the package "${artifact.data.artifact.packageJson.name}" can't depend on dependency: "${dep}" in version "${versionRange}" becuase this version represents a private-npm-package`,
                  )
                }
              }
            }
            return depProblems
          }),
        ),
      )

      problems.push(...depsProblems)

      return {
        notes: problems,
        executionStatus: ExecutionStatus.done,
        status: problems.length === 0 ? Status.passed : Status.failed,
      }
    },
  }),
})

import _ from 'lodash'
import { IDependencyMap } from 'package-json-type'
import semver from 'semver'
import { createStep, ExecutionStatus, Status } from '../create-step'
import { getPackageTargetType, TargetType } from './utils'

export const validatePackages = createStep({
  stepName: 'validate-packages',
  runStepOnArtifact: async ({ currentArtifact, artifacts }) => {
    const problems: string[] = []

    if (!currentArtifact.data.artifact.packageJson.name) {
      problems.push(`missing name property in package.json`)
    }

    if (!currentArtifact.data.artifact.packageJson.version) {
      problems.push(`missing version property in package.json`)
    }

    if (!semver.valid(currentArtifact.data.artifact.packageJson.version)) {
      problems.push(
        `version property in package.json is invalid: "${currentArtifact.data.artifact.packageJson.version}"`,
      )
    }

    const deps: IDependencyMap = {
      ...currentArtifact.data.artifact.packageJson.dependencies,
      ...currentArtifact.data.artifact.packageJson.devDependencies,
      ...currentArtifact.data.artifact.packageJson.peerDependencies,
    }

    const currentArtifactTargetType = await getPackageTargetType(
      currentArtifact.data.artifact.packagePath,
      currentArtifact.data.artifact.packageJson,
    )

    const depsProblems = await Promise.all(
      Object.entries(deps).map(async ([dep, versionRange]) => {
        const depInMonoRepo = artifacts.find(a => a.data.artifact.packageJson.name === dep)?.data.artifact
        if (!depInMonoRepo) {
          return []
        }
        const depVersion = depInMonoRepo.packageJson.version

        const depProblems: string[] = []

        if (depVersion) {
          const isInRange = semver.satisfies(depVersion, versionRange)
          if (isInRange) {
            const depTargetType = await getPackageTargetType(depInMonoRepo.packagePath, depInMonoRepo.packageJson)
            if (currentArtifactTargetType === TargetType.npm && !depTargetType) {
              depProblems.push(
                `the package "${currentArtifact.data.artifact.packageJson.name}" can't depend on dependency: "${dep}" in version "${versionRange}" becuase this version represents a private-npm-package`,
              )
            }

            if (depTargetType === TargetType.docker) {
              depProblems.push(
                `the package "${currentArtifact.data.artifact.packageJson.name}" can't depend on dependency: "${dep}" in version "${versionRange}" becuase this version represents a docker-package`,
              )
            }
          }
        }
        return depProblems
      }),
    ).then(x => _.flatten(x))

    problems.push(...depsProblems)

    return {
      notes: problems,
      executionStatus: ExecutionStatus.done,
      status: problems.length === 0 ? Status.passed : Status.failed,
    }
  },
})

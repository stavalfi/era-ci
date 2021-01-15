import { FolderStructure } from 'create-folder-structure'
import { IDependencyMap, IPackageJson } from 'package-json-type'
import execa, { StdioOption } from 'execa'
import { NpmScopeAccess } from '@era-ci/steps'
import { TargetType } from '@era-ci/utils'

export { TargetType }

import { ExecutionContext, TestInterface } from 'ava'
import { GitServer } from './git-server-testkit'

export type TestWithContextType = {
  resources: TestResources
}
export type TestWithContext = TestInterface<TestWithContextType>

export enum Resource {
  dockerRegistry = 'docker-registry',
  npmRegistry = 'npm-registry',
  gitServer = 'git-server',
}

export type Package = {
  name: string
  version: string
  targetType?: TargetType
  'index.js'?: string
  dependencies?: IDependencyMap
  devDependencies?: IDependencyMap
  src?: FolderStructure
  tests?: FolderStructure
  additionalFiles?: FolderStructure
  scripts?: {
    test?: string
    postpublish?: string
  }
}

export type MinimalNpmPackage = Pick<Package, 'name' | 'version'> & { targetType: TargetType.npm }

export type Repo = {
  packages?: Array<Package>
  rootFiles?: FolderStructure
}

export type TestOptions = {
  targetsInfo?: {
    [target in TargetType]?: {
      shouldPublish: boolean
    } & (
      | {
          shouldDeploy: true
          deploymentStrigifiedSection: string
        }
      | { shouldDeploy: false; deploymentStrigifiedSection?: string }
    ) &
      (target extends TargetType.npm
        ? {
            npmScopeAccess?: NpmScopeAccess
          }
        : // eslint-disable-next-line @typescript-eslint/ban-types
          {})
  }
  execaOptions?: {
    stdio?: 'pipe' | 'ignore' | 'inherit' | Array<StdioOption>
    reject?: boolean
  }
}

export type ResultingArtifact = {
  npm: {
    versions: Array<string>
    highestVersion?: string
  }
  docker: {
    tags: Array<string>
  }
}

export type TestResources = {
  npmRegistry: {
    address: string
    auth: {
      username: string
      token: string
      email: string
    }
  }
  dockerRegistry: string
  gitServer: GitServer
  redisServer: string
}

export type CiResults = {
  ciProcessResult: execa.ExecaReturnValue<string>
  published: Map<string, ResultingArtifact>
  ncLogfileContent: string
  flowId: string | undefined
}

export type ToActualName = (name: string) => string

export type RunCi = (options?: TestOptions) => Promise<CiResults>
export type GetFlowLogs = (options: {
  flowId: string
  execaOptions?: {
    stdio?: 'pipe' | 'ignore' | 'inherit' | Array<StdioOption>
    reject?: boolean
  }
}) => Promise<execa.ExecaReturnValue<string>>
export type AddRandomFileToPackage = (packageName: string) => Promise<string>
export type AddRandomFileToRoot = () => Promise<string>

export type ManageRepoResult = {
  gitHeadCommit: () => Promise<string>
  repoPath: string
  toActualName: ToActualName
  dockerOrganizationName: string
  getPackagePath: (packageName: string) => Promise<string>
  getFullImageName: (packageName: string, imageTag: string) => string
  addRandomFileToPackage: AddRandomFileToPackage
  addRandomFileToRoot: AddRandomFileToRoot
  installAndRunNpmDependency: (dependencyName: string) => Promise<execa.ExecaChildProcess<string>>
  publishDockerPackageWithoutCi: (
    packageName: string,
    imageTag: string,
    labels?: { 'latest-hash'?: string; 'latest-tag'?: string },
  ) => Promise<void>
  publishNpmPackageWithoutCi: (packageName: string) => Promise<void>
  unpublishNpmPackage: (packageName: string, versionToUnpublish: string) => Promise<void>
  removeAllNpmHashTags: (packageName: string) => Promise<void>
  modifyPackageJson: (packageName: string, modification: (packageJson: IPackageJson) => IPackageJson) => Promise<void>
  movePackageFolder: (packageName: string) => Promise<string>
  deletePackage: (packageName: string) => Promise<void>
  renamePackageFolder: (packageName: string) => Promise<string>
  createNewPackage: (newNpmPackage: MinimalNpmPackage) => Promise<void>
  runCi: RunCi
  getFlowLogs: GetFlowLogs
}

export type CreateAndManageRepo = (t: ExecutionContext<TestWithContextType>, repo?: Repo) => Promise<ManageRepoResult>

export type NewEnv = (
  test: TestInterface<{ resources: TestResources }>,
) => {
  createRepo: CreateAndManageRepo
}

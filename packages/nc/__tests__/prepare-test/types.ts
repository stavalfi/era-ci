import { FolderStructure } from 'create-folder-structure'
import { IDependencyMap, IPackageJson } from 'package-json-type'
import execa, { StdioOption } from 'execa'
import { ServerInfo, TargetType, ConfigFileOptions } from '../../src/index'

export { TargetType }

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
  }
}

export type MinimalNpmPackage = Pick<Package, 'name' | 'version'> & { targetType: TargetType.npm }

export type Repo = {
  packages?: Package[]
  rootFiles?: FolderStructure
}

export type EditConfig = (config: ConfigFileOptions<unknown>) => ConfigFileOptions<unknown>

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
    )
  }
  execaOptions?: {
    stdio?: 'pipe' | 'ignore' | 'inherit' | readonly StdioOption[]
    reject?: boolean
  }
  editConfig?: EditConfig
}

export type ResultingArtifact = {
  npm: {
    versions: string[]
    highestVersion?: string
  }
  docker: {
    tags: string[]
  }
}

export type TestResources = {
  npmRegistry: ServerInfo
  dockerRegistry: ServerInfo
  gitServer: ServerInfo
  redisServer: ServerInfo
}

export type CiResults = {
  ciProcessResult: execa.ExecaReturnValue<string>
  published: Map<string, ResultingArtifact>
  // deployed: Map<string, ResultingArtifact>
}

export type ToActualName = (name: string) => string

export type RunCi = (options?: TestOptions) => Promise<CiResults>
export type AddRandomFileToPackage = (packageName: string) => Promise<string>
export type AddRandomFileToRoot = () => Promise<string>

export type ManageRepoResult = {
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
}

export type CreateAndManageRepo = (repo?: Repo) => Promise<ManageRepoResult>

export type NewEnv = () => {
  createRepo: CreateAndManageRepo
  getTestResources: () => TestResources
}

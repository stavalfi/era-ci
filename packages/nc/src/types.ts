import { IPackageJson } from 'package-json-type'

export type Protocol = 'http' | 'https'

export type ServerInfo = {
  host: string
  port: number
  protocol?: Protocol
}

export type Auth = {
  npmRegistryUsername: string
  npmRegistryEmail: string
  npmRegistryToken: string
  gitServerUsername: string
  gitServerToken: string
  redisPassword?: string
  dockerRegistryUsername?: string
  dockerRegistryToken?: string
}

export type CiOptions = {
  logFilePath: string
  repoPath: string
  shouldPublish: boolean
  isDryRun: boolean
  skipTests: boolean
  npmRegistry: ServerInfo
  dockerRegistry: ServerInfo
  gitServer: ServerInfo
  redisServer: ServerInfo
  dockerOrganizationName: string
  gitRepositoryName: string
  gitOrganizationName: string
  auth: Auth
}

export type PackageName = string
export type PackageVersion = string

export enum TargetType {
  docker = 'docker',
  npm = 'npm',
}

export type TargetInfo<TargetTypParam extends TargetType> = { targetType: TargetTypParam } & (
  | {
      needPublish: true
      newVersion: string
      // if we didn't publish this hash yet, it maybe because we modified something or we never published before
      highestPublishedVersion?: { version?: string; hash?: string }
    }
  | {
      needPublish: { skip: { reason: string } }
      // even if we already published the same hash, the user could remove the meta-data we saved on the latest-published-version
      highestPublishedVersion?: { version?: string; hash?: string }
    }
)

export type PackageInfo = {
  relativePackagePath: string
  packagePath: string
  packageHash: string
  packageJson: IPackageJson
  target?: TargetInfo<TargetType.npm> | TargetInfo<TargetType.docker>
}

export type Node<T> = {
  data: T
  index: number
  parentsIndexes: number[]
  childrenIndexes: number[]
}

export type Graph<T> = Node<T>[]

export enum CacheTypes {
  publish = 'publish',
}

export type Cache = {
  test: {
    isTestsRun: (packageName: string, packageHash: string) => Promise<boolean>
    isPassed: (packageName: string, packageHash: string) => Promise<boolean>
    setResult: (packageName: string, packageHash: string, isPassed: boolean) => Promise<void>
  }
  publish: {
    npm: {
      isPublished: (packageName: string, packageHash: string) => Promise<PackageVersion | false>
      setAsPublished: (packageName: string, packageHash: string, packageVersion: PackageVersion) => Promise<void>
    }
    docker: {
      isPublished: (packageName: string, packageHash: string) => Promise<PackageVersion | false>
      setAsPublished: (packageName: string, packageHash: string, packageVersion: PackageVersion) => Promise<void>
    }
  }
  disconnect: () => Promise<unknown>
}

export type TestsResult =
  | {
      skipped: false
      passed: boolean
    }
  | {
      skipped: {
        reason: string
        error?: unknown
      }
      passed: boolean
    }
  | {
      skipped: {
        reason: string
        error?: unknown
      }
    }

export type PublishResult =
  | {
      skipped: {
        reason: string
      }
    }
  | {
      skipped: false
      published:
        | {
            asVersion: string
          }
        | {
            failed: { reason: string; error?: unknown }
          }
    }

import { Redis, ValueType } from 'ioredis'
import NodeCache from 'node-cache'
import { Log } from '../create-logger'
import { StepResultOfArtifacts } from '../create-step'
import { Artifact, Graph } from '../types'

export type Cache = {
  step: {
    didStepRun: (options: { stepId: string; artifactHash: string }) => Promise<boolean>
    getStepResult: (options: {
      stepId: string
      artifactHash: string // one of the artifacts-hash that may have run in this step
    }) => Promise<
      | {
          flowId: string
          stepResultOfArtifacts: StepResultOfArtifacts
        }
      | undefined
    >
    setStepResult: (stepResultOfArtifacts: StepResultOfArtifacts) => Promise<void>
  }
  get: <T>(key: string, mapper: (result: unknown) => T) => Promise<{ flowId: string; value: T } | undefined>
  set: (options: { key: string; value: ValueType; allowOverride: boolean; ttl: number }) => Promise<void>
  has: (key: string) => Promise<boolean>
  nodeCache: NodeCache
  redisClient: Redis
  ttls: {
    stepSummary: number
    flowLogs: number
  }
  cleanup: () => Promise<unknown>
}

export type CreateCache = {
  callInitializeCache: (options: {
    flowId: string
    log: Log
    artifacts: Graph<{ artifact: Artifact }>
  }) => Promise<Cache>
}

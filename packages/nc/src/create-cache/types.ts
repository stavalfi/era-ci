import { ValueType, Redis } from 'ioredis'
import NodeCache from 'node-cache'
import { Log } from '../create-logger'
import { ExecutionStatus, Status } from '../create-step'

export type Cache = {
  step: {
    didStepRun: (options: { stepId: string; packageHash: string }) => Promise<boolean>
    getStepResult: (options: {
      stepId: string
      packageHash: string
    }) => Promise<
      | {
          didStepRun: true
          stepStatus: Status
          flowId: string
        }
      | { didStepRun: false }
      | undefined
    >
    setStepResult: (options: {
      stepId: string
      packageHash: string
      ttlMs: number
      stepExecutionStatus: ExecutionStatus.done
      stepStatus: Status
    }) => Promise<void>
  }
  get: <T>(key: string, mapper: (result: unknown) => T) => Promise<{ flowId: string; value: T } | undefined>
  set: (key: string, value: ValueType, ttl: number) => Promise<void>
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
  callInitializeCache: (options: { flowId: string; log: Log }) => Promise<Cache>
}

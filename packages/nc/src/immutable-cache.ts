import _ from 'lodash'
import NodeCache from 'node-cache'
import { array, enums, number, object, optional, string, type, validate } from 'superstruct'
import { KeyValueStoreConnection } from './create-key-value-store-connection'
import { Log } from './create-logger'
import { AbortResult, Artifact, DoneResult, ExecutionStatus, Graph, Status } from './types'

export type ImmutableCache = {
  step: {
    didStepRun: (options: { stepId: string; artifactHash: string }) => Promise<boolean>
    getArtifactStepResult: (options: {
      stepId: string
      artifactHash: string
    }) => Promise<
      | {
          flowId: string
          repoHash: string
          artifactStepResult: DoneResult | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>
        }
      | undefined
    >
    setArtifactStepResult: (options: {
      stepId: string
      artifactHash: string
      artifactStepResult: DoneResult | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>
    }) => Promise<void>
  }
  get: <T>(
    key: string,
    mapper: (result: unknown) => T,
  ) => Promise<{ flowId: string; repoHash: string; value: T } | undefined>
  set: (options: { key: string; value: string; ttl: number }) => Promise<void>
  has: (key: string) => Promise<boolean>
  ttls: {
    ArtifactStepResult: number
    flowLogs: number
  }
  cleanup: () => Promise<unknown>
}

export async function createImmutableCache({
  repoHash,
  flowId,
  keyValueStoreConnection,
  log,
  ttls,
}: {
  keyValueStoreConnection: KeyValueStoreConnection
  flowId: string
  repoHash: string
  log: Log
  artifacts: Graph<{ artifact: Artifact }>
  ttls: ImmutableCache['ttls']
}): Promise<ImmutableCache> {
  const nodeCache = new NodeCache()

  async function set(options: { key: string; value: string; ttl: number }): Promise<void> {
    const stirgifiedValue = JSON.stringify({
      flowId,
      repoHash,
      value: options.value,
    })

    if (await keyValueStoreConnection.has(options.key)) {
      log.debug(
        `immutable-cache can't override values in key-value-store. key: ${options.key}, ignored-new-value: ${options.value}`,
      )
      return
    }
    await keyValueStoreConnection.set({
      allowOverride: false,
      key: options.key,
      ttl: options.ttl,
      value: stirgifiedValue,
    })
    nodeCache.set(options.key, stirgifiedValue)
  }

  const getResultSchema = object({
    flowId: string(),
    repoHash: string(),
    value: string(),
  })

  async function get<T>(
    key: string,
    mapper: (result: string) => T,
  ): Promise<{ flowId: string; repoHash: string; value: T } | undefined> {
    const strigifiedJson = nodeCache.get<string>(key) ?? (await keyValueStoreConnection.get(key, _.identity))
    if (strigifiedJson === undefined) {
      return undefined
    }
    const [error, parsedResult] = validate(JSON.parse(strigifiedJson), getResultSchema)
    if (parsedResult) {
      return {
        flowId: parsedResult.flowId,
        repoHash: parsedResult.repoHash,
        value: mapper(parsedResult.value),
      }
    } else {
      throw new Error(
        `(1) cache.get returned a data with an invalid schema. validation-error: "${error}". data: "${strigifiedJson}"`,
      )
    }
  }

  async function has(key: string): Promise<boolean> {
    return nodeCache.has(key) || (await keyValueStoreConnection.has(key))
  }

  function toArtifactStepResultKey({ artifactHash, stepId }: { stepId: string; artifactHash: string }) {
    return `${stepId}-${artifactHash}`
  }

  const step: ImmutableCache['step'] = {
    didStepRun: options => has(toArtifactStepResultKey({ stepId: options.stepId, artifactHash: options.artifactHash })),
    getArtifactStepResult: async ({ stepId, artifactHash }) => {
      const artifactStepResult = await get(toArtifactStepResultKey({ stepId, artifactHash }), r => {
        if (typeof r !== 'string') {
          throw new Error(
            `(2) cache.get returned a data with an invalid type. expected string, actual: "${typeof r}". data: "${r}"`,
          )
        }

        const [error, parsedResult] = validate(
          JSON.parse(r),
          object({
            executionStatus: enums([ExecutionStatus.done, ExecutionStatus.aborted]),
            status: enums(Object.values(Status)),
            durationMs: optional(number()),
            notes: array(string()),
            errors: array(
              type({
                name: optional(string()),
                stack: optional(string()),
                message: optional(string()),
                code: optional(string()),
              }),
            ),
          }),
        )
        if (parsedResult) {
          return parsedResult
        } else {
          throw new Error(
            `(3) cache.get returned a data with an invalid schema. validation-error: "${error}". data: "${r}"`,
          )
        }
      })
      if (!artifactStepResult) {
        return undefined
      }

      return {
        flowId: artifactStepResult.flowId,
        repoHash: artifactStepResult.repoHash,
        artifactStepResult: artifactStepResult.value as
          | DoneResult
          | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>,
      }
    },
    setArtifactStepResult: async ({ artifactHash, stepId, artifactStepResult }) => {
      await set({
        key: toArtifactStepResultKey({
          stepId,
          artifactHash,
        }),
        value: JSON.stringify(artifactStepResult),
        ttl: ttls.ArtifactStepResult,
      })
    },
  }

  const cleanup = async () => {
    await nodeCache.close()
  }

  return {
    step,
    get,
    has,
    set,
    cleanup,
    ttls,
  }
}

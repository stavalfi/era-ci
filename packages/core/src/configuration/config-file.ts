import path from 'path'
import { array, func, is, number, object, optional, string, validate } from 'superstruct'
import { TaskQueueBase } from '../create-task-queue'
import { Config } from './types'
import chance from 'chance'
import fs from 'fs'
import * as swc from '@swc/core'

/**
 * ensures type safty of task-queues by only allowing steps thats uses task-queues which are declared in `task-queues` array.
 * @param options era-ci options
 */

export function config<TaskQueue extends TaskQueueBase<any, any>>(options: Config<TaskQueue>): Config<TaskQueue> {
  return options
}

function getConfigValidationObject() {
  return object({
    logger: object({
      callInitializeLogger: func(),
    }),
    redis: object({
      url: string(),
      auth: optional(
        object({
          username: optional(string()),
          password: optional(string()),
        }),
      ),
    }),
    taskQueues: array(
      object({
        taskQueueName: string(),
        createFunc: func(),
      }),
    ),
    steps: array(
      object({
        data: object({
          runStep: func(),
          taskQueueClass: func(),
          stepInfo: object({
            stepId: string(),
            stepGroup: string(),
            stepName: string(),
            displayName: string(),
          }),
        }),
        index: number(),
        parentsIndexes: array(number()),
        childrenIndexes: array(number()),
      }),
    ),
  })
}

function validateConfiguration<TaskQueue>(configuration: unknown): configuration is Config<TaskQueue> {
  return is(configuration, getConfigValidationObject())
}

export async function readNcConfigurationFile<TaskQueue>(
  repoPath: string,
  ciConfigFilePath: string,
): Promise<Config<TaskQueue>> {
  const outputFilePath = path.join(
    path.dirname(ciConfigFilePath),
    `compiled-era-ci-${chance().hash().slice(0, 8)}.config.js`,
  )

  const compiledConfig = await swc.transform(await fs.promises.readFile(ciConfigFilePath, 'utf-8'), {
    jsc: {
      parser: {
        syntax: 'typescript',
        decorators: false,
        dynamicImport: false,
      },
      target: 'es2019',
    },
    module: {
      type: 'commonjs',
      strict: true,
      noInterop: false,
    },
  })

  await fs.promises.writeFile(outputFilePath, compiledConfig.code, 'utf-8')

  const result = (await import(outputFilePath)).default
  const configuration = result.default ?? result

  await fs.promises.unlink(outputFilePath).catch(() => {
    // ignore error
  })

  if (validateConfiguration<TaskQueue>(configuration)) {
    return configuration
  } else {
    const [error] = validate(configuration, getConfigValidationObject())
    throw new Error(`failed to parse era-ci.config.ts file: ${error?.message}`)
  }
}

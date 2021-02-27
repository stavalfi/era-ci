import * as swc from '@swc/core'
import chance from 'chance'
import fs from 'fs'
import path from 'path'
import { Describe, is, number, object, optional, string, validate } from 'superstruct'
import { WorkerConfig } from './types'

function getConfigValidationObject(): Describe<WorkerConfig> {
  return object({
    queueName: string(),
    maxWaitMsWithoutTasks: number(),
    maxWaitMsUntilFirstTask: number(),
    redis: object({
      url: string(),
      auth: optional(
        object({
          username: optional(string()),
          password: optional(string()),
        }),
      ),
    }),
  })
}

function validateConfiguration(configuration: unknown): configuration is WorkerConfig {
  return is(configuration, getConfigValidationObject())
}

export async function parseConfig(repoPath: string, ciConfigFilePath: string): Promise<WorkerConfig> {
  const outputFilePath = path.join(
    path.dirname(ciConfigFilePath),
    `compiled-task-worker-${chance().hash().slice(0, 8)}.config.js`,
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

  if (validateConfiguration(configuration)) {
    return configuration
  } else {
    const [error] = validate(configuration, getConfigValidationObject())
    throw new Error(`failed to parse task-worker.config.ts file: ${error?.message}`)
  }
}

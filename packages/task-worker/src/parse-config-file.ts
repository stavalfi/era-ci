import execa from 'execa'
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

export async function parseConfig(ciConfigFilePath: string): Promise<WorkerConfig> {
  const outputFilePath = path.join(path.dirname(ciConfigFilePath), `compiled-task-worker.config.js`)
  const swcConfigFile = require.resolve('@era-ci/task-worker/.era-ci-swcrc.config')
  const swcPath = require.resolve('.bin/swc')
  const command = `${swcPath} ${ciConfigFilePath} -o ${outputFilePath} --config-file ${swcConfigFile}`

  await execa.command(command, {
    stdio: 'pipe',
  })

  const result = (await import(outputFilePath)).default
  const configuration = result.default ?? result

  // await fse.remove(outputFilePath).catch(() => {
  //   // ignore error
  // })

  if (validateConfiguration(configuration)) {
    return configuration
  } else {
    const [error] = validate(configuration, getConfigValidationObject())
    throw new Error(`failed to parse task-worker.config.ts file: ${error?.message}`)
  }
}

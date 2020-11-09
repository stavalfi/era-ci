import execa from 'execa'
import path from 'path'
import { array, func, is, number, object, string, validate, optional } from 'superstruct'
import { TaskQueueBase } from '../create-task-queue'
import { Config } from './types'

/**
 * ensures type safty of task-queues by only allowing steps thats uses task-queues which are declared in `task-queues` array.
 * @param options nc options
 */
export function config<TaskQueueName extends string, TaskQueue extends TaskQueueBase<TaskQueueName>>(
  options: Config<TaskQueueName, TaskQueue>,
): Config<TaskQueueName, TaskQueue> {
  return options
}

function getConfigValidationObject() {
  return object({
    logger: object({
      callInitializeLogger: func(),
    }),
    keyValueStore: object({
      callInitializeKeyValueStoreConnection: func(),
    }),
    taskQueues: array(
      object({
        taskQueueName: optional(string()),
        callInitializeTaskQueue: func(),
      }),
    ),
    steps: array(
      object({
        data: object({
          runStep: func(),
          taskQueueName: optional(string()),
          stepInfo: object({
            stepId: string(),
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

function validateConfiguration<TaskQueueName extends string, TaskQueue extends TaskQueueBase<TaskQueueName>>(
  configuration: unknown,
): configuration is Config<TaskQueueName, TaskQueue> {
  return is(configuration, getConfigValidationObject())
}

export async function readNcConfigurationFile<
  TaskQueueName extends string,
  TaskQueue extends TaskQueueBase<TaskQueueName>
>(ciConfigFilePath: string): Promise<Config<TaskQueueName, TaskQueue>> {
  const outputFilePath = path.join(path.dirname(ciConfigFilePath), `compiled-nc.config.js`)
  const swcConfigFile = require.resolve('@tahini/nc/.nc-swcrc.config')
  const swcPath = require.resolve('.bin/swc')
  const command = `${swcPath} ${ciConfigFilePath} -o ${outputFilePath} --config-file ${swcConfigFile}`

  await execa.command(command, {
    stdio: 'pipe',
  })

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const configGeneratorFunction = require(outputFilePath)
  const configuration = await configGeneratorFunction.default

  // await fse.remove(outputFilePath).catch(() => {
  //   // ignore error
  // })

  if (validateConfiguration<TaskQueueName, TaskQueue>(configuration)) {
    return configuration
  } else {
    const [error] = validate(configuration, getConfigValidationObject())
    throw new Error(`failed to parse nc.config.js file: ${error?.message}`)
  }
}

import execa from 'execa'
import path from 'path'
import { array, func, is, number, object, string, validate } from 'superstruct'
import { Config } from './types'

function getConfigValidationObject() {
  return object({
    logger: object({
      callInitializeLogger: func(),
    }),
    cache: object({
      callInitializeCache: func(),
    }),
    steps: array(
      object({
        data: object({
          runStep: func(),
          stepInfo: object({
            stepId: string(),
            stepName: string(),
          }),
        }),
        index: number(),
        parentsIndexes: array(number()),
        childrenIndexes: array(number()),
      }),
    ),
  })
}

function validateConfiguration(configuration: unknown): configuration is Config {
  return is(configuration, getConfigValidationObject())
}

export async function readNcConfigurationFile(ciConfigFilePath: string): Promise<Config> {
  const outputFilePath = path.join(path.dirname(ciConfigFilePath), `compiled-nc.config.js`)
  const swcConfigFile = require.resolve('@tahini/nc/.nc-swcrc.config')
  const swcPath = require.resolve('.bin/swc')
  const command = `${swcPath} ${ciConfigFilePath} -o ${outputFilePath} --config-file ${swcConfigFile}`

  await execa.command(command, {
    stdio: 'pipe',
  })

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const configGeneratorFunction = require(outputFilePath)
  const configuration = await configGeneratorFunction.default()

  // await fse.remove(outputFilePath).catch(() => {
  //   // ignore error
  // })

  if (validateConfiguration(configuration)) {
    return configuration
  } else {
    const [error] = validate(configuration, getConfigValidationObject())
    throw new Error(`failed to parse nc.config.js file: ${error?.message}`)
  }
}

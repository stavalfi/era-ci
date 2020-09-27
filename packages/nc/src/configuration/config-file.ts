import path from 'path'
import { is, object, string, validate, func, array } from 'superstruct'
import { ConfigFile } from './types'
import execa from 'execa'

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
        stepName: string(),
        runStep: func(),
      }),
    ),
  })
}

function validateConfiguration(configuration: unknown): configuration is ConfigFile {
  return is(configuration, getConfigValidationObject())
}

export async function readNcConfigurationFile(ciConfigFilePath: string): Promise<ConfigFile> {
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

import execa from 'execa'
import path from 'path'
import { ConfigFileOptions } from '../types'

async function validateConfiguration(configuration: unknown): Promise<ConfigFileOptions<unknown>> {
  const error = new Error(
    `nc-configuration file default-export must be a function of type: "() => Promise<CiOptions>". after invoking the function, the result was: ${configuration}`,
  )

  if (typeof configuration !== 'object') {
    throw error
  }

  if (!configuration) {
    throw error
  }

  const allowedOptions = ['targets', 'redis', 'git']

  const invalidOptions = Object.keys(configuration).filter(option => !allowedOptions.includes(option))
  if (invalidOptions.length > 0) {
    throw new Error(
      `you returned invalid nc-configurations-keys: "${invalidOptions.join(
        ', ',
      )}". allowed options are: "${allowedOptions.join(', ')}"`,
    )
  }

  return configuration as ConfigFileOptions<unknown> // todo: validate type
}

export async function readNcConfigurationFile(ciConfigFilePath: string): Promise<ConfigFileOptions<unknown>> {
  const outputFilePath = path.join(__dirname, `nc.config.js`)
  const swcConfigFile = path.join(__dirname, '../../../.swcrc')
  const swcPath = require.resolve('.bin/swc')
  const command = `${swcPath} ${ciConfigFilePath} -o ${outputFilePath} --config-file ${swcConfigFile}`
  await execa.command(command)

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const configGeneratorFunction = require(outputFilePath)
  const config = await configGeneratorFunction.default()
  const configurations = await validateConfiguration(config)
  return configurations
}

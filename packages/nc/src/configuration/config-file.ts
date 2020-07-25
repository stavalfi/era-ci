import execa from 'execa'
import path from 'path'
import { ConfigFileOptions } from '../types'

async function validateConfiguration(configuration: unknown): Promise<ConfigFileOptions> {
  const error = new Error(
    `nc-configuration file default-export must be a function of type: "() => Promise<ConfigFileOptions>". after invoking the function, the result was: ${configuration}`,
  )
  if (typeof configuration !== 'object') {
    throw error
  }

  if (!configuration) {
    throw error
  }

  const allowedOptions = [
    'npmRegistry',
    'dockerRegistry',
    'gitServer',
    'redisServer',
    'dockerOrganizationName',
    'gitRepositoryName',
    'gitOrganizationName',
    'auth',
    'logFilePath',
    'shouldPublish',
    'isDryRun',
    'skipTests',
  ]

  const invalidOptions = Object.keys(configuration).filter(option => !allowedOptions.includes(option))
  if (invalidOptions.length > 0) {
    throw new Error(
      `you returned invalid nc-configurations-keys: ${invalidOptions.join(
        ', ',
      )}. allowed options are: "${allowedOptions.join(', ')}"`,
    )
  }

  return configuration as ConfigFileOptions // todo: validate type
}

export async function readNcConfigurationFile(ciConfigFilePath: string): Promise<ConfigFileOptions> {
  const outputFilePath = path.join(__dirname, `nc.config.js`)
  const swcConfigFile = path.join(__dirname, '../../../.swcrc')
  await execa.command(`swc ${ciConfigFilePath} -o ${outputFilePath} --config-file ${swcConfigFile}`)

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const configGeneratorFunction = require(outputFilePath)
  const config = await configGeneratorFunction.default()
  const configurations = validateConfiguration(config)
  return configurations
}

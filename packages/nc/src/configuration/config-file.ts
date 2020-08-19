import execa from 'execa'
import path from 'path'
import { boolean, func, is, object, optional, string, validate, union, literal } from 'superstruct'
import { ConfigFileOptions, NpmScopeAccess } from '../types'
import fse from 'fs-extra'

function getConfigValidationObject() {
  const npmTargetInfoBaseValidation = {
    shouldPublish: boolean(),
    npmScopeAccess: optional(union([literal(NpmScopeAccess.public), literal(NpmScopeAccess.restricted)])),
    registry: string(),
    // todo: it should be a opnion type similar to the typescript type.
    //       i don't use it here because when the user is wrong, they error is not clear.
    shouldDeploy: boolean(),
    deployment: optional(
      object({
        initializeDeploymentClient: func(),
        deploy: func(),
        destroyDeploymentClient: func(),
      }),
    ),
  }

  const dockerTargetInfoBaseValidation = {
    ...npmTargetInfoBaseValidation,
    dockerOrganizationName: string(),
  }

  return object({
    git: object({
      auth: object({
        username: string(),
        token: string(),
      }),
    }),
    redis: object({
      redisServer: string(),
      auth: object({
        password: string(),
      }),
    }),
    targetsInfo: optional(
      object({
        npm: optional(
          object({
            ...npmTargetInfoBaseValidation,
            publishAuth: object({
              email: string(),
              username: string(),
              token: string(),
            }),
          }),
        ),
        docker: optional(
          object({
            ...dockerTargetInfoBaseValidation,
            publishAuth: object({
              username: string(),
              token: string(),
            }),
          }),
        ),
      }),
    ),
  })
}

function validateConfiguration(configuration: unknown): configuration is ConfigFileOptions<unknown> {
  return is(configuration, getConfigValidationObject())
}

export async function readNcConfigurationFile(ciConfigFilePath: string): Promise<ConfigFileOptions<unknown>> {
  const outputFilePath = path.join(path.dirname(ciConfigFilePath), `compiled-nc.config.js`)
  const swcConfigFile = require.resolve('@tahini/nc/.nc-swcrc.config')
  const swcPath = require.resolve('.bin/swc')
  const command = `${swcPath} ${ciConfigFilePath} -o ${outputFilePath} --config-file ${swcConfigFile}`

  await execa.command(command)

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const configGeneratorFunction = require(outputFilePath)
  const configuration = await configGeneratorFunction.default()

  await fse.remove(outputFilePath).catch(() => {
    // ignore error
  })

  if (validateConfiguration(configuration)) {
    return configuration
  } else {
    const [error] = validate(configuration, getConfigValidationObject())
    throw new Error(`failed to parse nc.config.js file: ${error?.message}`)
  }
}

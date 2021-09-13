import colors from 'colors/safe'
import { config, LogLevel } from './packages/core/dist/src/index'
import { winstonLogger } from './packages/loggers/dist/src/index'
import { createTreeStepsGraph } from './packages/steps-graph/dist/src/index'
import {
  buildRoot,
  cliTableReporter,
  installRoot,
  jsonReporter,
  npmPublish,
  NpmScopeAccess,
  validatePackages,
} from './packages/steps/dist/src/index'
import { localSequentalTaskQueue } from './packages/task-queues/dist/src/index'

const {
  NPM_REGISTRY = 'http://localhost:34873',
  NPM_USERNAME = 'username',
  NPM_PASSWORD = 'password',
  NPM_EMAIL = 'any@email.com',
  REDIS_ENDPOINT = 'redis://localhost:36379',
  REDIS_PASSWORD,
  CI,
  LOG_LEVEL = LogLevel.info,
  // eslint-disable-next-line no-process-env
} = process.env

export default config({
  taskQueues: [localSequentalTaskQueue()],
  redis: {
    url: REDIS_ENDPOINT!,
    auth: {
      password: REDIS_PASSWORD,
    },
  },
  logger: winstonLogger({
    disabled: false,
    customLogLevel: LOG_LEVEL as LogLevel,
    logFilePath: './era-ci.log',
  }),
  steps: createTreeStepsGraph([
    {
      // 0
      step: validatePackages(),
      children: [1],
    },
    {
      // 1
      step: installRoot({ isStepEnabled: true }),
      children: [2],
    },
    {
      // 2
      step: buildRoot({ isStepEnabled: true, scriptName: 'build' }),
      children: [3],
    },
    {
      // 3
      step: npmPublish({
        isStepEnabled: !CI,
        npmScopeAccess: NpmScopeAccess.public,
        registry: NPM_REGISTRY,
        registryAuth: {
          email: NPM_EMAIL,
          username: NPM_USERNAME!,
          password: NPM_PASSWORD!,
        },
      }),
      children: [4],
    },
    {
      // 4
      step: jsonReporter(),
      children: [5],
    },
    {
      // 5
      step: cliTableReporter({ colorizeTable: s => colors.white(s) }),
      children: [],
    },
  ]),
})

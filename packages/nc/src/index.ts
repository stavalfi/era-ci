#!/usr/bin/env node --unhandled-rejections=strict
/* eslint-disable no-process-env */
/* eslint-disable no-floating-promise/no-floating-promise */

/// <reference path="../../../declarations.d.ts" />

// `require('source-map-support').install()` MUST be the first (executed) line in the project!!!
require('source-map-support').install()
//
import { logger } from '@tahini/log'
import { startCli } from './configuration/cli'

export { ConfigFileOptions, ServerInfo, TargetType, Protocol, DeployTarget } from './types'
export { buildFullDockerImageName, dockerRegistryLogin, getDockerImageLabelsAndTags } from './docker-utils'
export { npmRegistryLogin } from './npm-utils'

const log = logger('index')

if (require.main === module) {
  log.info(`Loading CI CLI...`)
  startCli(process.argv).finally(() => {
    if (process.env.NC_TEST_MODE) {
      // jest don't show last two console logs so we add this as a workaround
      // so we can see the *actual* two last console logs.
      log.info('---------------------------')
      log.info('---------------------------')
    }
  })
}

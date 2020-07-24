#!/usr/bin/env node --unhandled-rejections=strict

/// <reference path="../../../declarations.d.ts" />

// `require('source-map-support').install()` MUST be the first one!!!
require('source-map-support').install()
//
import { logger } from '@tahini/log'
import { startCli } from './cli'

export { CiOptions, runCiCli } from './ci-node-api'

const log = logger('index')

if (require.main === module) {
  // eslint-disable-next-line no-floating-promise/no-floating-promise
  startCli().finally(() => {
    // eslint-disable-next-line no-process-env
    if (process.env.NC_TEST_MODE) {
      // jest don't show last two console logs so we add this as a workaround so we can see the actual two last console logs.
      log.info('---------------------------')
      log.info('---------------------------')
    }
  })
}

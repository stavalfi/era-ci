#!/usr/bin/env node --unhandled-rejections=strict

/// <reference path="../../../declarations.d.ts" />

// `require('source-map-support').install()` MUST be the first (executed) line in the project!!!
require('source-map-support').install()
//
import { startCli } from './configuration/cli'

export { ConfigFileOptions, ServerInfo, TargetType, Protocol, DeployTarget, NpmScopeAccess } from './types'
export { buildFullDockerImageName, dockerRegistryLogin, getDockerImageLabelsAndTags } from './docker-utils'
export { npmRegistryLogin, getNpmRegistryAddress } from './npm-utils'

if (require.main === module) {
  startCli(process.argv).finally(() => {
    // eslint-disable-next-line no-process-env
    if (process.env.NC_TEST_MODE) {
      // jest don't show last two console logs so we add this as a workaround
      // so we can see the *actual* two last console logs.
      // eslint-disable-next-line no-console
      console.log('---------------------------')
      // eslint-disable-next-line no-console
      console.log('---------------------------')
    }
  })
}

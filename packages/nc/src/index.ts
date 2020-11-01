#!/usr/bin/env node --unhandled-rejections=strict

/// <reference path="../../../declarations.d.ts" />

// `require('source-map-support').install()` MUST be the first (executed) line in the project!!!
// eslint-disable-next-line @typescript-eslint/no-var-requires
// require('source-map-support').install()
//
import { startCli } from './configuration/cli'

export { execaCommand } from './utils'
export { createLinearStepsGraph } from './create-linear-steps-graph'
export { Artifact, Graph, PackageJson, ExecutionStatus, Status, ConstrainResult } from './types'
export { Config } from './configuration'
export { Step, StepInfo, createStep, RunStrategy } from './create-step'
export { Log, LogLevel, Logger, CreateLogger } from './create-logger'
export { Cache, CreateCache } from './create-cache'
export {
  NpmScopeAccess,
  buildFullDockerImageName,
  getDockerImageLabelsAndTags,
  npmRegistryLogin,
  TargetType,
  cliTableReporter,
  jsonReporter,
  test,
  npmPublish,
  k8sGcloudDeployment,
  dockerPublish,
  build,
  JsonReport,
  install,
  lint,
  validatePackages,
  stringToJsonReport,
  jsonReporterCacheKey,
  jsonReportToString,
} from './steps'
export { LoggerConfiguration, winstonLogger } from './winston-logger'
export { CacheConfiguration, immutableRedisWithNodeCache } from './redis-with-node-cache'
export {
  createArtifactStepConstrain,
  ArtifactInStepConstrain,
  ArtifactInStepConstrainResult,
} from './create-artifact-step-constrain'
export { createStepConstrain, StepConstrain, StepConstrainResult } from './create-step-constrain'

async function main() {
  try {
    await startCli(process.argv)
  } finally {
    // eslint-disable-next-line no-process-env
    if (process.env.NC_TEST_MODE) {
      // jest don't show last two console logs so we add this as a workaround
      // so we can see the *actual* two last console logs.
      // eslint-disable-next-line no-console
      console.log('---------------------------')
      // eslint-disable-next-line no-console
      console.log('---------------------------')
    }
  }
}

if (require.main === module) {
  main()
}

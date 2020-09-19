import ciInfo from 'ci-info'
import { build } from './steps/build'
import { install } from './steps/install'
import { npmPublish, NpmScopeAccess } from './steps/npm-publish'
import { test } from './steps/test'
import { RunStep } from './types'

const {
  NPM_USERNAME,
  NPM_TOKEN,
  // eslint-disable-next-line no-process-env
} = process.env

const isMasterBuild = Boolean(ciInfo.isCI && !ciInfo.isPR)

export const steps: RunStep[] = [
  install(),
  build(),
  test({
    testScriptName: 'test',
  }),
  npmPublish({
    shouldPublish: isMasterBuild,
    npmScopeAccess: NpmScopeAccess.public,
    registry: `https://registry.npmjs.org/`,
    publishAuth: {
      email: 'stavalfi@gmail.com',
      username: NPM_USERNAME!,
      token: NPM_TOKEN!,
    },
  }),
]

import { test } from './steps/test'
import { build } from './steps/build'
import { install } from './steps/install'
import { RunStep } from './types'

export const steps: RunStep[] = [
  install(),
  build(),
  test({
    testScriptName: 'test',
  }),
]

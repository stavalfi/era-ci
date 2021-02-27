import { createTest } from '@era-ci/e2e-tests-infra'
import { describe, expect, test } from '@jest/globals'

const { createRepo } = createTest()

describe('@era-ci/core --print-flow <flow-id>', () => {
  test('ensure we can print old flow logs', async () => {
    const { runCi } = await createRepo({
      repo: {
        packages: [],
      },
      configurations: {
        steps: [],
      },
    })
    const { flowId, printFlowLogsFromCli } = await runCi()

    const result = await printFlowLogsFromCli()
    expect(result).toEqual(expect.stringContaining(flowId))
  })

  test('fail when we try to print logs of flow-id that does not exists', async () => {
    const { runCi } = await createRepo({
      repo: {
        packages: [],
      },
      configurations: {
        steps: [],
      },
    })
    const { printFlowLogsFromCli } = await runCi()

    const result = await printFlowLogsFromCli('flow-id-that-does-not-exists')
    expect(result).toEqual('no-logs')
  })
})

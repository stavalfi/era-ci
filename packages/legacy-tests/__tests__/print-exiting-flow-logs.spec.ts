import { newEnv } from './prepare-test'
import { TargetType } from './prepare-test/types'

const { createRepo } = newEnv()

test('ensure we can print old flow logs', async () => {
  const { runCi, getFlowLogs } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
      },
    ],
  })
  const result1 = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: false,
        shouldDeploy: false,
      },
    },
  })

  expect(result1.flowId).toBeTruthy()
  const flowLogsResult = await getFlowLogs({
    flowId: result1.flowId!,
  })

  expect(flowLogsResult.stdout).toMatch(result1.flowId!)
})

test('fail when we try to print logs of flow-id that does not exists', async () => {
  const { getFlowLogs } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
      },
    ],
  })

  const flowLogsResult = await getFlowLogs({
    flowId: 'flow-id-that-does-not-exists',
    execaOptions: {
      reject: false,
    },
  })

  expect(flowLogsResult.failed).toBeTruthy()
})

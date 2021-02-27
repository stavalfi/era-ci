export function createFlowsPassedFailedNote({
  currentFlowId,
  flowIds,
  result,
  step,
}: {
  step: string
  result: 'failed' | 'passed'
  currentFlowId: string
  flowIds: string[]
}): string {
  if (flowIds.length === 0) {
    throw new Error(`not supported`)
  }
  if (flowIds.length === 1) {
    if (flowIds[0] === currentFlowId) {
      return `step: "${step}" ${result} in this flow`
    } else {
      return `step: "${step}" ${result} in flow: ${flowIds[0]}`
    }
  } else {
    if (flowIds.includes(currentFlowId)) {
      return `step: "${step}" ${result} in this and ${flowIds.length - 1} more flows`
    } else {
      return `step: "${step}" ${result} in flow: ${flowIds[0]} and ${flowIds.length - 1} more flows`
    }
  }
}

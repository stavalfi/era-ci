import { Protocol, ServerInfo } from '../types'
import { StepStatus } from './types'
import urlParse from 'url-parse'

export const didPassOrSkippedAsPassed = (stepStatus: StepStatus) =>
  [StepStatus.passed, StepStatus.skippedAsPassed].includes(stepStatus)

export function calculateCombinedStatus(statuses: StepStatus[]): StepStatus {
  if (statuses.length === 0) {
    return StepStatus.skippedAsPassed
  }
  if (statuses.includes(StepStatus.failed)) {
    return StepStatus.failed
  }
  if (statuses.includes(StepStatus.skippedAsFailed)) {
    return StepStatus.skippedAsFailed
  }
  if (statuses.includes(StepStatus.skippedAsPassed)) {
    return StepStatus.skippedAsPassed
  }
  return StepStatus.passed
}

function isProtocolSupported(protocol: string): protocol is Protocol {
  return Object.values(Protocol).includes(protocol as Protocol)
}

function getPort(procotol: Protocol, port: number | string): number {
  if (port === 0) {
    return port
  }
  return Number(port) || (procotol === Protocol.http ? 80 : 443)
}

export function getServerInfoFromRegistryAddress(registryAddress: string): ServerInfo {
  const parsed = urlParse(registryAddress)
  const protocol = parsed.protocol.replace(':', '')
  const protocolError = (protocol: string) => {
    const allowedProtocols = Object.values(Protocol).join(' or ')
    return new Error(
      `url must contain protocol: "${allowedProtocols}". received protocol: "${protocol}" -->> "${registryAddress}"`,
    )
  }
  if (!isProtocolSupported(protocol)) {
    throw protocolError(protocol)
  }
  return {
    host: parsed.hostname,
    port: getPort(protocol, parsed.port),
    protocol: protocol,
  }
}

import winston from 'winston'
import { customLogLevel, isNcTestMode } from './env'
import {
  consoleTransport,
  createFileTransport,
  defaultFormat,
  reportToLogFileFormat,
  reportTransport,
} from './transports'
import { Log, LogLevel } from './types'

const mainLogger = winston.createLogger({
  level: customLogLevel || (isNcTestMode ? 'verbose' : 'info'),
  transports: [consoleTransport],
})

const noFormattingLogger = winston.createLogger({
  transports: [reportTransport],
})

export function attachLogFileTransport(logFilePath: string): void {
  mainLogger.add(createFileTransport(logFilePath, defaultFormat))
  noFormattingLogger.add(createFileTransport(logFilePath, reportToLogFileFormat))
}

export async function closeLoggers(): Promise<void> {
  await Promise.all([
    new Promise(res => mainLogger.on('finish', () => mainLogger.end(res))),
    new Promise(res => noFormattingLogger.on('finish', () => mainLogger.end(res))),
  ])
}

export const logger = (module: string): Log => {
  const log = mainLogger.child({ module })
  const base: Omit<Log, 'fromStream'> = {
    error: (message, error) => {
      if (error === null || undefined) {
        log.error(message)
      } else {
        log.error(message, error instanceof Error ? error : { unknownErrorType: error })
      }
    },
    info: message => log.info(message),
    verbose: message => log.verbose(message),
    noFormattingStdout: message => noFormattingLogger.info(message),
    noFormattingStderr: message => noFormattingLogger.error(message),
  }
  return {
    ...base,
    fromStream: (logLevel: LogLevel, stream: NodeJS.ReadableStream, formatting?: boolean) => {
      stream.on('data', chunk => {
        const asString = chunk.toString()
        const final = asString.endsWith('\n') ? asString.substr(0, asString.lastIndexOf('\n')) : asString
        if (formatting) {
          base[logLevel](final)
        } else {
          noFormattingLogger[logLevel](final)
        }
      })
    },
  }
}

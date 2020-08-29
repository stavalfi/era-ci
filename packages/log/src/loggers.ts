import winston from 'winston'
import { customLogLevel, isNcTestMode } from './env'
import { transforms } from './log-transform'
import {
  consoleTransport,
  createFileTransport,
  reportTransport,
  defaultFormat,
  reportToLogFileFormat,
} from './transports'
import { Log, LogLevel } from './types'

const mainLogger = winston.createLogger({
  level: customLogLevel || (isNcTestMode ? 'verbose' : 'info'),
  transports: [consoleTransport],
})

const reportLogger = winston.createLogger({
  transports: [reportTransport],
})

export const logReport = (report: string) => reportLogger.info(report)

export function attachLogFileTransport(logFilePath: string): void {
  mainLogger.add(createFileTransport(logFilePath, defaultFormat))
  reportLogger.add(createFileTransport(logFilePath, reportToLogFileFormat))
}

export const logger = (module: string): Log => {
  const log = mainLogger.child({ module })
  return {
    error: (message, error) => {
      if (error === null || undefined) {
        log.error(message)
      } else {
        log.error(message, error instanceof Error ? error : { unknownErrorType: error })
      }
    },
    info: message => {
      log.info(message)
    },
    verbose: message => {
      log.verbose(message)
    },
    fromStream: (logLevel: LogLevel, stream: NodeJS.ReadableStream) => {
      stream.pipe(transforms[logLevel]).pipe(log)
    },
  }
}

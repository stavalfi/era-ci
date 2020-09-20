import { createLogger, Log, LogLevel } from '../create-logger'
import { createConsoleTransport, createFileTransport, defaultFormat, noFormat } from './transports'
import winston from 'winston'
import path from 'path'

export type LoggerConfiguration = {
  customLogLevel: LogLevel
  disable?: boolean
  logFilePath?: string
}

export type NormalizedLoggerConfiguration = {
  customLogLevel: LogLevel
  disable: boolean
  logFilePath: string
}

export const winstonLogger = createLogger<LoggerConfiguration, NormalizedLoggerConfiguration>({
  normalizeLoggerConfigurations: async ({
    loggerConfigurations: { customLogLevel, disable, logFilePath },
    repoPath,
  }) => {
    let finalLogFilePath: string
    if (logFilePath) {
      if (path.isAbsolute(logFilePath)) {
        finalLogFilePath = logFilePath
      } else {
        finalLogFilePath = path.join(repoPath, logFilePath)
      }
    } else {
      finalLogFilePath = path.join(repoPath, 'nc.log')
    }
    return {
      customLogLevel,
      disable: Boolean(disable),
      logFilePath: finalLogFilePath,
    }
  },
  initializeLogger: async ({ loggerConfigurations }) => {
    const mainLogger = winston.createLogger({
      level: loggerConfigurations.customLogLevel,
      transports: [
        createConsoleTransport(defaultFormat),
        createFileTransport(loggerConfigurations.logFilePath, defaultFormat),
      ],
      silent: loggerConfigurations.disable,
    })

    const noFormattingLogger = winston.createLogger({
      level: loggerConfigurations.customLogLevel,
      transports: [createConsoleTransport(noFormat), createFileTransport(loggerConfigurations.logFilePath, noFormat)],
      silent: loggerConfigurations.disable,
    })

    const noFormattingOnlyFileLogger = winston.createLogger({
      level: loggerConfigurations.customLogLevel,
      transports: [createFileTransport(loggerConfigurations.logFilePath, noFormat)],
      silent: loggerConfigurations.disable,
    })

    return (module: string): Log => {
      const log = mainLogger.child({ module })
      const base: Omit<Log, 'infoFromStream' | 'errorFromStream'> = {
        error: (message, error) => {
          if (error === null || undefined) {
            log.error(message)
          } else {
            log.error(message, error instanceof Error ? error : { unknownErrorType: error })
          }
        },
        info: message => log.info(message),
        verbose: message => log.verbose(message),
        noFormattingInfo: message => noFormattingLogger.info(message),
        noFormattingError: message => noFormattingLogger.error(message),
      }
      return {
        ...base,
        infoFromStream: (stream: NodeJS.ReadableStream) => {
          stream.pipe(process.stdout)
          stream.on('data', chunk => {
            const asString = chunk.toString()
            const final = asString.endsWith('\n') ? asString.substr(0, asString.lastIndexOf('\n')) : asString
            noFormattingOnlyFileLogger.info(final)
          })
        },
        errorFromStream: (stream: NodeJS.ReadableStream) => {
          stream.pipe(process.stderr)
          stream.on('data', chunk => {
            const asString = chunk.toString()
            const final = asString.endsWith('\n') ? asString.substr(0, asString.lastIndexOf('\n')) : asString
            noFormattingOnlyFileLogger.error(final)
          })
        },
      }
    }
  },
})

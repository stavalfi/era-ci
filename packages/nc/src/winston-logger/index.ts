import { createLogger, Log, LogLevel } from '../create-logger'
import { createConsoleTransport, createFileTransport, defaultFormat, noFormat } from './transports'
import winston from 'winston'
import path from 'path'
import fse from 'fs-extra'

export type LoggerConfiguration = {
  customLogLevel: LogLevel
  disabled?: boolean
  logFilePath: string
}

type NormalizedLoggerConfiguration = {
  customLogLevel: LogLevel
  disabled: boolean
  logFilePath: string
}

export const winstonLogger = createLogger<LoggerConfiguration, NormalizedLoggerConfiguration>({
  normalizeLoggerConfigurations: async ({
    loggerConfigurations: { customLogLevel, disabled, logFilePath },
    repoPath,
  }) => {
    let finalLogFilePath: string
    if (path.isAbsolute(logFilePath)) {
      finalLogFilePath = logFilePath
    } else {
      finalLogFilePath = path.join(repoPath, logFilePath)
    }
    return {
      customLogLevel,
      disabled: Boolean(disabled),
      logFilePath: finalLogFilePath,
    }
  },
  initializeLogger: async ({ loggerConfigurations }) => {
    await fse.remove(loggerConfigurations.logFilePath)

    const mainLogger = winston.createLogger({
      level: loggerConfigurations.customLogLevel,
      transports: [
        createConsoleTransport(defaultFormat),
        createFileTransport(loggerConfigurations.logFilePath, defaultFormat),
      ],
      silent: loggerConfigurations.disabled,
    })

    const noFormattingLogger = winston.createLogger({
      level: loggerConfigurations.customLogLevel,
      transports: [createConsoleTransport(noFormat), createFileTransport(loggerConfigurations.logFilePath, noFormat)],
      silent: loggerConfigurations.disabled,
    })

    const noFormattingOnlyFileLogger = winston.createLogger({
      level: loggerConfigurations.customLogLevel,
      transports: [createFileTransport(loggerConfigurations.logFilePath, noFormat)],
      silent: loggerConfigurations.disabled,
    })

    const createLog = (module: string): Log => {
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
    return { createLog, logFilePath: loggerConfigurations.logFilePath }
  },
})

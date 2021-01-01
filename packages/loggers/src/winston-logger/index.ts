import { createLogger, Log, LogLevel } from '@tahini/core'
import { createConsoleTransport, createFileTransport, defaultFormat, noFormat } from './transports'
import winston from 'winston'
import path from 'path'
import fse from 'fs-extra'

export type LoggerConfiguration =
  | {
      disabled: true
    }
  | {
      customLogLevel: LogLevel
      logFilePath: string
      disableFileOutput?: boolean
      disabled?: boolean
    }

type NormalizedLoggerConfiguration = {
  customLogLevel: LogLevel
  disableFileOutput: boolean
  disabled: boolean
  logFilePath: string
}

export const winstonLogger = createLogger<LoggerConfiguration, NormalizedLoggerConfiguration>({
  normalizeLoggerConfigurations: async ({ loggerConfigurations, repoPath }) => {
    if (loggerConfigurations.disabled) {
      return {
        disabled: true,
        disableFileOutput: true,
        customLogLevel: LogLevel.debug,
        logFilePath: path.join(repoPath, 'nc.log'),
      }
    } else {
      let finalLogFilePath: string
      if (path.isAbsolute(loggerConfigurations.logFilePath)) {
        finalLogFilePath = loggerConfigurations.logFilePath
      } else {
        finalLogFilePath = path.join(repoPath, loggerConfigurations.logFilePath)
      }
      return {
        customLogLevel: loggerConfigurations.customLogLevel,
        disableFileOutput: Boolean(loggerConfigurations.disableFileOutput),
        disabled: Boolean(loggerConfigurations.disabled),
        logFilePath: finalLogFilePath,
      }
    }
  },
  initializeLogger: async ({ loggerConfigurations }) => {
    await fse.remove(loggerConfigurations.logFilePath)
    const mainLogger = winston.createLogger({
      level: loggerConfigurations.customLogLevel === LogLevel.trace ? 'silly' : loggerConfigurations.customLogLevel,
      transports: [
        createConsoleTransport(defaultFormat),
        createFileTransport(loggerConfigurations.logFilePath, loggerConfigurations.disableFileOutput, defaultFormat),
      ],
      silent: loggerConfigurations.disabled,
    })
    const noFormattingLogger = winston.createLogger({
      level: loggerConfigurations.customLogLevel === LogLevel.trace ? 'silly' : loggerConfigurations.customLogLevel,
      transports: [
        createConsoleTransport(noFormat),
        createFileTransport(loggerConfigurations.logFilePath, loggerConfigurations.disableFileOutput, noFormat),
      ],
      silent: loggerConfigurations.disabled,
    })

    const noFormattingOnlyFileLogger = winston.createLogger({
      level: loggerConfigurations.customLogLevel === LogLevel.trace ? 'silly' : loggerConfigurations.customLogLevel,
      transports: [
        createFileTransport(loggerConfigurations.logFilePath, loggerConfigurations.disableFileOutput, noFormat),
      ],
      silent: loggerConfigurations.disabled,
    })

    const createLog = (module: string, options?: { disable?: boolean }): Log => {
      const log = mainLogger.child({ module })
      const base: Omit<Log, 'infoFromStream' | 'errorFromStream'> = {
        logLevel: loggerConfigurations.customLogLevel,
        error: (message, error, json) => {
          if (!options?.disable) {
            if (error === null || undefined) {
              log.error(message)
            } else {
              log.error(message, error instanceof Error ? error : { unknownErrorType: error }, { json })
            }
          }
        },
        info: (message, json) => !options?.disable && log.info(message, { json }),
        verbose: (message, json) => !options?.disable && log.verbose(message, { json }),
        debug: (message, json) => !options?.disable && log.debug(message, { json }),
        trace: (message, json) => !options?.disable && log.silly(message, { json }),
        noFormattingInfo: message => !options?.disable && noFormattingLogger.info(message),
        noFormattingError: message => !options?.disable && noFormattingLogger.error(message),
      }
      return {
        ...base,
        infoFromStream: (stream: NodeJS.ReadableStream) => {
          if (!options?.disable) {
            stream.pipe(process.stdout)
            stream.on('data', chunk => {
              const asString = chunk.toString()
              const final = asString.endsWith('\n') ? asString.substr(0, asString.lastIndexOf('\n')) : asString
              noFormattingOnlyFileLogger.info(final)
            })
          }
        },
        errorFromStream: (stream: NodeJS.ReadableStream) => {
          if (!options?.disable) {
            stream.pipe(process.stderr)
            stream.on('data', chunk => {
              const asString = chunk.toString()
              const final = asString.endsWith('\n') ? asString.substr(0, asString.lastIndexOf('\n')) : asString
              noFormattingOnlyFileLogger.error(final)
            })
          }
        },
      }
    }
    return { createLog, logFilePath: loggerConfigurations.logFilePath, logLevel: loggerConfigurations.customLogLevel }
  },
})

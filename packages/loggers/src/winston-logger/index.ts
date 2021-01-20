import { createLogger, Log, LogLevel } from '@era-ci/core'
import {
  createConsoleTransport,
  createCustomLogTransport,
  createFileTransport,
  defaultFormat,
  noFormat,
} from './transports'
import winston from 'winston'
import path from 'path'
import fse from 'fs-extra'
import { formatLog } from './formatter'

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
        logFilePath: path.join(repoPath, 'era-ci.log'),
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
  initializeLogger: async ({ loggerConfigurations, customLog }) => {
    await fse.remove(loggerConfigurations.logFilePath)
    const mainLogger = winston.createLogger({
      level: loggerConfigurations.customLogLevel === LogLevel.trace ? 'silly' : loggerConfigurations.customLogLevel,
      transports: [
        customLog
          ? createCustomLogTransport({ customLog, customFormat: formatLog, format: defaultFormat })
          : createConsoleTransport(defaultFormat),
        createFileTransport(loggerConfigurations.logFilePath, loggerConfigurations.disableFileOutput, defaultFormat),
      ],
      silent: loggerConfigurations.disabled,
    })
    const noFormattingLogger = winston.createLogger({
      level: loggerConfigurations.customLogLevel === LogLevel.trace ? 'silly' : loggerConfigurations.customLogLevel,
      transports: [
        customLog ? createCustomLogTransport({ customLog, format: noFormat }) : createConsoleTransport(noFormat),
        createFileTransport(loggerConfigurations.logFilePath, loggerConfigurations.disableFileOutput, noFormat),
      ],
      silent: loggerConfigurations.disabled,
    })

    const createLog = (module: string, options?: { disable?: boolean }): Log => {
      const log = mainLogger.child({ module })
      if (options?.disable) {
        return {
          logLevel: loggerConfigurations.customLogLevel,
          debug: () => {
            //
          },
          error: () => {
            //
          },
          errorFromStream: () => {
            //
          },
          info: () => {
            //
          },
          infoFromStream: () => {
            //
          },
          noFormattingError: () => {
            //
          },
          noFormattingInfo: () => {
            //
          },
          trace: () => {
            //
          },
          verbose: () => {
            //
          },
        }
      }
      const base: Omit<Log, 'infoFromStream' | 'errorFromStream'> = {
        logLevel: loggerConfigurations.customLogLevel,
        error: (message, error, json) => {
          if (error === null || undefined) {
            log.error(message, { json })
          } else {
            log.error(message, error instanceof Error ? error : { unknownErrorType: error }, { json })
          }
        },
        info: (message, json) => log.info(message, { json }),
        verbose: (message, json) => log.verbose(message, { json }),
        debug: (message, json) => log.debug(message, { json }),
        trace: (message, json) => log.silly(message, { json }),
        noFormattingInfo: message => noFormattingLogger.info(message),
        noFormattingError: message => noFormattingLogger.error(message),
      }
      return {
        ...base,
        infoFromStream: (stream: NodeJS.ReadableStream) => {
          // stream.pipe(process.stdout)
          stream.on('data', chunk => {
            const asString = chunk.toString()
            const final = asString.endsWith('\n') ? asString.substr(0, asString.lastIndexOf('\n')) : asString

            noFormattingLogger.info(final)
          })
        },
        errorFromStream: (stream: NodeJS.ReadableStream) => {
          // stream.pipe(process.stderr)
          stream.on('data', chunk => {
            const asString = chunk.toString()
            const final = asString.endsWith('\n') ? asString.substr(0, asString.lastIndexOf('\n')) : asString
            noFormattingLogger.error(final)
          })
        },
      }
    }
    return { createLog, logFilePath: loggerConfigurations.logFilePath, logLevel: loggerConfigurations.customLogLevel }
  },
})

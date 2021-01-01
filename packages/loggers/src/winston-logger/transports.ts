import winston from 'winston'
import { LogLevel } from '@era-ci/core'
import { randomModuleColor } from './modules-color'

export const defaultFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.colorize(),
  winston.format.printf(log => {
    const logLevel = log.level.replace('silly', LogLevel.trace)
    const withModule = log.module ? ` [${randomModuleColor(log.module)}] ` : ' '
    const base = `${log.timestamp}${withModule}${logLevel}`
    let final = ''
    if (log.stack) {
      // workaround to print error with stacktrace: https://github.com/winstonjs/winston/issues/1338#issuecomment-643473267
      let returnLog = `${base}: ${log.message.replace(log.stack.split('\n')[0].substr(7), '')}`
      returnLog += '\n'
      returnLog += '[' + logLevel + '] '
      returnLog += log.stack.replace(/\n/g, `\n[${logLevel}]\t`)
      final = `${returnLog}: `
    } else {
      if (log.unknownErrorType) {
        final = `${base}: ${log.message} - ${log.unknownErrorType}`
      } else {
        final = `${base}: ${log.message}`
      }
    }
    if (log.json && Object.keys(log.json).length > 0) {
      final += '\n'
      final += '[' + logLevel + '] '
      final += JSON.stringify(log.json, null, 2).replace(/\n/g, `\n[${logLevel}]\t`)
    }
    return final
  }),
  winston.format.errors({ stack: true }), // <-- use errors format
)

export const noFormat = winston.format.combine(winston.format.printf(log => log.message))

export const createConsoleTransport = (format: winston.Logform.Format): winston.transports.ConsoleTransportInstance =>
  new winston.transports.Console({
    stderrLevels: ['error'],
    format: format,
  })

export const createFileTransport = (
  ncLogFilePath: string,
  silent: boolean,
  format?: winston.Logform.Format,
): winston.transports.FileTransportInstance =>
  new winston.transports.File({
    format,
    filename: ncLogFilePath,
    silent,
  })

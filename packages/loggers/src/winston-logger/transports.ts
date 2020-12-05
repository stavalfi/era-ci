import winston from 'winston'
import { randomModuleColor } from './modules-color'

// const { combine, timestamp, printf, errors } = winston.format

export const defaultFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.colorize(),
  winston.format.printf(log => {
    const withModule = log.module ? ` [${randomModuleColor(log.module)}] ` : ' '
    const base = `${log.timestamp}${withModule}${log.level}`
    let final = ''
    if (log.stack) {
      // workaround to print error with stacktrace: https://github.com/winstonjs/winston/issues/1338#issuecomment-643473267
      let returnLog = `${base}: ${log.message.replace(log.stack.split('\n')[0].substr(7), '')}`
      returnLog += '\n'
      returnLog += '[' + log.level + '] '
      returnLog += log.stack.replace(/\n/g, `\n[${log.level}]\t`)
      final = `${returnLog}: `
    } else {
      if (log.unknownErrorType) {
        final = `${base}: ${log.message} - ${log.unknownErrorType}`
      } else {
        final = `${base}: ${log.message}`
      }
    }
    if (log.json) {
      final += '\n'
      final += '[' + log.level + '] '
      final += JSON.stringify(log.json, null, 2).replace(/\n/g, `\n[${log.level}]\t`)
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
  format?: winston.Logform.Format,
): winston.transports.FileTransportInstance =>
  new winston.transports.File({
    format,
    filename: ncLogFilePath,
  })

import winston from 'winston'
import { randomModuleColor } from './modules-color'

const { combine, timestamp, printf, errors } = winston.format

export const defaultFormat = combine(
  timestamp(),
  winston.format.colorize(),
  printf(log => {
    const withModule = log.module ? ` [${randomModuleColor(log.module)}] ` : ' '
    const base = `${log.timestamp}${withModule}${log.level}`
    if (log.stack) {
      // workaround to print error with stacktrace: https://github.com/winstonjs/winston/issues/1338#issuecomment-643473267
      let returnLog = `${base}: ${log.message.replace(log.stack.split('\n')[0].substr(7), '')}`
      returnLog += '\n'
      returnLog += '[' + log.level + '] '
      returnLog += log.stack.replace(/\n/g, `\n[${log.level}]\t`)
      return `${returnLog}: `
    } else {
      if (log.unknownErrorType) {
        return `${base}: ${log.message} - ${log.unknownErrorType}`
      } else {
        return `${base}: ${log.message}`
      }
    }
  }),
  errors({ stack: true }), // <-- use errors format
)

export const noFormat = combine(printf(log => log.message))

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

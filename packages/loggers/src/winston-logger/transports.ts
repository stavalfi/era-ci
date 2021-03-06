import winston from 'winston'
import { formatLog } from './formatter'

export const defaultFormat = (options: { flowId: string }) =>
  winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(log => formatLog(options.flowId, log)),
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

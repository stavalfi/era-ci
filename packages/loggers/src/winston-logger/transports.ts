import winston from 'winston'
import { CustomLogTransport } from './custom-logger-transport'
import { formatLog } from './formatter'

export const defaultFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.colorize(),
  winston.format.printf(formatLog),
  winston.format.errors({ stack: true }), // <-- use errors format
)

export const noFormat = winston.format.combine(winston.format.printf(log => log.message))

export const createConsoleTransport = (format: winston.Logform.Format): winston.transports.ConsoleTransportInstance =>
  new winston.transports.Console({
    stderrLevels: ['error'],
    format: format,
  })

export const createCustomLogTransport = (options: {
  customLog: (str: string) => void
  customFormat?: (logOptions: winston.Logform.TransformableInfo) => string
  format?: winston.Logform.Format
}): CustomLogTransport => new CustomLogTransport(options)

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

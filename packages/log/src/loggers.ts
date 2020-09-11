import winston from 'winston'
import { customLogLevel, isNcTestMode } from './env'
import { createConsoleTransport, createFileTransport, defaultFormat, noFormat } from './transports'
import { Log } from './types'
import fse from 'fs-extra'

const mainLogger = winston.createLogger({
  level: customLogLevel || (isNcTestMode ? 'verbose' : 'info'),
  transports: [createConsoleTransport(defaultFormat)],
})

const noFormattingLogger = winston.createLogger({
  level: customLogLevel || (isNcTestMode ? 'verbose' : 'info'),
  transports: [createConsoleTransport(noFormat)],
})

const noFormattingOnlyFileLogger = winston.createLogger({
  level: customLogLevel || (isNcTestMode ? 'verbose' : 'info'),
  transports: [],
})

export async function attachLogFileTransport(logFilePath: string): Promise<void> {
  await fse.remove(logFilePath)
  mainLogger.add(createFileTransport(logFilePath, defaultFormat))
  noFormattingLogger.add(createFileTransport(logFilePath, noFormat))
  noFormattingOnlyFileLogger.add(createFileTransport(logFilePath, noFormat))
}

export const logger = (module: string): Log => {
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

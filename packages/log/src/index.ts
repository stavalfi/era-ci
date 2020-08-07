import winston from 'winston'
import chalk from 'chalk'
import randomColor from 'randomcolor'

const { combine, timestamp, printf, errors } = winston.format

const moduleToColor = new Map<string, string>()

function randomModuleColor(module: string): string {
  const color = moduleToColor.get(module)
  if (color) {
    return chalk.hex(color)(module)
  } else {
    const newColor = randomColor({ luminosity: 'light' })
    moduleToColor.set(module, newColor)
    return chalk.hex(newColor)(module)
  }
}

const consoleTransport = new winston.transports.Console({
  stderrLevels: ['error'],
  format: combine(
    timestamp(),
    winston.format.colorize(),
    printf(log => {
      const base = `${log.timestamp} [${randomModuleColor(log.module)}] ${log.level}`
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
  ),
})

// eslint-disable-next-line no-process-env
const isNcTestMode = Boolean(process.env.NC_TEST_MODE)
const mainLogger = winston.createLogger({
  level: isNcTestMode ? 'verbose' : 'info',
  transports: [consoleTransport],
})

export type Log = {
  error: (message: string, error?: unknown) => void
  info: (message: string) => void
  verbose: (message: string) => void
}

export const logger = (module: string): Log => {
  const log = mainLogger.child({ module })
  return {
    error: (message, error) => {
      if (error === null || undefined) {
        log.error(message)
      } else {
        log.error(message, error instanceof Error ? error : { unknownErrorType: error })
      }
    },
    info: message => {
      log.info(message)
    },
    verbose: message => {
      log.verbose(message)
    },
  }
}

export const logReport = (report: string) =>
  winston
    .createLogger({
      transports: [
        new winston.transports.Console({
          format: combine(printf(({ message }) => message)),
        }),
      ],
    })
    .info(report)

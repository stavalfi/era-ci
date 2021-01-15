import Transport from 'winston-transport'

export class CustomLogTransport extends Transport {
  constructor(private readonly options: Transport.TransportStreamOptions & { customLog: (str: string) => void }) {
    super(options)
  }

  log(
    options: {
      level: string
      message: string
      module?: string
      timestamp: string
      json: Record<string, unknown>
    },
    next: () => void,
  ) {
    let log = ''
    if (options.timestamp) {
      log += options.timestamp
      if (options.module) {
        log += ` [${options.module}]`
      }
      if (options.level) {
        log += ` ${options.level === 'silly' ? 'trace' : options.level}`
      }
      if (options.message) {
        log += ` ${options.message}`
      }
      if (options.json && Object.keys(options.json).length > 0) {
        log += '\n' + JSON.stringify(options.json, null, 2)
      }
    } else {
      if (options.message) {
        log += options.message
      }
    }
    this.options.customLog(log)
    next()
  }
}

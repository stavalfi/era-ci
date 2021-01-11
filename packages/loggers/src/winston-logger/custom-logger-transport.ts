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
        log += ` ${options.level}`
      }
      if (options.message) {
        log += ` ${options.message}`
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

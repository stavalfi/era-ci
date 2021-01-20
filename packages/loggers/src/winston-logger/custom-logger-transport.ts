import winston from 'winston'
import Transport from 'winston-transport'

export class CustomLogTransport extends Transport {
  constructor(
    private readonly options: Transport.TransportStreamOptions & {
      customLog: (str: string) => void
      customFormat?: (logOptions: winston.Logform.TransformableInfo) => string
    },
  ) {
    super(options)
  }

  log(logOptions: winston.Logform.TransformableInfo, next: () => void) {
    const log = this.options.customFormat ? this.options.customFormat(logOptions) : logOptions.message
    this.options.customLog(log)
    next()
  }
}

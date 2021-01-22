import winston from 'winston'
import Transport from 'winston-transport'

export class CustomLogTransport extends Transport {
  constructor(
    private readonly options: Transport.TransportStreamOptions & {
      customLog: {
        customLog: (...values: unknown[]) => void
        transformer: (log: string) => string
      }
      customFormat?: (logOptions: winston.Logform.TransformableInfo) => string
    },
  ) {
    super(options)
  }

  log(logOptions: winston.Logform.TransformableInfo, next: () => void) {
    const log = this.options.customFormat ? this.options.customFormat(logOptions) : logOptions.message
    // this.options.customLog.customLog(this.options.customLog.transformer(log))

    // uncomment when you want to see live logs in tests:
    // eslint-disable-next-line no-console
    console.log(this.options.customLog.transformer(log))

    next()
  }
}

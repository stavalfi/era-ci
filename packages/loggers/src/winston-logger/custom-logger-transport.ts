import Transport from 'winston-transport'

export class CustomLogTransport extends Transport {
  constructor(private readonly options: Transport.TransportStreamOptions & { customLog: (str: string) => void }) {
    super(options)
  }

  log(info: string, next: () => void) {
    this.options.customLog(info)
    next()
  }
}

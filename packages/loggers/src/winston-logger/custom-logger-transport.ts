import Transport from 'winston-transport'
import { formatLog } from './formatter'

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
    const log = formatLog(options)
    this.options.customLog(log)
    next()
  }
}

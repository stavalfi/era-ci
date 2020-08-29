import { Transform, TransformCallback } from 'stream'
import { LogLevel } from './types'

class LogTransform extends Transform {
  constructor(private readonly level: LogLevel) {
    super({
      readableObjectMode: true,
      writableObjectMode: true,
    })
  }

  _transform(chunk: { toString: () => string }, _encoding: BufferEncoding, callback: TransformCallback) {
    const asString = chunk.toString()
    const final = asString.endsWith('\n') ? asString.substr(0, asString.lastIndexOf('\n')) : asString

    this.push({
      level: this.level,
      message: final,
    })

    callback()
  }
}

export const transforms: {
  [logLevel in LogLevel]: LogTransform
} = {
  [LogLevel.error]: new LogTransform(LogLevel.error),
  [LogLevel.info]: new LogTransform(LogLevel.info),
  [LogLevel.verbose]: new LogTransform(LogLevel.verbose),
}

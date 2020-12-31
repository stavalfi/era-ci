import { config, Lambda } from 'aws-sdk'
import { Buffer } from 'buffer'

const { stringify } = JSON

const lambda = new Lambda({
  apiVersion: '2015-03-31',
  endpoint: 'http://localhost:3001',
})

lambda
  .invoke({
    ClientContext: Buffer.from(stringify({ foo: 'foo' })).toString('base64'),
    FunctionName: 'HelloWorldApi',
    InvocationType: 'RequestResponse',
    Payload: stringify({ bar: 'bar' }),
  })
  .promise()

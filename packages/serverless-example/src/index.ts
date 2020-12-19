import { Handler } from 'aws-lambda'
import { config, Lambda } from 'aws-sdk'
import { Buffer } from 'buffer'

const { stringify } = JSON

config.update({
  accessKeyId: 'ABC',
  secretAccessKey: 'SECRET',
})

const lambda = new Lambda({
  apiVersion: '2015-03-31',
  endpoint: 'http://localhost:3002',
})

export const hello = async (): Promise<{
  body: string
  statusCode: number
}> => {
  const response = await lambda
    .invoke({
      ClientContext: Buffer.from(stringify({ foo: 'foo' })).toString('base64'),
      FunctionName: 'lambda-invoke-dev-toBeInvoked',
      InvocationType: 'RequestResponse',
      Payload: stringify({ bar: 'bar' }),
    })
    .promise()

  return {
    body: stringify(response),
    statusCode: 200,
  }
}

export const toBeInvoked: Handler<unknown> = async (event, context) => {
  return {
    clientContext: context.clientContext,
    event,
  }
}

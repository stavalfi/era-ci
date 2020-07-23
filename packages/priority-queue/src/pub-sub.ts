/* eslint-disable no-console */
import IORedis from 'ioredis'

async function main() {
  const topic = 'channel-4'

  const pub: IORedis.Redis = new IORedis({ host: 'localhost', port: 6379 })
  await pub.publish(topic, 'message1')
  await pub.publish(topic, 'message2')
  await pub.publish(topic, 'message3')

  const sub1: IORedis.Redis = new IORedis({ host: 'localhost', port: 6379 })
  await sub1.subscribe(topic)
  sub1.on('message', function(channel, message) {
    console.log('sub1', channel, message)
  })

  // const sub2: IORedis.Redis = new IORedis({ host: 'localhost', port: 6379 })
  // await sub2.subscribe(topic)
  // sub2.on('message', function(channel, message) {
  //   console.log('sub2', channel, message)
  // })
}

// eslint-disable-next-line no-floating-promise/no-floating-promise
main()

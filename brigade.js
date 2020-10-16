/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-console */

const { events, Job } = require('brigadier')

events.on('exec', () => {
  var job = new Job('do-nothing', 'node:12')
  job.tasks = [`node -e "setTimeout(()=>console.log('exec'),100)"`]

  job.run()
})

events.on('simpleevent', e => {
  // handler for a SimpleEvent
  var job = new Job('jobsimpleevent', 'node:12')
  job.tasks = [`node -e "setTimeout(()=>console.log('simpleevent'),100)"`]
  job.env = {
    EVENT_TYPE: e.type,
  }
  job.run().then(() => {
    console.log('simpleevent is finished!')
  })
})

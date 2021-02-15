import { config } from './packages/task-worker/dist/src/index'

const {
  GITHUB_RUN_NUMBER = 'local-run',
  REDIS_ENDPOINT = 'redis://localhost:36379',
  REDIS_PASSWORD,
  // eslint-disable-next-line no-process-env
} = process.env

export default config({
  queueName: `queue-${GITHUB_RUN_NUMBER}`,
  maxWaitMsWithoutTasks: 180_000,
  maxWaitMsUntilFirstTask: 180_000,
  redis: {
    url: REDIS_ENDPOINT!,
    auth: {
      password: REDIS_PASSWORD,
    },
  },
})

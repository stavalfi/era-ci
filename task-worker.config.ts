import { config } from './packages/task-worker/dist/src/index'

const {
  GITHUB_RUN_NUMBER,
  REDIS_ENDPOINT,
  REDIS_PASSWORD,
  // eslint-disable-next-line no-process-env
} = process.env

export default config({
  queueName: `queue-${GITHUB_RUN_NUMBER}`,
  waitBeforeExitMs: 30_000,
  redis: {
    url: REDIS_ENDPOINT!,
    auth: {
      password: REDIS_PASSWORD,
    },
  },
})

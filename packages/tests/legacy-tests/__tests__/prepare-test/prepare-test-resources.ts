import { TestInterface } from 'ava'
import { starGittServer } from './git-server-testkit'
import { TestResources } from './types'

export function prepareTestResources(test: TestInterface<{ resources: TestResources }>): void {
  test.beforeEach(async t => {
    getResources() = {
      gitServer: await starGittServer(),
      dockerRegistry: `http://localhost:35000`,
      npmRegistry: {
        address: `http://localhost:34873`,
        auth: {
          username: 'root',
          token: 'root',
          email: 'root@root.root',
        },
      },
      redisServer: `redis://localhost:36379`,
    }
  })
  test.afterEach(async t => {
    await getResources().gitServer.close()
  })
}

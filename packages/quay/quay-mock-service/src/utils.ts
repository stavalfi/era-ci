import { Db, QuayNotificationEvents } from './types'
import got from 'got'

export async function notify({
  db,
  repoName,
  buildId,
  event,
}: {
  db: Db
  buildId: string
  repoName: string
  event: QuayNotificationEvents
}): Promise<void> {
  for (const namespace of Object.values(db.namespaces)) {
    const repo = namespace.repos[repoName]
    if (repo) {
      for (const notification of Object.values(repo.notifications)) {
        if (notification.event === event) {
          switch (notification.method) {
            case 'webhook':
              await got.post(notification.webhookAddress, {
                json: {
                  build_id: buildId,
                },
              })
          }
        }
      }
    }
  }
}

/* eslint-disable no-console */
import got from 'got'

async function main() {
  // xBv3mxlsbWp97jbPlz5zK0BWwOpL4Hzqpza1pOpG

  //   const result = await got.post(`https://quay.io/api/v1/repository`, {
  //     headers: {
  //       Authorization: `Bearer jNKLtaA3UpPteMN3DJtzcmvBu73AjzwmiMyBMxnr`,
  //     },
  //     resolveBodyOnly: true,
  //     responseType: 'json',
  //     json: {
  //       repo_kind: 'image',
  //       namespace: 'stavalfi',
  //       visibility: 'public',
  //       repository: 'build-poc3',
  //       description: 'lala',
  //     },
  //   })
  const result = await got.post(`https://quay.io/api/v1/repository/stavalfi/build-poc3/build/`, {
    headers: {
      Authorization: `Bearer jNKLtaA3UpPteMN3DJtzcmvBu73AjzwmiMyBMxnr`,
    },
    resolveBodyOnly: true,
    responseType: 'json',
    json: {
      // subdirectory: '/packages/dockerhub-build-poc',
      archive_url: 'https://github.com/stavalfi/nc/archive/76c4b59ff7e75d35abc0b283972cf6319e384191.tar.gz',
      docker_tags: ['1.0.0'],
      // context: 'string',
      dockerfile_path: '/packages/dockerhub-build-poc/Dockerfile',
    },
  })
  console.log(JSON.stringify(result, null, 2))
}

main()

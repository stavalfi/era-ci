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
      subdirectory: '/nc-3817dd03f9bb034c8ecdb72663dd490ae7f98792/packages/dockerhub-build-poc',
      archive_url: 'https://github.com/stavalfi/nc/archive/3817dd03f9bb034c8ecdb72663dd490ae7f98792.tar.gz',
      docker_tags: ['1.0.0'],
      // context: 'string',
      // dockerfile_path: 'nc-3817dd03f9bb034c8ecdb72663dd490ae7f98792/packages/dockerhub-build-poc/Dockerfile',
    },
  })
  console.log(JSON.stringify(result, null, 2))
}

main()

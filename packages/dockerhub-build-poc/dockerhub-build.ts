/* eslint-disable no-console */
// @ts-ignore
import dockerHubAPI from 'docker-hub-api'

async function main() {
  await dockerHubAPI.login('stavalfi', 'stavalfi635383')
  //   const result1 = await dockerHubAPI.tags('octopol', 'dancer-history')
  //   const result2 = await dockerHubAPI.createRepository('stavalfi', 'dockerhub-build-poc', {
  //     is_private: false,
  //     description: 'lalalaal',
  //     full_description: 'lalaal lalala',
  //   })
  const result3 = await dockerHubAPI.createAutomatedBuild('stavalfi', 'dockerhub-build-poc', {
    dockerhub_repo_name: 'dockerhub-build-poc',
    vcs_repo_name: 'stavalfi/nc',
    provider: 'github',
    build_tags: [
      {
        name: '1.0.0',
        source_type: 'Branch',
        source_name: 'master',
        dockerfile_location: '/',
      },
    ],
  })
  console.log(JSON.stringify(result3, null, 2))
}

main()

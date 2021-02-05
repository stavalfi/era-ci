Example:

```
yarn add --dev -W @era-ci/quick-start

# setup local redis, local docker-registy and verdaccio (local npm-registry)
docker-compose -f ./node_modules/@era-ci/quick-start/era-ci-mock-docker-compose.yml up -d

yarn era-ci-mocks --redis-url localhost:36379 --quay-helper-service-port 9000 --quay-mock-service-port 9001 --docker-registry-url localhost:35000 --docker-fake-org org1 --docker-fake-token token1
```

configure your `era.config.ts` to point to these endpoints and enjoy :)

p.s the docker-compose also setup npm-registry (verdaccio):

```
npm-username: username
npm-password: password
email: any@email.com
```

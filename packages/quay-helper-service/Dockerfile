FROM node:15

WORKDIR /usr/git-tar-gz-proxy

COPY yarn.lock package.json remove-all-dev-deps-from-all-package-jsons.js ./

ARG package_path=packages/quay-helper-service
ARG task_queue_package_path=packages/task-queues

COPY ${package_path}/package.json ./${package_path}/package.json

RUN node remove-all-dev-deps-from-all-package-jsons.js && rm remove-all-dev-deps-from-all-package-jsons.js
RUN yarn install --frozen-lockfile --production

COPY ${package_path}/dist/src ./${package_path}/dist/src
COPY ${package_path}/src ./${package_path}/src

CMD node --unhandled-rejections=strict ./packages/quay/quay-helper-service/dist/src/index.js
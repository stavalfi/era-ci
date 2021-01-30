FROM node:15.7.0-alpine3.10

WORKDIR /usr/service

COPY yarn.lock package.json dist/monorepo-docker-build-helper.js tsconfig.json tsconfig-build.json ./

ARG package_path=packages/quay-helper-service

COPY ${package_path}/package.json ./${package_path}/package.json
COPY ${package_path}/tsconfig-build.json ./${package_path}/tsconfig-build.json

RUN node dist/monorepo-docker-build-helper.js remove-irrelevant-packages \
    --keep-package-and-its-deps @era-ci/quay-helper-service \
    --remove-all-dev-deps-except typescript ts-node
RUN yarn install

RUN yarn build
COPY ${package_path}/dist/src ./${package_path}/dist/src
COPY ${package_path}/src ./${package_path}/src

CMD node --unhandled-rejections=strict ./packages/quay-helper-service/dist/src/index.js
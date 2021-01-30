FROM node:15.7.0-alpine3.10

WORKDIR /usr/service

COPY yarn.lock package.json tsconfig.json tsconfig-build.json ./
COPY dist/monorepo-docker-build-helper.js ./monorepo-docker-build-helper.js

ARG package_path=packages/quay-helper-service

COPY ${package_path}/package.json ./${package_path}/package.json
COPY ${package_path}/tsconfig-build.json ./${package_path}/tsconfig-build.json

RUN node monorepo-docker-build-helper.js remove-irrelevant-packages \
    --keep-package-and-its-deps @era-ci/quay-helper-service \
    --remove-all-dev-deps-except typescript ts-node
RUN yarn install

COPY ${package_path}/src ./${package_path}/src
RUN yarn build

CMD node --unhandled-rejections=strict ./packages/quay-helper-service/dist/src/index.js
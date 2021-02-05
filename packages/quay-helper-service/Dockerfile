FROM quay.io/eraci/node:15.7.0-alpine3.10

WORKDIR /usr/service

COPY yarn.lock package.json tsconfig.json tsconfig-build.json monorepo-docker-build-helper.ts ./

ARG package_path=packages/quay-helper-service
ARG quay_client_path=packages/quay-client
ARG utils_path=packages/utils

COPY ${package_path}/package.json ./${package_path}/package.json
COPY ${package_path}/tsconfig-build.json ./${package_path}/tsconfig-build.json

COPY ${quay_client_path}/package.json ./${quay_client_path}/package.json
COPY ${quay_client_path}/tsconfig-build.json ./${quay_client_path}/tsconfig-build.json

COPY ${utils_path}/package.json ./${utils_path}/package.json
COPY ${utils_path}/tsconfig-build.json ./${utils_path}/tsconfig-build.json

RUN npx ts-node monorepo-docker-build-helper.ts remove-irrelevant-packages \
    --keep-package-and-its-deps @era-ci/quay-helper-service \
    --remove-all-dev-deps-except typescript ts-node @types/*
RUN yarn install

COPY ${package_path}/src ./${package_path}/src
COPY ${quay_client_path}/src ./${quay_client_path}/src
COPY ${utils_path}/src ./${utils_path}/src
RUN yarn build

CMD node --unhandled-rejections=strict ./packages/quay-helper-service/dist/src/index.js
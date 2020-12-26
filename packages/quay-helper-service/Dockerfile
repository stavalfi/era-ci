FROM node:15

WORKDIR /usr/git-tar-gz-proxy

COPY yarn.lock package.json remove-all-dev-deps-from-all-package-jsons.js change-version.js ./

ARG package_path=packages/quay-helper-service

COPY ${package_path}/package.json ./${package_path}/package.json

RUN node remove-all-dev-deps-from-all-package-jsons.js && rm remove-all-dev-deps-from-all-package-jsons.js
RUN echo hi
# RUN yarn install --frozen-lockfile --production

# COPY ${package_path}/dist/src ./${package_path}/dist/src
# COPY ${package_path}/src ./${package_path}/src

# # change the version to the new version
# ARG new_version
# RUN node change-version.js ${package_path} ${new_version} \
# && rm change-version.js \
# && yarn install --frozen-lockfile --production

# CMD node --unhandled-rejections=strict ./packages/quay/quay-helper-service/dist/src/index.js

COPY .git ./

ENV GIT_REVISION=$(git rev-parse HEAD)
LABEL git_version1=$GIT_REVISION
# unset GIT_REVISION:
ENV GIT_REVISION=
FROM quay.io/eraci/node:15.7.0-alpine3.10

WORKDIR /usr/service

COPY yarn.lock package.json tsconfig.json tsconfig-build.json declarations.d.ts ./

ARG package_path=packages/quay-helper-service
ARG quay_client_path=packages/quay-client
ARG utils_path=packages/utils

COPY ${package_path}/package.json ./${package_path}/package.json
COPY ${package_path}/tsconfig-build.json ./${package_path}/tsconfig-build.json

COPY ${quay_client_path}/package.json ./${quay_client_path}/package.json
COPY ${quay_client_path}/tsconfig-build.json ./${quay_client_path}/tsconfig-build.json

COPY ${utils_path}/package.json ./${utils_path}/package.json
COPY ${utils_path}/tsconfig-build.json ./${utils_path}/tsconfig-build.json

# NOTE: this line will install @era-ci/monorepo-helper-cli from the last build (we can "fix" it by 
# building image-step after quay-step, but it will make the build longer in 1-2 minutes)
RUN npx @era-ci/monorepo-helper-cli remove-all-dev-deps-not-related-to --repo-path /usr/service @era-ci/quay-helper-service\
        --except-deps typescript,@types/* && \
    # ignore husky auto-install 
    yarn install --ignore-scripts

COPY ${package_path}/src ./${package_path}/src
COPY ${quay_client_path}/src ./${quay_client_path}/src
COPY ${utils_path}/src ./${utils_path}/src

RUN yarn build

CMD yarn workspace @era-ci/quay-helper-service start:prod
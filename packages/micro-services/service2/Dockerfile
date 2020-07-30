FROM node

WORKDIR /usr/gcloud-example

COPY yarn.lock package.json ./
COPY packages/micro-services/service2/package.json ./packages/micro-services/service2/package.json

RUN yarn install --frozen-lockfile --production

COPY packages/micro-services/service2/dist/src ./packages/micro-services/service2/dist/src

EXPOSE 80

CMD ["node", "--unhandled-rejections=strict", "--trace-deprecation","packages/micro-services/service2/dist/src/index.js"] 
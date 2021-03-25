# era-ci (Node CI)

EraCI is an agnostic and plugin-based CI/CD executable to utilize resources on any given CI provider.

`master` branch refers to v2. (links to: [v1](https://github.com/stavalfi/era-ci/tree/1.2.97) and [v1 Docs](https://github.com/stavalfi/era-ci/blob/1fc1bded8bec090f03afd6200f78ff72e2ad940c/README.md))

---

## The Problem

Extermily slow CI/CD build times.

Slow = 2m to 2h. Depends on the usecase.

## The Solution

EraCI is a tool which tries to solve (also for monorepos) runtime decisions at runtime. For example: Building only packages which weren't built before, testing only packages which changed since the last CI/CD run (We will call it last-`flow`), linting, publihing to npm, dockerhub, quay, deploying to k8s and much more.

There is so much to do and each of you has a unique usecase. It's impossible to cover it all under one roof. That's why EraCI architecture is based on plugins. Almost everything is a plugin.

Our Motivation is to create the first CI/CD framework which is fully extensible, plugin based and absolutly no CI/CD provider locking.

Our first goal is to provide an e2e solution for NodeJS and Javascript Monorepos.

---

## How It Works

For a quick-start, go here: \_\_\_\_

Each project has a `era-ci.config.ts` configuration file (Yes, in typescript!).

It consist of 4 parts:

1. steps - An array of all your steps and what are the relations between them. Each step is an external plugin to install, build, test, publish, deploy your code from anywhere to anywhere you want.
2. taskQueues - Some steps require an internal queue to run tasks. For example, running tests on multiple VMs or publish docker-images over Quay.io VMs.
3. logger - The logger you want to use. Any operation will be logged. Everything is visible for debugging and analyzing under deffierent log levels.
4. redis - The core state DB for remembring which operation we already did on any package/artifact(s).

## Steps

[@era-ci/steps]() - As a begginer consumer of EraCI, this is the package you will be interested to read it's documentation.

- [`install-root`]()
- [`build-root`]()
- [`test`]()
- [`lint-root`]()
- [`npm-publish`]()
- [`docker-publish`]()
- [`quay-docker-publish`]()
- [`k8s-deployment`]()
- [`json-reporter`]()
- [`cli-table-reporter`]()

- For convention, any npm-package which is an era-ci step, should be called `<name>-era-ci-step` or `@<org>/<name>-era-ci-step`

[@era-ci/core]() - This is the core engine of EraCI to run everything.

[@era-ci/loggers]() - This is the core engine of EraCI to run everything.

- [`winston-logger`]()

- For convention, any npm-package which is an era-ci logger, should be called `<name>-era-ci-logger` or `@<org>/<name>-era-ci-logger`

[@era-ci/constrains]() - When developing new steps, constrains helps you to save time to determine in runtime, when to not run your step.

- [`skip-as-failed-if-artifact-step-result-failed-in-cache-constrain`]()
- [`skip-as-failed-if-step-result-failed-in-cache-constrain`]()
- [`skip-as-passed-if-artifact-not-deployable-constain`]()
- [`skip-as-passed-if-artifact-package-json-missing-script-constrain`]()
- [`skip-as-passed-if-artifact-step-result-passed-in-cache-constrain`]()
- [`skip-as-passed-if-artifact-target-type-not-supported-constain`]()
- [`skip-as-passed-if-root-package-json-missing-script-constrain`]()
- [`skip-as-passed-if-step-is-disabled-constrain`]()
- [`skip-as-passed-if-step-result-passed-in-cache-constrain`]()

- For convention, any npm-package which is an era-ci logger, should be called `<name>-era-ci-constrains` or `@<org>/<name>-era-ci-constrains`

[@era-ci/task-queues]() - queues which steps uses internally.

- [`local-sequental-task-queue`]() - in-memory, non-persistent, sequental queue
- [`quay-builds-task-queue`]()
- [`task-worker-task-queue`]()

- For convention, any npm-package which is an era-ci task-queue, should be called `<name>-era-ci-task-queue` or `@<org>/<name>-era-ci-task-queue`

[@era-ci/steps-graph]() - transforms era-ci consumer's steps configuration to what `@era-ci/core` expects.

- [`create-linear-steps-graph`]()
- [`create-tree-steps-graph`]()

- For convention, any npm-package which is an era-ci task-queue, should be called `<name>-era-ci-steps-graph` or `@<org>/<name>-era-ci-steps-graph`

---

---

---

---

# Legacy Docs (TODO: Change/Remove)

### What We Do Best

We only run on packages which changed directly or indirectly.

In the following graph, package `a` depends on `b` and `c`.

```
   b
  /
 a
  \
   c
```

if `b` or `c` changes, the CI will run on the changed package(s) and also on `a`. If `a` changes, the CI will only run on `a`.

### Install

```
yarn add --dev -W @era-ci/core
```

#### Required Executables

2. `yarn` - NC currently only support monorepos that uses yarn. Lock file is highly recommended for installation times and deterministic NC-builds.

### How To Use

1. Create a `era-ci.config.ts` file as a root file.
   - Look at an example of this monorepo for how to write the configurations.
2. Create a `test` script in every package.
3. Run NC locally: `node --unhandled-rejections=strict node_modules/@era-ci/core/dist/src/index.js --config-file ./era-ci.config.ts`

#### Use In Managed CI Systems

(Bitbucket pipelines, Github actions, Azure pipeline, ...)

1. manually install the required executables that NC needs in the `PATH`.
2. wrtie a `yarn install` step in your CI configuration.
3. Run NC.

Optionally, you can skip the publish/deploy steps when you are in PR using `is-ci` package. look at the example in this repository.

---

# Manual

### Terminolegy

> **Definition 1.1.** A **_target_** is an output of a package after a ci-build ends. For example: docker-image in docker-registry, npm-package (the dist folder that NC upload to npm-registry) in npm-registry and so on...

- Docker package - it's a target because NC push the image to docker-registry.

- Private npm package - it's **not** a target because NC can't publish it to npm-registry.

- Public (or scoped-restricted) npm package - it's a target because NC publish the dist (or src) folder to npm registry

- NC report - NC produce a JSON NC report that NC convert it to a ASCII-Table to the user who activated the build, but NC also upload the JSON report to the redis to be used later.

##### Determine Package Target Type (by this order)

- Docker package - the package contains a `Dockerfile` file.

- Public (or scoped-restricted) npm package - in the package.json of a package, if `"private": false`, it means that this package is public. if the name contains a scope (`@company/<package-name>`), you can configure NC to make the access level of the package to restricted under your organization account in npm registry.

> **Definition 1.2.** An **_artifact_** is a package that has 0 or more targets.

> **Definition 1.3.** **_Root files_** are all the files that are not inside any package and git trackes on them. For example, lock-file, root package.json, and so on...

> **Definition 1.4.** A **_change_** in a package or in the root files means a change (modify a line/file/..) on tracked git files.

### Steps

1. Install - NC will run `yarn install` at the root of your repository. (it is pointless because NC executable will be available only after you run `yarn install` by your self but maybe in the future we will do something different.)

2. build - NC will run `yarn build` (if it exists) at the root of your repository. If you are using typescript/flow/babel, then this step is for you.

3. test - NC will run `yarn test` (if it exists) on each changed package at the root folder of each package. the results will be saved ibn redis for future builds.

- if one of the tests-scripts failed (exist code !== 0), the CI will keep running all the steps (and all the test-scripts of all the other packages) but the final result of the CI will be a build-failure. Why? to give you a complete overview of all the things that went wrong. At the next build, if the package didn't change, NC will skip the test-script. it means that NC does not support flaky-tests (tests that may pass or fail even if the package did not change). if you want to re-run the tests again, change something manually in the package (it's enough to add a random letter to the README).

- same thing if the tests passed, publish failed and passed as well.

4. publish - if the package is:

- public (or scoped-restricted) npm package - NC will run `yarn publish` to the specified registry with a new version.
- docker package - NC will build the Dockerfile and run `docker push` to the specified docker registry.

5. deployment - in `era-ci.config.ts` there is a deployment section for each tagret which is optional. each section has 3 functions:

- `initializeDeploymentClient` - incase you deploy to k8s, it is used to set the context of kubectl to your cluster
- `deploy` - deploy a specific package
- `destroyDeploymentClient` - any cleanup that you which to do

---

1

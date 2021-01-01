# nc (Node CI)

### What We Do Best

This is a CI that runs only on changed-packages. NC only runs on packages that changed directly or indirectly.

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

1. Create a `nc.config.ts` file as a root file.
   - Look at an example of this monorepo for how to write the configurations.
2. Create a `test` script in every package.
3. Run NC locally: `node --unhandled-rejections=strict node_modules/@era-ci/core/dist/src/index.js --config-file ./nc.config.ts`

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

- Docker package - the package contains a `dockerfile` file.

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
- docker package - NC will build the dockerfile and run `docker push` to the specified docker registry.

5. deployment - in `nc.config.ts` there is a deployment section for each tagret which is optional. each section has 3 functions:

- `initializeDeploymentClient` - incase you deploy to k8s, it is used to set the context of kubectl to your cluster
- `deploy` - deploy a specific package
- `destroyDeploymentClient` - any cleanup that you which to do

---

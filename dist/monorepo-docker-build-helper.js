'use strict'
/* eslint-disable @typescript-eslint/no-var-requires */
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
const fs_1 = __importDefault(require('fs'))
const path_1 = __importDefault(require('path'))
const child_process_1 = require('child_process')
var Actions
;(function (Actions) {
  Actions['removeIrrelevantPackages'] = 'remove-irrelevant-packages'
})(Actions || (Actions = {}))
function getGraph(repoPath) {
  const result = child_process_1.execSync(`yarn workspaces --json info`, { cwd: repoPath }).toString()
  return JSON.parse(JSON.parse(result).data)
}
// return all packageJson-names which are direct/recursive dependencies of the given packageJson-name
function findAllRecursiveDepsOfPackage(graph, packageJsonName) {
  const results = [packageJsonName]
  function find(packageJsonName1) {
    var _a
    const packageJson = JSON.parse(
      fs_1.default.readFileSync(path_1.default.join(graph[packageJsonName1].location, 'package.json'), 'utf-8'),
    )
    const allDeps = (_a = packageJson.dependencies) !== null && _a !== void 0 ? _a : {}
    const allDevDepAndDepFromRepo = graph[packageJsonName1]
    for (const depName of Object.keys(allDeps)) {
      if (allDevDepAndDepFromRepo.workspaceDependencies.includes(depName)) {
        if (!results.includes(depName)) {
          results.push(depName)
          find(depName)
        }
      }
    }
  }
  find(packageJsonName)
  return results
}
// remove packages which are devDeps from tsconfig.json/paths section
function updateMainTsconfigFile(repoPath, graph, deps) {
  var _a
  const tsconfigBuildFilePath = path_1.default.join(repoPath, 'tsconfig.json')
  const tsconfigBuild = JSON.parse(fs_1.default.readFileSync(tsconfigBuildFilePath, 'utf-8'))
  tsconfigBuild.compilerOptions.paths = Object.fromEntries(
    Object.entries((_a = tsconfigBuild.compilerOptions.paths) !== null && _a !== void 0 ? _a : {})
      .map(([depName, value]) => {
        if (deps.includes(depName)) {
          return [depName, value]
        } else {
          return []
        }
      })
      .filter(r => r.length > 0),
  )
  fs_1.default.writeFileSync(tsconfigBuildFilePath, JSON.stringify(tsconfigBuild, null, 2))
}
const getPackageJson = packageJsonPath => JSON.parse(fs_1.default.readFileSync(packageJsonPath, 'utf-8'))
// remove packages which are devDeps from tsconfig-build.json
function updatePackageTsconfigBuildFile(graph, packageJsonName, deps) {
  const tsconfigBuildFilePath = path_1.default.join(graph[packageJsonName].location, 'tsconfig-build.json')
  const tsconfigBuild = JSON.parse(fs_1.default.readFileSync(tsconfigBuildFilePath, 'utf-8'))
  const packageJson = getPackageJson(path_1.default.join(graph[packageJsonName].location, 'package.json'))
  const directDeps = deps.filter(dep => {
    var _a
    return (_a = packageJson.dependencies) === null || _a === void 0 ? void 0 : _a[dep]
  })
  tsconfigBuild.references = directDeps.map(dep => ({
    path: path_1.default.relative(
      graph[packageJsonName].location,
      path_1.default.join(graph[dep].location, 'tsconfig-build.json'),
    ),
  }))
  debugger
  fs_1.default.writeFileSync(tsconfigBuildFilePath, JSON.stringify(tsconfigBuild, null, 2), 'utf-8')
}
// remove packages which are devDeps from tsconfig-build.json
function updateMainTsconfigBuildFile(repoPath, graph, deps) {
  const tsconfigBuildFilePath = path_1.default.join(repoPath, 'tsconfig-build.json')
  const tsconfigBuild = JSON.parse(fs_1.default.readFileSync(tsconfigBuildFilePath, 'utf-8'))
  tsconfigBuild.references = deps.map(dep => ({
    path: path_1.default.join(graph[dep].location, 'tsconfig-build.json'),
  }))
  fs_1.default.writeFileSync(tsconfigBuildFilePath, JSON.stringify(tsconfigBuild, null, 2))
}
function updateAllTsconfigBuildFiles(repoPath, graph, packageJsonName) {
  const deps = findAllRecursiveDepsOfPackage(graph, packageJsonName)
  updateMainTsconfigBuildFile(repoPath, graph, deps)
  for (const dep of deps) {
    updatePackageTsconfigBuildFile(graph, dep, findAllRecursiveDepsOfPackage(graph, dep))
  }
}
function keepOnlyNeededPackages(repoPath, graph, packageJsonName) {
  const deps = findAllRecursiveDepsOfPackage(graph, packageJsonName)
  for (const dep of Object.keys(graph)) {
    if (!deps.includes(dep)) {
      child_process_1.execSync(`rm -rf ${graph[dep].location}`, { cwd: repoPath })
    }
  }
}
function deleteDevDepsFromPackageJson(packageJsonPath, expectDevDeps) {
  var _a
  const packageJson = JSON.parse(fs_1.default.readFileSync(packageJsonPath, 'utf-8'))
  packageJson.devDependencies = Object.fromEntries(
    Object.entries((_a = packageJson.devDependencies) !== null && _a !== void 0 ? _a : {})
      .map(([key, value]) => {
        if (expectDevDeps.some(e => e === '@types/*') && key.includes('@types/')) {
          return [key, value]
        }
        if (expectDevDeps.includes(key)) {
          return [key, value]
        }
        return []
      })
      .filter(x => x.length > 0),
  )
  fs_1.default.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf-8')
}
function deleteAllDevDeps(repoPath, graph, packageJsonNameToKeep, expectDevDeps) {
  deleteDevDepsFromPackageJson(path_1.default.join(repoPath, 'package.json'), expectDevDeps)
  const deps = findAllRecursiveDepsOfPackage(graph, packageJsonNameToKeep)
  for (const dep of deps) {
    deleteDevDepsFromPackageJson(path_1.default.join(repoPath, graph[dep].location, 'package.json'), expectDevDeps)
  }
}
async function main(argv) {
  const [action, ...params] = argv
  const repoPath = __dirname
  const graph = getGraph(repoPath)
  switch (action) {
    case Actions.removeIrrelevantPackages: {
      const [param1 = '--keep-package-and-its-deps', packageJsonNameToKeep, param2, ...expectDevDepsNames] = params
      if (param1 !== '--keep-package-and-its-deps') {
        throw new Error(`second param must be "--keep-package-and-its-deps"`)
      }
      if (param2 && param2 !== '--remove-all-dev-deps-except') {
        throw new Error(`forth param must be nothing or "--remove-all-dev-deps-except"`)
      }
      if (!graph[packageJsonNameToKeep]) {
        throw new Error(`packageJsonName: "${packageJsonNameToKeep}" was not found in this monorepo`)
      }
      if (param2 === '--remove-all-dev-deps-except') {
        deleteAllDevDeps(repoPath, graph, packageJsonNameToKeep, expectDevDepsNames)
      }
      updateAllTsconfigBuildFiles(repoPath, graph, packageJsonNameToKeep)
      keepOnlyNeededPackages(repoPath, graph, packageJsonNameToKeep)
      updateMainTsconfigFile(repoPath, graph, findAllRecursiveDepsOfPackage(graph, packageJsonNameToKeep))
      break
    }
    default:
      throw new Error(`Action: "${action}" is not supported`)
  }
}
if (require.main === module) {
  main(process.argv.slice(2))
}
//# sourceMappingURL=monorepo-docker-build-helper.js.map

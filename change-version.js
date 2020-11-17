const fs = require('fs')
const path = require('path')

async function main(argv) {
  const [packagePath, version] = argv

  const packageJsonPath = path.join(__dirname, packagePath, 'package.json')
  const packageJson = {
    ...require(packageJsonPath),
    version,
  }
  await new Promise((res, rej) =>
    fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf-8', error => (error ? rej(error) : res())),
  )
}

if (require.main === module) {
  main(process.argv.slice(2))
}

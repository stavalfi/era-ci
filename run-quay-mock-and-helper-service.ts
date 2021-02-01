import execa from 'execa'

execa.command('yarn run-quay-mock', { cwd: __dirname, stdio: 'inherit' })
execa.command('yarn run-quay-helper-service', { cwd: __dirname, stdio: 'inherit' })

import execa from 'execa'

execa.command('yarn workspace @era-ci/quay-mock-service start:dev', { cwd: __dirname, stdio: 'inherit' })
execa.command('yarn workspace @era-ci/quay-helper-service start:dev', {
  cwd: __dirname,
  stdio: 'inherit',
  env: {
    PORT: '9875',
    REDIS_ADDRESS: 'redis://localhost:36379',
  },
})

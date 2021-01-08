/* eslint-disable no-process-env */

jest.setTimeout((process.env.CI ? 500 : 100) * 1000)
process.env.NC_TEST_MODE = 'true'

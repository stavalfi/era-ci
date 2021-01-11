export default {
  failWithoutAssertions: false,
  extensions: ['ts'],
  require: ['ts-node/register'],
  files: [`__tests__/**/*.spec.ts`],
  timeout: 50 * 1000,
}

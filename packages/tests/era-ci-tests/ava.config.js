export default {
  failWithoutAssertions: false,
  extensions: ['ts'],
  require: ['@swc/register'],
  files: [`__tests__/**/*.spec.ts`],
}

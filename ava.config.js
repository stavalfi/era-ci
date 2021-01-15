export default {
  failWithoutAssertions: false,
  extensions: ['ts'],
  require: ['@swc/register'],
  files: [`packages/**/*.spec.ts`],
}

export default {
  failWithoutAssertions: false,
  extensions: ['ts'],
  require: ['esbuild-register'],
  files: [`__tests__/**/*.spec.ts`],
}

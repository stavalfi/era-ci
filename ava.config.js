export default {
  failWithoutAssertions: false,
  extensions: ['ts'],
  require: ['esbuild-register'],
  files: [`packages/**/*.spec.ts`],
}

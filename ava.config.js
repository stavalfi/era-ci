export default {
  failWithoutAssertions: false,
  extensions: ['ts'],
  require: ['ts-node/register'],
  files: [`packages/**/*.spec.ts`, '*.spec.js'],
}

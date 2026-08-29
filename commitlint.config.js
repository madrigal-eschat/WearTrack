export default {
  extends: ['@commitlint/config-conventional'],
  ignores: [(message) => /\n---\nupdated-dep/.test(message)],
};

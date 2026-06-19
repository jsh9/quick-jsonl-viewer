const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
  files: 'out/test-vscode/**/*.test.js',
  launchArgs: ['--disable-extensions'],
  workspaceFolder: '.'
});

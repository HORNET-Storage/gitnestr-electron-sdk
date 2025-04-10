const GitnestrBridgePromise = import('./dist/index.js').then(m => m.GitnestrBridge);

module.exports = {
  async getGitnestrBridge() {
    return await GitnestrBridgePromise;
  }
};
const { contextBridge, ipcRenderer } = require('electron');

// 暴露API到渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 项目相关
  projects: {
    getRecent: () => ipcRenderer.invoke('get-recent-projects'),
    remove: (projectPath) => ipcRenderer.invoke('remove-recent-project', projectPath),
    selectDirectory: () => ipcRenderer.invoke('select-directory'),
    open: (projectPath) => ipcRenderer.invoke('open-project', projectPath)
  },

  // 设置相关
  settings: {
    get: () => ipcRenderer.invoke('get-settings'),
    save: (settings) => ipcRenderer.invoke('save-settings', settings)
  },

  // Git操作
  git: {
    getBranches: () => ipcRenderer.invoke('git-get-branches'),
    getCurrentBranch: () => ipcRenderer.invoke('git-get-current-branch'),
    getCommits: (branch, limit, skip) => ipcRenderer.invoke('git-get-commits', branch, limit, skip),
    getAllCommits: (branch) => ipcRenderer.invoke('git-get-all-commits', branch),
    getUserConfig: () => ipcRenderer.invoke('git-get-user-config'),
    fetch: () => ipcRenderer.invoke('git-fetch'),
    pull: (branch) => ipcRenderer.invoke('git-pull', branch),
    checkout: (branch) => ipcRenderer.invoke('git-checkout', branch),
    cherryPick: (commitShas) => ipcRenderer.invoke('git-cherry-pick', commitShas),
    push: (branch) => ipcRenderer.invoke('git-push', branch),
    createBranch: (branchName, baseBranch) => ipcRenderer.invoke('git-create-branch', branchName, baseBranch),
    deleteLocalBranch: (branchName, force) => ipcRenderer.invoke('git-delete-local-branch', branchName, force),
    hasUncommittedChanges: () => ipcRenderer.invoke('git-has-uncommitted-changes'),
    checkHasNewCommits: (targetBranch) => ipcRenderer.invoke('git-check-has-new-commits', targetBranch),
    stashCreate: (message) => ipcRenderer.invoke('git-stash-create', message),
    stashPop: () => ipcRenderer.invoke('git-stash-pop'),
    getRemoteUrl: () => ipcRenderer.invoke('git-get-remote-url'),
    commitExists: (branch, commitHash) => ipcRenderer.invoke('git-commit-exists', branch, commitHash),
    checkCommitsInBranch: (branch, commitSubjects) => ipcRenderer.invoke('git-check-commits-in-branch', branch, commitSubjects),
    cherryPickSingle: (sha) => ipcRenderer.invoke('git-cherry-pick-single', sha),
    cherryPickContinue: () => ipcRenderer.invoke('git-cherry-pick-continue'),
    cherryPickAbort: () => ipcRenderer.invoke('git-cherry-pick-abort'),
    detectVersion: (targetBranch, commitMessage) => ipcRenderer.invoke('git-detect-version', targetBranch, commitMessage)
  },

  // GitLab操作
  gitlab: {
    testToken: (serverUrl, token) => ipcRenderer.invoke('gitlab-test-token', serverUrl, token),
    createMergeRequest: (serverUrl, token, projectId, sourceBranch, targetBranch, title, description, removeSourceBranch = true) => 
      ipcRenderer.invoke('gitlab-create-merge-request', serverUrl, token, projectId, sourceBranch, targetBranch, title, description, removeSourceBranch)
  },

  // 系统操作
  system: {
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
    showErrorBox: (title, content) => ipcRenderer.invoke('show-error-box', title, content),
    exportLogZip: () => ipcRenderer.invoke('export-log-zip'),
    openFileInEditor: (filePath) => ipcRenderer.invoke('open-file-in-editor', filePath)
  },

  // 事件监听
  on: (channel, callback) => {
    const validChannels = ['project-opened', 'menu-refresh', 'menu-git-fetch', 'menu-git-pull', 'menu-settings'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },

  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});

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

  // 服务端下发的全局配置（独立于本地设置）
  globalConfig: {
    get: () => ipcRenderer.invoke('get-global-config')
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
    forceSyncBranch: (branch) => ipcRenderer.invoke('git-force-sync-branch', branch),
    checkout: (branch) => ipcRenderer.invoke('git-checkout', branch),
    push: (branch) => ipcRenderer.invoke('git-push', branch),
    createBranch: (branchName, baseBranch) => ipcRenderer.invoke('git-create-branch', branchName, baseBranch),
    deleteLocalBranch: (branchName, force) => ipcRenderer.invoke('git-delete-local-branch', branchName, force),
    deleteRemoteBranch: (branchName) => ipcRenderer.invoke('git-delete-remote-branch', branchName),
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
    amendAuthor: (authorName, authorEmail) => ipcRenderer.invoke('git-amend-author', authorName, authorEmail),
    detectVersion: (targetBranch, commitMessage) => ipcRenderer.invoke('git-detect-version', targetBranch, commitMessage),
    checkBranchNameConflict: (branchName) => ipcRenderer.invoke('git-check-branch-name-conflict', branchName),
    fetchBranch: (branchName) => ipcRenderer.invoke('git-fetch-branch', branchName),
    getConflictFileVersions: (filePaths) => ipcRenderer.invoke('git-get-conflict-file-versions', filePaths),
    writeFileAndStage: (files) => ipcRenderer.invoke('git-write-file-and-stage', files),
    getProjectPath: () => ipcRenderer.invoke('git-get-project-path'),
    // 版本基线替换 / squash 相关
    getHeadSha: () => ipcRenderer.invoke('git-get-head-sha'),
    readPomParentVersion: () => ipcRenderer.invoke('git-read-pom-parent-version'),
    listChangedJavaFiles: (beforePickSha) => ipcRenderer.invoke('git-list-changed-java-files', beforePickSha),
    applyVersionReplacement: (params) => ipcRenderer.invoke('git-apply-version-replacement', params),
    squashIntoParent: (params) => ipcRenderer.invoke('git-squash-into-parent', params),
    checkBehind: (branch) => ipcRenderer.invoke('git-check-behind', branch),
    mergeContinue: () => ipcRenderer.invoke('git-merge-continue'),
    mergeAbort: () => ipcRenderer.invoke('git-merge-abort')
  },

  // GitLab操作
  gitlab: {
    testToken: (serverUrl, token) => ipcRenderer.invoke('gitlab-test-token', serverUrl, token),
    getProjectId: (serverUrl, token, projectPath) => ipcRenderer.invoke('gitlab-get-project-id', serverUrl, token, projectPath),
    createMergeRequest: (serverUrl, token, projectId, sourceBranch, targetBranch, title, description, removeSourceBranch = true) =>
      ipcRenderer.invoke('gitlab-create-merge-request', serverUrl, token, projectId, sourceBranch, targetBranch, title, description, removeSourceBranch)
  },

  // 远程仓库操作（基于当前项目原生 git remote）
  remoteRepos: {
    list: () => ipcRenderer.invoke('remote-repos:list'),
    add: (params) => ipcRenderer.invoke('remote-repos:add', params),
    update: (params) => ipcRenderer.invoke('remote-repos:update', params),
    remove: (params) => ipcRenderer.invoke('remote-repos:remove', params),
    testConnection: (params) => ipcRenderer.invoke('remote-repos:test-connection', params)
  },

  // version.json 维护（入库合并到非 develop 分支时追加 relations 记录）
  versionJson: {
    appendRelation: (params) => ipcRenderer.invoke('version-json:append-relation', params)
  },

  // 系统操作
  system: {
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
    showErrorBox: (title, content) => ipcRenderer.invoke('show-error-box', title, content),
    exportLogZip: () => ipcRenderer.invoke('export-log-zip'),
    openFileInEditor: (filePath) => ipcRenderer.invoke('open-file-in-editor', filePath)
  },

  // 窗口控制
  window: {
    minimize: () => ipcRenderer.invoke('window-minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window-toggle-maximize'),
    close: () => ipcRenderer.invoke('window-close'),
    isMaximized: () => ipcRenderer.invoke('window-is-maximized')
  },

  // 事件监听
  on: (channel, callback) => {
    const validChannels = ['project-opened', 'menu-refresh', 'menu-git-fetch', 'menu-git-pull', 'menu-settings', 'global-config-status'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },

  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});

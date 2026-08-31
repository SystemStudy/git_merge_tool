const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const isDev = require('electron-is-dev');
const path = require('path');
const Store = require('electron-store');
const simpleGit = require('simple-git');
const fs = require('fs');
const fsPromises = require('fs').promises;
const { initLogger, getLogFilePath, closeLogger } = require('./logger');

// IPC handler 模块
const registerGitHandlers = require('./ipc-handlers/ipc-git-operations');
const registerGitVersionHandlers = require('./ipc-handlers/ipc-git-version');
const registerGitLabHandlers = require('./ipc-handlers/ipc-gitlab');
const registerSystemHandlers = require('./ipc-handlers/ipc-system');
const registerRemoteRepoHandlers = require('./ipc-handlers/ipc-remote-repos');
const registerVersionJsonHandlers = require('./ipc-handlers/ipc-version-json');
const registerUpdaterHandlers = require('./ipc-handlers/ipc-updater');
const projectStore = require('./project-store');

initLogger();

// 初始化配置存储
// 注意: recentProjects 已拆分到 git-merge-assistant-projects.json，此处不再声明其
// defaults，避免迁移后被重新写回本文件；projectsRepos 为已废弃字段，同样不再声明
const store = new Store({
  name: 'git-merge-assistant-config',
  defaults: {
    remoteRepos: [],
    settings: {
      testBranches: 'smoke\nstable/sp4/smoke\nstable/sp3/smoke\nstable/sp2/smoke\nstable/sp1/smoke',
      releaseBranches: 'develop\nstable/sp4/develop\nstable/sp3/develop\nstable/sp2/develop\nstable/sp1/develop',
      bugTestBranches: 'smoke\nstable/sp4/bugfix\nstable/sp3/bugfix\nstable/sp2/bugfix\nstable/sp1/bugfix',
      customBranches: '',
      gitlabServerUrl: 'https://git.landray.com.cn/',
      gitlabAccessToken: '',
      businessLine: 'MK',
      defaultPushSourceEnabled: true,
      defaultDeleteSourceEnabled: true,
      authorReplaceEmail: '',        // author 邮箱不合规时的默认替换邮箱
      themeColor: '#4F46E5',
      updateChannel: 'stable',       // 更新通道: stable(正式版) / beta(测试版)
    }
  }
});

// 一次性迁移：清理历史版本遗留的 Claude 配置字段
{
  const legacySettings = store.get('settings') || {};
  const claudeKeys = ['claudeUseLocalConfig', 'claudeModel', 'claudeApiUrl', 'claudeApiKey', 'claudeModelSupports1M'];
  if (claudeKeys.some(k => k in legacySettings)) {
    claudeKeys.forEach(k => delete legacySettings[k]);
    store.set('settings', legacySettings);
  }
}

// 一次性迁移：把 recentProjects 拆分到 git-merge-assistant-projects.json。
// 仅在新配置文件不存在、且旧配置中仍留有 recentProjects 时执行。
{
  const result = projectStore.migrateFromLegacyStore(store);
  if (result.migrated) {
    console.debug(`[migration] 项目配置迁移成功: ${result.projectCount} 个项目`);
  } else {
    console.debug(`[migration] 项目配置无需迁移: ${result.reason}`);
  }
}

let mainWindow = null;
let currentGit = null;
let currentProjectPath = null;
let updateController = null; // 自动更新控制器（ipc-updater 注册后赋值）

function formatTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// 创建主窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    title: 'Git合并辅助',
    icon: path.join(__dirname, 'icon.ico'),
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false,
    center: true
  });

  // 加载应用
  const startUrl = isDev 
    ? 'http://localhost:3000' 
    : `file://${path.join(__dirname, '../build/index.html')}`;
  
  mainWindow.loadURL(startUrl);

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levelMap = { 0: 'LOG', 1: 'WARN', 2: 'ERROR', 3: 'INFO', 4: 'DEBUG' };
    const levelName = levelMap[level] || 'LOG';
    const prefix = `[Renderer] ${sourceId}:${line}`;
    switch (levelName) {
      case 'ERROR':
        console.error(prefix, message);
        break;
      case 'WARN':
        console.debug(prefix, message);
        break;
      default:
        console.debug(prefix, message);
    }
  });
}

// 打开项目
async function openProject(projectPath) {
  const timestamp = formatTimestamp();
  console.debug(`[${timestamp}] [openProject] 开始打开项目: ${projectPath}`);
  
  try {
    // 检查是否为Git仓库
    console.debug(`[${timestamp}] [openProject] 检查是否为Git仓库...`);
    const isGitRepo = await checkGitRepository(projectPath);
    
    if (!isGitRepo) {
      console.error(`[${timestamp}] [openProject] 错误: 选中的目录不是Git仓库`);
      dialog.showErrorBox('错误', '选中的目录不是Git仓库');
      return { success: false, error: '不是Git仓库' };
    }

    // 初始化Git
    console.debug(`[${timestamp}] [openProject] 初始化Git仓库...`);
    currentGit = simpleGit(projectPath, {
      config: [],
      timeout: {
        block: 60000,
      },
      spawnOptions: {
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: '',
        }
      }
    });
    currentProjectPath = projectPath;

    // 获取项目信息
    console.debug(`[${timestamp}] [openProject] 获取项目信息...`);
    const projectInfo = await getProjectInfo(projectPath);
    console.debug(`[${timestamp}] [openProject] 项目信息:`, JSON.stringify(projectInfo, null, 2));
    
    // 添加到最近项目列表
    console.debug(`[${timestamp}] [openProject] 添加到最近项目列表...`);
    addToRecentProjects(projectPath, projectInfo.name);

    // 通知渲染进程
    console.debug(`[${timestamp}] [openProject] 发送项目打开事件到渲染进程`);
    mainWindow.webContents.send('project-opened', {
      path: projectPath,
      info: projectInfo
    });

    console.debug(`[${timestamp}] [openProject] 项目打开成功`);
    return { success: true, project: projectInfo };
  } catch (error) {
    console.error(`[${timestamp}] [openProject] 打开项目失败:`, error);
    dialog.showErrorBox('错误', `打开项目失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// 检查是否为Git仓库
async function checkGitRepository(dirPath) {
  try {
    const gitDir = path.join(dirPath, '.git');
    await fsPromises.access(gitDir);
    return true;
  } catch {
    let currentDir = path.dirname(dirPath);
    while (currentDir !== path.dirname(currentDir)) {
      try {
        const gitDir = path.join(currentDir, '.git');
        await fsPromises.access(gitDir);
        return true;
      } catch {
        currentDir = path.dirname(currentDir);
      }
    }
    return false;
  }
}

// 获取项目信息
async function getProjectInfo(projectPath) {
  const git = simpleGit(projectPath, {
    config: [],
    timeout: {
      block: 60000,
    },
    spawnOptions: {
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '',
      }
    }
  });
  const remotes = await git.getRemotes(true);
  const branchSummary = await git.branchLocal();
  
  return {
    name: path.basename(projectPath),
    path: projectPath,
    currentBranch: branchSummary.current,
    branches: branchSummary.all,
    remotes: remotes
  };
}

// 添加到最近项目列表（存储在独立的 git-merge-assistant-projects.json 中）
function addToRecentProjects(projectPath, projectName) {
  projectStore.addRecentProject(projectPath, projectName);
}

// IPC通信处理（薄层：委托给各模块注册函数）
function setupIpcHandlers() {
  // 共享依赖上下文
  const getGit = () => currentGit;
  const getProjectPath = () => currentProjectPath;

  // 注册各模块 IPC handlers
  registerGitHandlers(ipcMain, { getGit, getProjectPath });
  registerGitVersionHandlers(ipcMain, { getGit, getProjectPath });
  registerGitLabHandlers(ipcMain, { getGit, getProjectPath });
  registerSystemHandlers(ipcMain, {
    mainWindow,
    store,
    projectStore,
    getProjectPath,
    getLogFilePath,
    openProject
  });
  registerRemoteRepoHandlers(ipcMain, { getGit });
  registerVersionJsonHandlers(ipcMain, { getGit, getProjectPath });
  updateController = registerUpdaterHandlers(ipcMain, {
    getWindow: () => mainWindow,
    store
  });
}

// 应用生命周期
app.whenReady().then(() => {
  createWindow();
  setupIpcHandlers();

  // 启动后延迟静默检查更新：网络不可达时静默结束（仅日志），下次启动再检查
  setTimeout(() => {
    if (updateController) {
      updateController.checkForUpdatesSilently();
    }
  }, 8000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  closeLogger();
  app.quit();
  // 如果 3 秒后进程仍未退出（有挂起的异步操作），强制退出
  setTimeout(() => {
    app.exit(0);
  }, 3000);
});

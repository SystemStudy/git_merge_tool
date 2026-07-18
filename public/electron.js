const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const isDev = require('electron-is-dev');
const path = require('path');
const Store = require('electron-store');
const simpleGit = require('simple-git');
const fs = require('fs');
const fsPromises = require('fs').promises;
const axios = require('axios');
const { initLogger, getLogFilePath, closeLogger } = require('./logger');

// IPC handler 模块
const registerGitHandlers = require('./ipc-handlers/ipc-git-operations');
const registerGitVersionHandlers = require('./ipc-handlers/ipc-git-version');
const registerGitLabHandlers = require('./ipc-handlers/ipc-gitlab');
const registerClaudeHandlers = require('./ipc-handlers/ipc-claude');
const registerSystemHandlers = require('./ipc-handlers/ipc-system');

initLogger();

// 初始化配置存储
const store = new Store({
  name: 'git-merge-assistant-config',
  defaults: {
    recentProjects: [],
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
      // Claude AI 配置
      claudeUseLocalConfig: true,     // 是否读取本地 Claude 配置（默认开启）
      claudeModel: '',                // 当前选中的模型（开关ON/OFF都存储）
      claudeApiUrl: '',               // Claude API 地址（仅开关OFF时存储）
      claudeApiKey: '',               // Claude API Key（仅开关OFF时存储）
      claudeModelSupports1M: false   // 当前模型是否声明支持 1M 上下文
    }
  }
});

// 全局配置存储（与服务端下发配置对应，与应用本地设置 store 区分开）
// 文件名: git-merge-assistant-global-config.json，独立于 git-merge-assistant-config.json
const globalConfigStore = new Store({
  name: 'git-merge-assistant-global-config',
  defaults: {
    config: null,        // 服务端下发的全局配置内容
    lastUpdated: null    // 最近一次成功更新时间（ISO 字符串）
  }
});

// 全局配置获取状态（暂存，便于在渲染进程加载完成后补发）
// fetched: 是否已完成本次启动的请求；success: 是否成功
let globalConfigStatus = { fetched: false, success: false, error: null };

// 服务端全局配置地址
const GLOBAL_CONFIG_URL = 'https://mkenv.ywork.me/mkenv/git_merge_global_config.json';

/**
 * 启动时拉取服务端全局配置并写入独立的 globalConfigStore。
 * 成功：写入文件；失败：记录状态。结果通过 notifyGlobalConfigStatus 推送给渲染进程。
 */
async function fetchGlobalConfig() {
  const timestamp = formatTimestamp();
  console.log(`[${timestamp}] [fetchGlobalConfig] 开始拉取服务端全局配置: ${GLOBAL_CONFIG_URL}`);
  try {
    const response = await axios.get(GLOBAL_CONFIG_URL, { timeout: 10000 });
    // 服务端 Content-Type 不一定是 application/json，axios 可能不自动解析。
    // 这里做一层通用归一化：字符串则尝试 JSON.parse，失败则原样存储。
    let configData = response.data;
    if (typeof configData === 'string' && configData.trim()) {
      try {
        configData = JSON.parse(configData);
      } catch {
        // 非 JSON 字符串，保持原字符串存储
      }
    }
    globalConfigStore.set('config', configData);
    globalConfigStore.set('lastUpdated', new Date().toISOString());
    globalConfigStatus = { fetched: true, success: true, error: null };
    console.log(`[${timestamp}] [fetchGlobalConfig] 全局配置拉取成功并已写入`);
  } catch (error) {
    globalConfigStatus = { fetched: true, success: false, error: error.message || String(error) };
    console.warn(`[${timestamp}] [fetchGlobalConfig] 全局配置拉取失败: ${globalConfigStatus.error}`);
  }
  notifyGlobalConfigStatus();
}

// 将全局配置获取状态推送给渲染进程（若窗口已销毁或未加载则跳过）
function notifyGlobalConfigStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('global-config-status', globalConfigStatus);
  }
}

/**
 * 获取当前有效的 Claude 配置（运行时实时解析）
 * 如果开启了读取本地配置，则从环境变量和 ~/.claude/settings.json 实时读取 apiUrl/apiKey
 * 开关 OFF 时从 electron-store 读取
 */
function getClaudeConfig() {
  const settings = store.get('settings');
  const os = require('os');

  let apiUrl = settings.claudeApiUrl || '';
  let apiKey = settings.claudeApiKey || '';
  let model = settings.claudeModel || '';

  if (settings.claudeUseLocalConfig) {
    // 开关 ON：实时读取本地配置
    // 1. 环境变量优先
    if (process.env.ANTHROPIC_AUTH_TOKEN) apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
    if (process.env.ANTHROPIC_BASE_URL) apiUrl = process.env.ANTHROPIC_BASE_URL;
    if (process.env.ANTHROPIC_MODEL && !model) model = process.env.ANTHROPIC_MODEL;

    // 2. ~/.claude/settings.json
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    try {
      if (fs.existsSync(settingsPath)) {
        const local = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        const env = local.env || {};
        if (!apiKey && env.ANTHROPIC_AUTH_TOKEN) apiKey = env.ANTHROPIC_AUTH_TOKEN;
        if (!apiUrl && env.ANTHROPIC_BASE_URL) apiUrl = env.ANTHROPIC_BASE_URL;
      }
    } catch (e) {
      console.log('读取本地 Claude 配置文件失败:', e.message);
    }
  }

  // 1M 上下文通过 anthropic-beta 请求头声明（参考 cc-switch 的 context-1m-2025-08-07），
  // 不再给模型名拼接 [1m] 后缀——上游中转站通常不认本地 [1m] 标记，拼接会导致 503。
  const supports1M = settings.claudeModelSupports1M === true;

  console.log(`[getClaudeConfig] useLocal=${settings.claudeUseLocalConfig}, apiUrl=${apiUrl ? '(已配置)' : '(空)'}, apiKey=${apiKey ? '(已配置)' : '(空)'}, model=${model || '(空)'}, supports1M=${supports1M}`);
  return { apiUrl, apiKey, model, supports1M };
}

let mainWindow = null;
let currentGit = null;
let currentProjectPath = null;

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

  // 页面加载完成后，若全局配置状态已就绪则补发一次，避免请求早于加载导致渲染进程错过通知
  mainWindow.webContents.on('did-finish-loading', () => {
    if (globalConfigStatus.fetched) {
      notifyGlobalConfigStatus();
    }
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
        console.warn(prefix, message);
        break;
      default:
        console.log(prefix, message);
    }
  });
}

// 打开项目
async function openProject(projectPath) {
  const timestamp = formatTimestamp();
  console.log(`[${timestamp}] [openProject] 开始打开项目: ${projectPath}`);
  
  try {
    // 检查是否为Git仓库
    console.log(`[${timestamp}] [openProject] 检查是否为Git仓库...`);
    const isGitRepo = await checkGitRepository(projectPath);
    
    if (!isGitRepo) {
      console.error(`[${timestamp}] [openProject] 错误: 选中的目录不是Git仓库`);
      dialog.showErrorBox('错误', '选中的目录不是Git仓库');
      return { success: false, error: '不是Git仓库' };
    }

    // 初始化Git
    console.log(`[${timestamp}] [openProject] 初始化Git仓库...`);
    currentGit = simpleGit(projectPath);
    currentProjectPath = projectPath;

    // 获取项目信息
    console.log(`[${timestamp}] [openProject] 获取项目信息...`);
    const projectInfo = await getProjectInfo(projectPath);
    console.log(`[${timestamp}] [openProject] 项目信息:`, JSON.stringify(projectInfo, null, 2));
    
    // 添加到最近项目列表
    console.log(`[${timestamp}] [openProject] 添加到最近项目列表...`);
    addToRecentProjects(projectPath, projectInfo.name);

    // 通知渲染进程
    console.log(`[${timestamp}] [openProject] 发送项目打开事件到渲染进程`);
    mainWindow.webContents.send('project-opened', {
      path: projectPath,
      info: projectInfo
    });

    console.log(`[${timestamp}] [openProject] 项目打开成功`);
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
  const git = simpleGit(projectPath);
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

// 添加到最近项目列表
function addToRecentProjects(projectPath, projectName) {
  let recentProjects = store.get('recentProjects') || [];
  
  // 移除已存在的相同路径
  recentProjects = recentProjects.filter(p => p.path !== projectPath);
  
  // 添加到开头
  recentProjects.unshift({
    path: projectPath,
    name: projectName,
    lastOpened: new Date().toISOString()
  });
  
  // 只保留最近10个
  recentProjects = recentProjects.slice(0, 10);
  
  store.set('recentProjects', recentProjects);
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
  registerClaudeHandlers(ipcMain, { getGit, getProjectPath, getClaudeConfig });
  registerSystemHandlers(ipcMain, {
    mainWindow,
    store,
    globalConfigStore,
    globalConfigStatus,
    getProjectPath,
    getLogFilePath,
    openProject
  });
}

// 应用生命周期
app.whenReady().then(() => {
  createWindow();
  setupIpcHandlers();

  // 启动时异步拉取服务端全局配置（不阻塞窗口显示）
  fetchGlobalConfig();

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

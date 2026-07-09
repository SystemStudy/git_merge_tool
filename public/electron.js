const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const isDev = require('electron-is-dev');
const path = require('path');
const Store = require('electron-store');
const simpleGit = require('simple-git');
const fs = require('fs');
const fsPromises = require('fs').promises;
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const archiver = require('archiver');
const { exec } = require('child_process');
const { initLogger, getLogFilePath, closeLogger } = require('./logger');

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

// 选择目录
async function selectDirectory() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择Git项目目录'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const projectPath = result.filePaths[0];
    await openProject(projectPath);
  }
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

// 从最近列表中移除项目
function removeFromRecentProjects(projectPath) {
  let recentProjects = store.get('recentProjects') || [];
  recentProjects = recentProjects.filter(p => p.path !== projectPath);
  store.set('recentProjects', recentProjects);
}

// IPC通信处理
function setupIpcHandlers() {
  // 窗口控制 — 最小化
  ipcMain.handle('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  // 窗口控制 — 最大化/还原
  ipcMain.handle('window-toggle-maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  // 窗口控制 — 关闭
  ipcMain.handle('window-close', () => {
    if (mainWindow) mainWindow.close();
  });

  // 窗口控制 — 查询是否最大化
  ipcMain.handle('window-is-maximized', () => {
    return mainWindow ? mainWindow.isMaximized() : false;
  });

  // 获取最近项目列表
  ipcMain.handle('get-recent-projects', () => {
    return store.get('recentProjects') || [];
  });

  // 删除最近项目记录
  ipcMain.handle('remove-recent-project', (event, projectPath) => {
    removeFromRecentProjects(projectPath);
    return { success: true };
  });

  // 选择目录
  ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: '选择项目目录'
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  // 打开项目
  ipcMain.handle('open-project', async (event, projectPath) => {
    return await openProject(projectPath);
  });

  // 获取设置
  ipcMain.handle('get-settings', () => {
    return store.get('settings') || {};
  });

  // 获取服务端下发的全局配置（独立文件存储，与应用设置区分）
  ipcMain.handle('get-global-config', () => {
    return {
      config: globalConfigStore.get('config'),
      lastUpdated: globalConfigStore.get('lastUpdated'),
      status: globalConfigStatus
    };
  });

  // 保存设置
  ipcMain.handle('save-settings', (event, settings) => {
    store.set('settings', settings);
    return { success: true };
  });

  // Git操作
  ipcMain.handle('git-get-branches', async () => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-get-branches] 开始获取分支列表`);
    
    if (!currentGit) {
      console.error(`[${timestamp}] [git-get-branches] 错误: 未打开项目`);
      throw new Error('未打开项目');
    }
    
    try {
      const branches = await currentGit.branch(['-a']);
      const cleanedBranches = branches.all.map(b => b.replace('remotes/origin/', '')).filter((v, i, a) => a.indexOf(v) === i);
      console.log(`[${timestamp}] [git-get-branches] 获取到 ${cleanedBranches.length} 个分支`);
      console.log(`[${timestamp}] [git-get-branches] 当前分支: ${branches.current}`);
      return cleanedBranches;
    } catch (error) {
      console.error(`[${timestamp}] [git-get-branches] 错误: ${error.message}`);
      throw error;
    }
  });

  ipcMain.handle('git-get-current-branch', async () => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-get-current-branch] 开始获取当前分支`);
    
    if (!currentGit) {
      console.error(`[${timestamp}] [git-get-current-branch] 错误: 未打开项目`);
      throw new Error('未打开项目');
    }
    
    try {
      const status = await currentGit.status();
      console.log(`[${timestamp}] [git-get-current-branch] 当前分支: ${status.current}`);
      return status.current;
    } catch (error) {
      console.error(`[${timestamp}] [git-get-current-branch] 错误: ${error.message}`);
      throw error;
    }
  });

  ipcMain.handle('git-get-user-config', async () => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-get-user-config] 开始获取Git用户配置`);
    
    if (!currentGit) {
      console.error(`[${timestamp}] [git-get-user-config] 错误: 未打开项目`);
      throw new Error('未打开项目');
    }
    
    try {
      const nameResult = await currentGit.getConfig('user.name');
      const emailResult = await currentGit.getConfig('user.email');

      // getConfig 返回的是对象，需要提取 value 属性
      const name = nameResult?.value || '';
      const email = emailResult?.value || '';

      console.log(`[${timestamp}] [git-get-user-config] 用户名: ${name}, 邮箱: ${email}`);

      return {
        name: name,
        email: email
      };
    } catch (error) {
      console.error(`[${timestamp}] [git-get-user-config] 错误: ${error.message}`);
      return { name: '', email: '' };
    }
  });

  ipcMain.handle('git-get-commits', async (event, branch, limit = 50, skip = 0) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-get-commits] 开始获取提交记录`);
    console.log(`[${timestamp}] [git-get-commits] 参数: branch="${branch}", limit=${limit}, skip=${skip}`);
    
    if (!currentGit) {
      const error = new Error('未打开项目');
      console.error(`[${timestamp}] [git-get-commits] 错误: ${error.message}`);
      throw error;
    }
    
    if (!branch) {
      const error = new Error('分支名称不能为空');
      console.error(`[${timestamp}] [git-get-commits] 错误: ${error.message}`);
      throw error;
    }
    
    try {
      console.log(`[${timestamp}] [git-get-commits] 正在执行 git log 命令...`);
      
      // 只使用本地分支名称，排除远程分支
      let branchToUse = branch;
      if (!branch.startsWith('origin/') && !branch.startsWith('refs/')) {
        const localBranches = await currentGit.branchLocal();
        const localBranch = localBranches.all.find(b => b === branch);
        if (localBranch) {
          branchToUse = localBranch;
          console.log(`[${timestamp}] [git-get-commits] 确认为本地分支: ${localBranch}`);
        } else {
          // 不是本地分支，尝试作为远程分支处理（带 origin/ 前缀）
          console.log(`[${timestamp}] [git-get-commits] 未找到本地分支 ${branch}，尝试远程分支 origin/${branch}`);
          branchToUse = `origin/${branch}`;
        }
      } else {
        // 如果是远程分支，提取本地分支名
        const localBranchName = branch.replace(/^origin\//, '').replace(/^refs\/heads\//, '');
        const branches = await currentGit.branchLocal();
        if (branches.all.includes(localBranchName)) {
          branchToUse = localBranchName;
          console.log(`[${timestamp}] [git-get-commits] 转换为本地分支: ${localBranchName}`);
        }
      }
      
      console.log(`[${timestamp}] [git-get-commits] 最终使用分支: "${branchToUse}"`);
      
      let log;
      if (skip > 0) {
        const format = '%H%n%an%n%ad%n%s%n%b%n---END---';
        log = await currentGit.raw([
          'log',
          '-n', String(limit),
          '--no-merges',
          `--format=${format}`,
          '--skip', String(skip),
          branchToUse
        ]);
        
        const commits = log.trim().split('---END---\n').filter(c => c.trim());
        const parsedCommits = commits.map(commitStr => {
          const parts = commitStr.split('\n');
          return {
            hash: parts[0],
            author_name: parts[1],
            date: parts[2],
            message: parts[3],
            body: parts.slice(4).join('\n')
          };
        });
        
        log = { all: parsedCommits };
      } else {
        const format = '%H%n%an%n%ad%n%s%n%b%n---END---';
        log = await currentGit.raw([
          'log',
          '-n', String(limit),
          '--no-merges',
          `--format=${format}`,
          branchToUse
        ]);
        
        const commits = log.trim().split('---END---\n').filter(c => c.trim());
        const parsedCommits = commits.map(commitStr => {
          const parts = commitStr.split('\n');
          return {
            hash: parts[0],
            author_name: parts[1],
            date: parts[2],
            message: parts[3],
            body: parts.slice(4).join('\n')
          };
        });
        
        log = { all: parsedCommits };
      }
      
      console.log(`[${timestamp}] [git-get-commits] 获取到 ${log.all?.length || 0} 条提交记录`);
      
      const filteredCommits = log.all?.filter(commit => {
        return commit.hash && commit.message;
      }) || [];
      
      console.log(`[${timestamp}] [git-get-commits] 过滤后剩余 ${filteredCommits.length} 条提交记录`);
      
      if (filteredCommits.length > 0) {
        console.log(`[${timestamp}] [git-get-commits] 第一条提交:`, JSON.stringify(filteredCommits[0], null, 2));
      }
      
      return filteredCommits;
    } catch (error) {
      console.error(`[${timestamp}] [git-get-commits] 执行失败: ${error.message}`);
      console.error(`[${timestamp}] [git-get-commits] 错误堆栈:`, error.stack);
      throw error;
    }
  });

  ipcMain.handle('git-get-all-commits', async (event, branch) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-get-all-commits] 开始获取全部提交记录`);
    console.log(`[${timestamp}] [git-get-all-commits] 参数: branch="${branch}"`);

    if (!currentGit) {
      const error = new Error('未打开项目');
      console.error(`[${timestamp}] [git-get-all-commits] 错误: ${error.message}`);
      throw error;
    }

    if (!branch) {
      const error = new Error('分支名称不能为空');
      console.error(`[${timestamp}] [git-get-all-commits] 错误: ${error.message}`);
      throw error;
    }

    try {
      let branchToUse = branch;
      if (!branch.startsWith('origin/') && !branch.startsWith('refs/')) {
        const localBranches = await currentGit.branchLocal();
        const localBranch = localBranches.all.find(b => b === branch);
        if (localBranch) {
          branchToUse = localBranch;
          console.log(`[${timestamp}] [git-get-all-commits] 确认为本地分支: ${localBranch}`);
        } else {
          // 不是本地分支，尝试作为远程分支处理
          console.log(`[${timestamp}] [git-get-all-commits] 未找到本地分支 ${branch}，尝试远程分支 origin/${branch}`);
          branchToUse = `origin/${branch}`;
        }
      } else {
        const localBranchName = branch.replace(/^origin\//, '').replace(/^refs\/heads\//, '');
        const localBranches = await currentGit.branchLocal();
        if (localBranches.all.includes(localBranchName)) {
          branchToUse = localBranchName;
          console.log(`[${timestamp}] [git-get-all-commits] 转换为本地分支: ${localBranchName}`);
        }
      }

      console.log(`[${timestamp}] [git-get-all-commits] 使用分支: "${branchToUse}"`);

      const format = '%H%n%an%n%ad%n%s%n%b%n---END---';
      const log = await currentGit.raw([
        'log',
        '-n', '10000',
        '--no-merges',
        `--format=${format}`,
        branchToUse
      ]);

      const commits = log.trim().split('---END---\n').filter(c => c.trim());
      const parsedCommits = commits.map(commitStr => {
        const parts = commitStr.split('\n');
        return {
          hash: parts[0],
          author_name: parts[1],
          date: parts[2],
          message: parts[3],
          body: parts.slice(4).join('\n')
        };
      });

      const filteredCommits = parsedCommits.filter(commit => commit.hash && commit.message);
      console.log(`[${timestamp}] [git-get-all-commits] 获取到 ${filteredCommits.length} 条提交记录`);
      return filteredCommits;
    } catch (error) {
      console.error(`[${timestamp}] [git-get-all-commits] 执行失败: ${error.message}`);
      throw error;
    }
  });

  ipcMain.handle('git-fetch', async () => {
    if (!currentGit) throw new Error('未打开项目');
    await currentGit.fetch();
    return { success: true };
  });

  ipcMain.handle('git-pull', async (event, branch) => {
    if (!currentGit) throw new Error('未打开项目');

    // 拉取前检查远程分支是否存在，避免 simple-git 抛出
    // "couldn't find remote ref <branch>" 这类晦涩错误
    let remoteExists = true;
    try {
      const remote = await currentGit.raw(['ls-remote', '--heads', 'origin', branch]);
      if (!remote || !remote.trim()) {
        remoteExists = false;
      }
    } catch (e) {
      // ls-remote 本身失败（如网络问题）不阻断检查，继续交由后续 pull 报真实错误
      console.warn(`[git-pull] ls-remote 检查失败，继续尝试 pull: ${e && e.message}`);
    }
    if (!remoteExists) {
      throw new Error(`远程分支不存在: origin/${branch}，请先推送该分支或确认分支名`);
    }

    await currentGit.pull('origin', branch);
    return { success: true };
  });

  // 强制使用远程分支覆盖本地分支：fetch origin <branch> + reset --hard origin/<branch>
  // 用于 cherry-pick 推送 / 合并到已有远程分支 / 冲突检测 前同步目标分支，
  // 使本地分支严格等于远程最新，丢弃本地已提交但未推送的 commit。
  ipcMain.handle('git-force-sync-branch', async (event, branch) => {
    if (!currentGit) throw new Error('未打开项目');

    // 预检远程分支是否存在，与 git-pull 保持一致的错误提示
    let remoteExists = true;
    try {
      const remote = await currentGit.raw(['ls-remote', '--heads', 'origin', branch]);
      if (!remote || !remote.trim()) {
        remoteExists = false;
      }
    } catch (e) {
      console.warn(`[git-force-sync-branch] ls-remote 检查失败，继续尝试: ${e && e.message}`);
    }
    if (!remoteExists) {
      console.log(`[git-force-sync-branch] 远程分支不存在: origin/${branch}，跳过远程更新`);
      // 仅尝试切换本地分支，不做 fetch 和 reset --hard
      try {
        await currentGit.checkout(branch);
      } catch (e) {
        console.warn(`[git-force-sync-branch] 本地分支也不存在: ${branch}，跳过切换`);
      }
      return { success: true, remoteExists: false };
    }

    // 拉取远程分支引用
    await currentGit.raw(['fetch', 'origin', branch]);

    // 切换到本地分支；若本地不存在则基于 origin/<branch> 创建跟踪分支
    try {
      await currentGit.checkout(branch);
    } catch (e) {
      await currentGit.checkoutBranch(branch, `origin/${branch}`);
    }

    // 强制用远程分支覆盖本地分支
    await currentGit.raw(['reset', '--hard', `origin/${branch}`]);
    return { success: true, remoteExists: true };
  });

  ipcMain.handle('git-checkout', async (event, branch) => {
    if (!currentGit) throw new Error('未打开项目');
    await currentGit.checkout(branch);
    return { success: true };
  });

  ipcMain.handle('git-cherry-pick', async (event, commitShas) => {
    if (!currentGit) throw new Error('未打开项目');
    
    // 首先尝试清理任何正在进行的 cherry-pick 状态
    try {
      await currentGit.raw(['cherry-pick', '--abort']);
    } catch {
      // 忽略错误，可能是没有正在进行的 cherry-pick
    }
    
    const results = { success: [], skipped: [], errors: [] };
    
    for (const sha of commitShas) {
      console.log(`[git-cherry-pick] 开始 cherry-pick 提交: ${sha}`);
      try {
        await currentGit.raw(['cherry-pick', sha]);
        results.success.push(sha);
        console.log(`[git-cherry-pick] 成功 cherry-pick 提交: ${sha}`);
      } catch (error) {
        console.log(`[git-cherry-pick] cherry-pick 提交 ${sha} 失败: ${error.message}`);
        
        // 检查是否是提交已存在的错误
        if (error.message.includes('empty') || 
            error.message.includes('nothing to commit') ||
            error.message.includes('already exists')) {
          console.log(`[git-cherry-pick] 提交 ${sha} 已存在，尝试跳过`);
          try {
            await currentGit.raw(['cherry-pick', '--skip']);
            results.skipped.push(sha);
            console.log(`[git-cherry-pick] 已跳过提交: ${sha}`);
          } catch (skipError) {
            console.log(`[git-cherry-pick] 跳过失败，尝试中止: ${skipError.message}`);
            try {
              await currentGit.raw(['cherry-pick', '--abort']);
            } catch (abortError) {
              console.log(`[git-cherry-pick] 中止失败: ${abortError.message}`);
            }
            results.skipped.push(sha);
          }
        } else {
          console.log(`[git-cherry-pick] 非预期错误，尝试中止: ${error.message}`);
          try {
            await currentGit.raw(['cherry-pick', '--abort']);
          } catch (abortError) {
            console.log(`[git-cherry-pick] 中止失败: ${abortError.message}`);
          }
          results.errors.push({ sha, error: error.message });
        }
      }
    }
    
    console.log(`[git-cherry-pick] 完成。结果:`, results);
    return results;
  });

  ipcMain.handle('git-push', async (event, branch) => {
    if (!currentGit) throw new Error('未打开项目');
    try {
      await currentGit.push('origin', branch);
      return { success: true };
    } catch (error) {
      console.error(`[git-push] 推送失败: ${error.message}`);
      throw new Error(`推送失败: ${error.message}。请先拉取远程更新，或手动解决冲突后再推送。`);
    }
  });

  ipcMain.handle('git-create-branch', async (event, branchName, baseBranch) => {
    if (!currentGit) throw new Error('未打开项目');
    await currentGit.checkoutBranch(branchName, baseBranch || 'HEAD');
    return { success: true };
  });

  ipcMain.handle('git-check-branch-name-conflict', async (event, branchName) => {
    if (!currentGit) throw new Error('未打开项目');
    try {
      const result = await currentGit.raw(['ls-remote', '--heads', 'origin']);
      const remoteBranches = result
        .trim()
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          const match = line.match(/refs\/heads\/(.+)$/);
          return match ? match[1] : null;
        })
        .filter(Boolean);

      // 检查精确匹配
      if (remoteBranches.includes(branchName)) {
        return {
          conflict: true,
          type: 'exact',
          conflictingBranch: branchName,
          message: `远程已存在同名分支 ${branchName}`
        };
      }

      // 检查父级前缀冲突：已有分支是待创建分支的前缀
      // 例如：已存在 merge/lirs/develop，试图创建 merge/lirs/develop/MKR-1970
      for (const remoteBranch of remoteBranches) {
        if (branchName.startsWith(remoteBranch + '/')) {
          return {
            conflict: true,
            type: 'parent_prefix',
            conflictingBranch: remoteBranch,
            message: `无法创建分支 ${branchName}，已有父级分支 ${remoteBranch} 存在（git 不允许分支路径互为前缀）`
          };
        }
      }

      // 检查子级前缀冲突：已有分支以待创建分支为前缀
      // 例如：已存在 merge/lirs/develop/MKR-1970，试图创建 merge/lirs/develop
      for (const remoteBranch of remoteBranches) {
        if (remoteBranch.startsWith(branchName + '/')) {
          return {
            conflict: true,
            type: 'child_prefix',
            conflictingBranch: remoteBranch,
            message: `无法创建分支 ${branchName}，已有子级分支 ${remoteBranch} 存在（git 不允许分支路径互为前缀）`
          };
        }
      }

      return { conflict: false };
    } catch (error) {
      console.error(`[git-check-branch-name-conflict] 检查失败: ${error.message}`);
      return { conflict: false, error: error.message };
    }
  });

  ipcMain.handle('git-fetch-branch', async (event, branchName) => {
    if (!currentGit) throw new Error('未打开项目');
    try {
      // 预检远程分支是否存在
      const remote = await currentGit.raw(['ls-remote', '--heads', 'origin', branchName]);
      if (!remote || !remote.trim()) {
        console.log(`[git-fetch-branch] 远程分支不存在: origin/${branchName}，跳过拉取`);
        return { success: true, remoteExists: false };
      }
      await currentGit.raw(['fetch', 'origin', branchName]);
      return { success: true, remoteExists: true };
    } catch (error) {
      console.error(`[git-fetch-branch] 拉取远程分支 ${branchName} 失败: ${error.message}`);
      throw new Error(`拉取远程分支 ${branchName} 失败: ${error.message}`);
    }
  });

  ipcMain.handle('git-delete-local-branch', async (event, branchName, force = false) => {
    if (!currentGit) throw new Error('未打开项目');
    try {
      // 先尝试普通删除
      await currentGit.deleteLocalBranch(branchName);
      return { success: true };
    } catch (error) {
      // 如果普通删除失败（如分支未合并），尝试强制删除
      if (force || error.message.includes('not fully merged')) {
        console.log(`[git-delete-local-branch] 普通删除失败，强制删除分支: ${branchName}`);
        await currentGit.raw(['branch', '-D', branchName]);
        return { success: true };
      }
      console.error(`[git-delete-local-branch] 删除分支 ${branchName} 失败:`, error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('git-delete-remote-branch', async (event, branchName) => {
    if (!currentGit) throw new Error('未打开项目');
    try {
      await currentGit.push(['origin', '--delete', branchName]);
      return { success: true };
    } catch (error) {
      console.error(`[git-delete-remote-branch] 删除远程分支 ${branchName} 失败:`, error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('git-has-uncommitted-changes', async () => {
    if (!currentGit) throw new Error('未打开项目');

    // 先清理任何可能的 cherry-pick 残留状态，避免干扰检测
    try {
      await currentGit.raw(['cherry-pick', '--abort']);
    } catch {
      // 没有正在进行的 cherry-pick，忽略
    }

    const status = await currentGit.raw(['status', '--porcelain', '.']);
    return status.trim().length > 0;
  });

  // 检查当前分支相对于目标远程分支是否有新的提交
  ipcMain.handle('git-check-has-new-commits', async (event, targetBranch) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-check-has-new-commits] 检查是否有新提交: ${targetBranch}`);

    if (!currentGit) throw new Error('未打开项目');

    try {
      const result = await currentGit.raw(['rev-list', '--count', `origin/${targetBranch}..HEAD`]);
      const count = parseInt(result.trim(), 10) || 0;
      console.log(`[${timestamp}] [git-check-has-new-commits] 新提交数量: ${count}`);
      return { hasNewCommits: count > 0, count };
    } catch (error) {
      // 如果 origin/xxx 不存在（首次推送），说明一定有新提交
      console.log(`[${timestamp}] [git-check-has-new-commits] 检查失败(可能是首次推送), 认为有新提交: ${error.message}`);
      return { hasNewCommits: true, count: 1 };
    }
  });

  ipcMain.handle('git-stash-create', async (event, message) => {
    if (!currentGit) throw new Error('未打开项目');
    await currentGit.stash(['save', message]);
    return { success: true };
  });

  ipcMain.handle('git-stash-pop', async () => {
    if (!currentGit) throw new Error('未打开项目');
    await currentGit.stash(['pop']);
    return { success: true };
  });

  ipcMain.handle('git-get-remote-url', async () => {
    if (!currentGit) throw new Error('未打开项目');
    const remotes = await currentGit.getRemotes(true);
    const origin = remotes.find(r => r.name === 'origin');
    return origin ? origin.refs.fetch : '';
  });

  ipcMain.handle('git-commit-exists', async (event, branch, commitHash) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-commit-exists] 检查提交是否存在: ${commitHash} in ${branch}`);
    
    if (!currentGit) throw new Error('未打开项目');
    
    try {
      const result = await currentGit.raw(['branch', '--contains', commitHash, '--list', branch]);
      const exists = result.trim().length > 0;
      console.log(`[${timestamp}] [git-commit-exists] 结果: ${exists}`);
      return exists;
    } catch (error) {
      console.error(`[${timestamp}] [git-commit-exists] 检查失败:`, error.message);
      return false;
    }
  });

  ipcMain.handle('git-check-commits-in-branch', async (event, branch, commitSubjects) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-check-commits-in-branch] 通过commit信息检查提交是否存在: origin/${branch}`);

    if (!currentGit) throw new Error('未打开项目');

    try {
      const logOutput = await currentGit.raw(['log', `origin/${branch}`, '--format=%s', '-n', '5000']);
      const existingSubjects = new Set(logOutput.split('\n').filter(Boolean));

      const result = {};
      for (const subject of commitSubjects) {
        result[subject] = existingSubjects.has(subject);
      }
      return result;
    } catch (error) {
      console.error(`[${timestamp}] [git-check-commits-in-branch] 错误: ${error.message}`);
      throw error;
    }
  });

  ipcMain.handle('git-detect-version', async (event, targetBranch, commitMessage) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-detect-version] 检测版本: branch=${targetBranch}, message=${commitMessage}`);

    if (!currentGit) throw new Error('未打开项目');

    try {
      const branchRef = `origin/${targetBranch}`;

      const logOutput = await currentGit.raw([
        'log', branchRef, '--format=%H%n%s', '-n', '5000', '--no-merges'
      ]);

      const lines = logOutput.trim().split('\n').filter(Boolean);
      const matchingShas = [];
      for (let i = 0; i < lines.length - 1; i += 2) {
        if (lines[i + 1] === commitMessage) {
          matchingShas.push(lines[i]);
        }
      }

      console.log(`[${timestamp}] [git-detect-version] 找到 ${matchingShas.length} 条匹配记录`);

      const tagMap = new Map();

      for (const sha of matchingShas) {
        try {
          const tagOutput = await currentGit.raw([
            'tag', '--contains', sha, '-l', 'V5.*.R.*'
          ]);
          const tagNames = tagOutput.trim().split('\n').filter(Boolean);

          for (const tagName of tagNames) {
            if (!tagMap.has(tagName)) {
              const dateOutput = await currentGit.raw([
                'log', '-1', '--format=%ai', tagName
              ]);
              tagMap.set(tagName, {
                tag: tagName,
                tagDate: dateOutput.trim()
              });
            }
          }
        } catch (e) {
          // 该提交未找到匹配的 tag
        }
      }

      // 只保留最早（日期最小）的一条匹配 tag，即该提交首次出现的版本
      const allMatched = Array.from(tagMap.values());
      allMatched.sort((a, b) => a.tagDate.localeCompare(b.tagDate));
      const matchedTag = allMatched.length > 0 ? allMatched[0] : null;

      // 获取分支当前最新的 V5.*.R.* tag（从分支顶端往前找）
      let latestTag = null;
      try {
        const latestTagOutput = await currentGit.raw([
          'describe', '--tags', '--match', 'V5.*.R.*', '--abbrev=0', branchRef
        ]);
        const latestTagName = latestTagOutput.trim();
        const latestDateOutput = await currentGit.raw([
          'log', '-1', '--format=%ai', latestTagName
        ]);
        latestTag = {
          tag: latestTagName,
          tagDate: latestDateOutput.trim()
        };
      } catch (e) {
        // 该分支无匹配的 V5.*.R.* tag
      }

      console.log(`[${timestamp}] [git-detect-version] matchedTag: ${matchedTag?.tag}, latestTag: ${latestTag?.tag}`);
      return { matchedTag, latestTag };
    } catch (error) {
      console.error(`[${timestamp}] [git-detect-version] 错误: ${error.message}`);
      throw error;
    }
  });

  ipcMain.handle('git-cherry-pick-single', async (event, sha) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-cherry-pick-single] 开始 cherry-pick 单个提交: ${sha}`);

    if (!currentGit) throw new Error('未打开项目');

    // 清理可能的 cherry-pick 残留状态
    try {
      await currentGit.raw(['cherry-pick', '--abort']);
    } catch {
      // 无需清理，忽略
    }

    try {
      await currentGit.raw(['cherry-pick', sha]);
      console.log(`[${timestamp}] [git-cherry-pick-single] 成功: ${sha}`);
      return { status: 'success', sha };
    } catch (error) {
      const msg = error.message || '';

      // 已存在的提交（空操作）
      if (msg.includes('empty') || msg.includes('nothing to commit') || msg.includes('already exists')) {
        console.log(`[${timestamp}] [git-cherry-pick-single] 提交已存在，跳过: ${sha}`);
        try { await currentGit.raw(['cherry-pick', '--skip']); } catch {}
        return { status: 'skipped', sha };
      }

      // 检测冲突
      if (msg.includes('could not apply') || msg.includes('CONFLICT') || msg.includes('conflict')) {
        console.log(`[${timestamp}] [git-cherry-pick-single] 检测到冲突: ${sha}`);
        try {
          const diffOutput = await currentGit.raw(['diff', '--name-only', '--diff-filter=U']);
          const conflictedFiles = diffOutput.trim().split('\n').filter(Boolean);
          console.log(`[${timestamp}] [git-cherry-pick-single] 冲突文件:`, conflictedFiles);
          return { status: 'conflict', sha, conflictedFiles };
        } catch (e) {
          console.error(`[${timestamp}] [git-cherry-pick-single] 获取冲突文件列表失败:`, e.message);
          return { status: 'conflict', sha, conflictedFiles: [] };
        }
      }

      // 其他错误 — 中止
      console.log(`[${timestamp}] [git-cherry-pick-single] 错误，中止: ${msg}`);
      try { await currentGit.raw(['cherry-pick', '--abort']); } catch {}
      return { status: 'error', sha, error: msg };
    }
  });

  ipcMain.handle('git-cherry-pick-continue', async () => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-cherry-pick-continue] 继续 cherry-pick`);

    if (!currentGit || !currentProjectPath) throw new Error('未打开项目');

    try {
      await currentGit.raw(['add', '-A']);
      await new Promise((resolve, reject) => {
        exec('git -c core.editor=true cherry-pick --continue', { cwd: currentProjectPath }, (err) => {
          if (err) reject(err); else resolve();
        });
      });
      console.log(`[${timestamp}] [git-cherry-pick-continue] 成功`);
      return { success: true };
    } catch (error) {
      console.error(`[${timestamp}] [git-cherry-pick-continue] 失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('git-cherry-pick-abort', async () => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-cherry-pick-abort] 中止 cherry-pick`);

    if (!currentGit) throw new Error('未打开项目');

    try {
      await currentGit.raw(['cherry-pick', '--abort']);
      return { success: true };
    } catch (error) {
      console.error(`[${timestamp}] [git-cherry-pick-abort] 失败: ${error.message}`);
      return { success: true };
    }
  });

  // 获取冲突文件的 ours/theirs 干净版本（用于多语言自动合并）
  ipcMain.handle('git-get-conflict-file-versions', async (event, filePaths) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-get-conflict-file-versions] 获取冲突文件版本: ${filePaths.length} 个文件`);

    if (!currentGit || !currentProjectPath) throw new Error('未打开项目');

    try {
      const files = [];
      for (const filePath of filePaths) {
        let ours = '';
        let theirs = '';
        try {
          ours = await currentGit.raw(['show', `:2:${filePath}`]);
        } catch {
          // 文件在ours侧不存在（如新文件），保持空字符串
        }
        try {
          theirs = await currentGit.raw(['show', `:3:${filePath}`]);
        } catch {
          // 文件在theirs侧不存在，保持空字符串
        }
        files.push({ path: filePath, ours, theirs });
      }
      console.log(`[${timestamp}] [git-get-conflict-file-versions] 成功获取 ${files.length} 个文件版本`);
      return { success: true, files };
    } catch (error) {
      console.error(`[${timestamp}] [git-get-conflict-file-versions] 失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // 获取带冲突标记的原始文件内容（用于 Claude 智能处理）
  ipcMain.handle('git-get-conflict-file-content', async (event, filePaths) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-get-conflict-file-content] 读取冲突文件内容: ${filePaths.length} 个文件`);

    if (!currentProjectPath) throw new Error('未打开项目');

    try {
      const files = [];
      for (const filePath of filePaths) {
        const absPath = path.join(currentProjectPath, filePath);
        const content = fs.readFileSync(absPath, 'utf-8');
        files.push({ path: filePath, content });
      }
      return { success: true, files };
    } catch (error) {
      console.error(`[${timestamp}] [git-get-conflict-file-content] 失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // 写入文件内容并 git add
  ipcMain.handle('git-write-file-and-stage', async (event, files) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-write-file-and-stage] 写入并暂存 ${files.length} 个文件`);

    if (!currentGit || !currentProjectPath) throw new Error('未打开项目');

    try {
      for (const { path: filePath, content } of files) {
        const absPath = path.join(currentProjectPath, filePath);
        fs.writeFileSync(absPath, content, 'utf-8');
        await currentGit.raw(['add', filePath]);
        console.log(`[${timestamp}] [git-write-file-and-stage] 已处理: ${filePath}`);
      }
      return { success: true };
    } catch (error) {
      console.error(`[${timestamp}] [git-write-file-and-stage] 失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // 取当前 HEAD 的 commit sha（用作版本替换/squash 的遴选前基点）
  ipcMain.handle('git-get-head-sha', async () => {
    if (!currentGit) throw new Error('未打开项目');
    const sha = (await currentGit.raw(['rev-parse', 'HEAD'])).trim();
    return { sha };
  });

  // 读取工作区 pom.xml 的 parent.version（判断当前代码基线版本）
  // 返回 { success, version?, error? }；error: 'no-pom' | 'no-parent-version' | 其他
  ipcMain.handle('git-read-pom-parent-version', async () => {
    if (!currentProjectPath) throw new Error('未打开项目');
    const pomPath = path.join(currentProjectPath, 'pom.xml');
    if (!fs.existsSync(pomPath)) {
      return { success: false, error: 'no-pom' };
    }
    try {
      const content = fs.readFileSync(pomPath, 'utf-8');
      const parentMatch = content.match(/<parent>([\s\S]*?)<\/parent>/);
      if (!parentMatch) {
        return { success: false, error: 'no-parent-version' };
      }
      const versionMatch = parentMatch[1].match(/<version>([^<]+)<\/version>/);
      if (!versionMatch) {
        return { success: false, error: 'no-parent-version' };
      }
      return { success: true, version: versionMatch[1].trim() };
    } catch (error) {
      console.error('[git-read-pom-parent-version] 失败:', error.message);
      return { success: false, error: error.message };
    }
  });

  // 列出 sinceSha..HEAD 之间改动且后缀为 .java 的文件（本次遴选涉及的 java 文件）
  ipcMain.handle('git-list-changed-java-files', async (event, sinceSha) => {
    if (!currentGit) throw new Error('未打开项目');
    if (!sinceSha) throw new Error('基点 sha 不能为空');
    try {
      const out = await currentGit.raw(['diff', '--name-only', sinceSha, 'HEAD']);
      const files = out.trim().split('\n').filter(f => f && f.endsWith('.java'));
      return { success: true, files };
    } catch (error) {
      console.error('[git-list-changed-java-files] 失败:', error.message);
      return { success: false, error: error.message, files: [] };
    }
  });

  // 对指定 java 文件应用版本基线替换（javax↔jakarta, fastjson↔fastjson2）并 git add
  // params: { files: string[], direction: 'forward' | 'reverse' }
  // forward  = V5→V5.5（javax.→jakarta., com.alibaba.fastjson.→com.alibaba.fastjson2.）
  // reverse  = V5.5→V5（反向）
  ipcMain.handle('git-apply-version-replacement', async (event, params) => {
    const timestamp = formatTimestamp();
    const { files, direction } = params || {};
    if (!currentGit || !currentProjectPath) throw new Error('未打开项目');
    if (!Array.isArray(files) || files.length === 0) {
      return { success: true, changedFiles: [], totalReplacements: 0 };
    }
    if (direction !== 'forward' && direction !== 'reverse') {
      return { success: false, error: 'direction 必须是 forward 或 reverse' };
    }

    // V5→V5.5 升级需要替换的 javax 包名（参考 MKV55UpgradeTools.java）
    const PKGS = ['activation', 'annotation', 'batch', 'cjb', 'decorator', 'el', 'enterprise',
      'faces', 'inject', 'interceptor', 'jms', 'json', 'jsvs', 'mail', 'managementj2ee', 'resource',
      'security', 'servlet', 'transaction', 'validation', 'websocket', 'ws', 'xml'];

    const pairs = [];
    for (const pkg of PKGS) {
      if (direction === 'forward') {
        pairs.push([`javax.${pkg}.`, `jakarta.${pkg}.`]);
      } else {
        pairs.push([`jakarta.${pkg}.`, `javax.${pkg}.`]);
      }
    }
    if (direction === 'forward') {
      pairs.push(['com.alibaba.fastjson.', 'com.alibaba.fastjson2.']);
    } else {
      pairs.push(['com.alibaba.fastjson2.', 'com.alibaba.fastjson.']);
    }

    const changedFiles = [];
    let totalReplacements = 0;
    try {
      for (const filePath of files) {
        const absPath = path.join(currentProjectPath, filePath);
        if (!fs.existsSync(absPath)) continue;
        let content;
        try {
          content = fs.readFileSync(absPath, 'utf-8');
        } catch {
          continue;
        }
        let result = content;
        for (const [from, to] of pairs) {
          if (result.includes(from)) {
            result = result.split(from).join(to);
          }
        }
        if (result !== content) {
          fs.writeFileSync(absPath, result, 'utf-8');
          await currentGit.raw(['add', filePath]);
          changedFiles.push(filePath);
          totalReplacements++;
          console.log(`[${timestamp}] [git-apply-version-replacement] 替换: ${filePath}`);
        }
      }
      console.log(`[${timestamp}] [git-apply-version-replacement] direction=${direction}, 改动文件 ${changedFiles.length} 个`);
      return { success: true, changedFiles, totalReplacements };
    } catch (error) {
      console.error(`[${timestamp}] [git-apply-version-replacement] 失败: ${error.message}`);
      return { success: false, error: error.message, changedFiles, totalReplacements };
    }
  });

  // Squash into Parent：把当前工作区改动作为 fixup 提交，autosquash 合并进最后一个遴选 commit
  // params: { beforePickSha } —— 遴选前 HEAD（forceSync/createBranch 后的 sha），作为 rebase 基点
  // 失败时尝试 rebase --abort / --skip 回退，不抛异常，返回 { success:false, aborted:true }
  ipcMain.handle('git-squash-into-parent', async (event, params) => {
    const timestamp = formatTimestamp();
    const { beforePickSha } = params || {};
    if (!currentGit || !currentProjectPath) throw new Error('未打开项目');
    if (!beforePickSha) return { success: false, error: 'beforePickSha 不能为空' };

    const runExec = (cmd) => new Promise((resolve, reject) => {
      exec(cmd, { cwd: currentProjectPath }, (err, stdout, stderr) => {
        if (err) reject(new Error(`${err.message}${stderr ? `\n${stderr}` : ''}`));
        else resolve(stdout);
      });
    });

    try {
      // 1. 暂存所有改动
      await currentGit.raw(['add', '-A']);
      // 2. 创建 fixup commit（基于 HEAD，core.editor=true 避免编辑器交互）
      await runExec('git -c core.editor=true commit --fixup=HEAD');
      // 3. autosquash rebase：sequence.editor=true 自动确认 todo 列表，把 fixup 合并进对应遴选 commit
      await runExec(`git -c core.editor=true -c sequence.editor=true rebase -i --autosquash ${beforePickSha}`);
      console.log(`[${timestamp}] [git-squash-into-parent] squash 成功，基点 ${beforePickSha.substring(0, 8)}`);
      return { success: true };
    } catch (error) {
      console.warn(`[${timestamp}] [git-squash-into-parent] 失败: ${error.message}，尝试回退`);
      try {
        await runExec('git -c core.editor=true rebase --abort');
        console.log(`[${timestamp}] [git-squash-into-parent] rebase --abort 成功`);
      } catch (abortErr) {
        console.warn(`[${timestamp}] [git-squash-into-parent] rebase --abort 失败: ${abortErr.message}，尝试 --skip`);
        try {
          await runExec('git -c core.editor=true rebase --skip');
        } catch (skipErr) {
          console.warn(`[${timestamp}] [git-squash-into-parent] rebase --skip 失败: ${skipErr.message}`);
        }
      }
      return { success: false, error: error.message, aborted: true };
    }
  });

  // 调用 Claude 智能解决冲突（流式，思考/文本增量通过 IPC 实时推送给渲染进程）
  ipcMain.handle('claude-resolve-conflicts', async (ipcEvent, params) => {
    const timestamp = formatTimestamp();
    const { files, projectName, projectPath, operation } = params;
    console.log(`[${timestamp}] [claude-resolve-conflicts] 开始智能冲突处理: ${files.length} 个文件, 项目: ${projectName}`);

    try {
      const config = getClaudeConfig();
      if (!config.apiUrl || !config.apiKey) {
        return { success: false, error: '未配置 Claude API，请先在设置中配置' };
      }

      const client = new Anthropic({
        baseURL: config.apiUrl.replace(/\/$/, ''),
        apiKey: config.apiKey,
        // 流式请求：首字节超时给足（thinking 模型首 token 可能较慢），一旦开始流式即不会触发
        timeout: 180000,
        // 声明 1M 上下文（参考 cc-switch：剥离本地 [1m] 后缀，改用 beta 头启用）
        defaultHeaders: config.supports1M ? { 'anthropic-beta': 'context-1m-2025-08-07' } : undefined
      });

      // 构建文件内容块
      let filesBlock = '';
      for (const { path: filePath, content } of files) {
        filesBlock += `\n<FILE path="${filePath}">\n${content}\n</FILE>\n`;
      }

      const systemPrompt = `你是一个 Git 合并冲突解决助手。你会收到带有 Git 冲突标记(<<<<<<<, =======, >>>>>>>)的文件。
请解决所有冲突，并将每个解决后的文件用 <FILE path="...">...</FILE> 标签包裹返回。

规则：
1. 保留所有非冲突代码不变
2. 对每个冲突块，智能合并双方内容——不要简单地选择其中一方
3. 当双方都添加了新功能时，将它们合并
4. 当双方修改了同一行且逻辑不同时，选择更完整/正确的版本
5. 移除所有冲突标记(<<<<<<<, =======, >>>>>>>)
6. 返回完整的文件内容，不仅仅是解决的部分`;

      const userPrompt = `项目名称: ${projectName}
项目路径: ${projectPath}
操作: ${operation} 时发生冲突，请解决以下文件的冲突：
${filesBlock}`;

      console.log(`[${timestamp}] [claude-resolve-conflicts] 发送流式请求到 Claude, model: ${config.model}`);
      const stream = await client.messages.stream({
        model: config.model || 'claude-sonnet-4-6',
        max_tokens: 8192,
        messages: [
          { role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }
        ]
      });

      // 实时推送思考与文本增量，累积文本用于最终解析
      let responseText = '';
      for await (const ev of stream) {
        if (ev.type === 'content_block_delta' && ev.delta) {
          if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) {
            ipcEvent.sender.send('claude-resolve-stream', { type: 'thinking', data: ev.delta.thinking });
          } else if (ev.delta.type === 'text_delta' && ev.delta.text) {
            responseText += ev.delta.text;
            ipcEvent.sender.send('claude-resolve-stream', { type: 'text', data: ev.delta.text });
          }
        }
      }

      // 解析返回内容，提取 <FILE path="...">...</FILE> 块
      const resolvedFiles = [];
      const fileRegex = /<FILE\s+path="([^"]+)">\s*([\s\S]*?)\s*<\/FILE>/g;
      let match;
      while ((match = fileRegex.exec(responseText)) !== null) {
        resolvedFiles.push({ path: match[1], content: match[2] });
      }

      if (resolvedFiles.length === 0) {
        console.error(`[${timestamp}] [claude-resolve-conflicts] 无法解析 Claude 返回格式`);
        return { success: false, error: '无法解析 Claude 返回的文件内容，请重试' };
      }

      console.log(`[${timestamp}] [claude-resolve-conflicts] 成功解析 ${resolvedFiles.length} 个已解决文件`);
      return { success: true, files: resolvedFiles };
    } catch (error) {
      console.error(`[${timestamp}] [claude-resolve-conflicts] 失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // 获取当前项目路径
  ipcMain.handle('git-get-project-path', () => {
    return currentProjectPath || '';
  });

  // 获取编辑器可执行文件路径
  function getEditorPath(editorName) {
    const programFilesDirs = [
      process.env['LOCALAPPDATA'] || '',
      process.env['PROGRAMFILES'] || 'C:\\Program Files',
      process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
    ].filter(Boolean);

    const editorPaths = {
      trae: [
        ...programFilesDirs.map(d => path.join(d, 'Trae', 'Trae.exe')),
        ...programFilesDirs.map(d => path.join(d, 'Trae', 'bin', 'trae.exe')),
        path.join(process.env['USERPROFILE'] || 'C:\\Users\\default', 'scoop', 'apps', 'trae', 'current', 'Trae.exe'),
      ],
      code: [
        ...programFilesDirs.map(d => path.join(d, 'Microsoft VS Code', 'Code.exe')),
        ...programFilesDirs.map(d => path.join(d, 'Microsoft VS Code', 'bin', 'code.cmd')),
        path.join(process.env['USERPROFILE'] || 'C:\\Users\\default', 'scoop', 'apps', 'vscode', 'current', 'Code.exe'),
      ]
    };

    const candidates = editorPaths[editorName] || [];
    return candidates.find(candidate => fs.existsSync(candidate)) || null;
  }

  ipcMain.handle('open-file-in-editor', async (event, filePath) => {
    const timestamp = formatTimestamp();
    const fullPath = path.join(currentProjectPath || '', filePath);
    console.log(`[${timestamp}] [open-file-in-editor] 尝试打开文件: ${fullPath}`);

    if (!require('fs').existsSync(fullPath)) {
      return { success: false, error: '目标文件不存在，请检查文件路径' };
    }

    // 优先 Trae，降级 VS Code
    const editors = ['trae', 'code'];
    for (const editor of editors) {
      try {
        // 先尝试通过 PATH 中的命令启动
        await new Promise((resolve, reject) => {
          exec(`"${editor}" "${fullPath}"`, (err) => {
            if (err) reject(err); else resolve();
          });
        });
        console.log(`[${timestamp}] [open-file-in-editor] 使用 ${editor}（PATH）打开成功`);
        return { success: true, editor };
      } catch {
        // 尝试通过安装路径直接启动
        const editorPath = getEditorPath(editor);
        if (editorPath) {
          try {
            await new Promise((resolve, reject) => {
              exec(`"${editorPath}" "${fullPath}"`, (err) => {
                if (err) reject(err); else resolve();
              });
            });
            console.log(`[${timestamp}] [open-file-in-editor] 使用 ${editorPath} 打开成功`);
            return { success: true, editor };
          } catch {
            continue;
          }
        }
      }
    }

    // 最后尝试用系统默认编辑器打开
    try {
      await shell.openPath(fullPath);
      console.log(`[${timestamp}] [open-file-in-editor] 使用系统默认程序打开成功`);
      return { success: true, editor: 'system-default' };
    } catch (e) {
      console.log(`[${timestamp}] [open-file-in-editor] 系统默认程序打开失败: ${e.message}`);
    }

    console.log(`[${timestamp}] [open-file-in-editor] 未检测到支持的编辑器`);
    return { success: false, error: '未检测到支持的编辑器（已检查 PATH 和常见安装路径），请手动处理冲突文件' };
  });

  // GitLab操作
  ipcMain.handle('gitlab-test-token', async (event, serverUrl, token) => {
    try {
      const response = await axios.get(`${serverUrl}/api/v4/user`, {
        headers: { 'PRIVATE-TOKEN': token },
        timeout: 10000
      });
      return { success: true, user: response.data };
    } catch (error) {
      let errorMessage = '令牌验证失败';
      if (error.response) {
        switch (error.response.status) {
          case 401: errorMessage = '令牌无效或已过期'; break;
          case 403: errorMessage = '没有访问权限'; break;
          case 404: errorMessage = 'GitLab服务器地址错误'; break;
          default: errorMessage = `服务器错误: ${error.response.status}`;
        }
      } else if (error.request) {
        errorMessage = '网络连接失败';
      }
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('gitlab-get-project-id', async (event, serverUrl, token, projectPath) => {
    try {
      const encodedPath = encodeURIComponent(projectPath);
      const response = await axios.get(`${serverUrl}/api/v4/projects/${encodedPath}`, {
        headers: { 'PRIVATE-TOKEN': token },
        timeout: 10000
      });
      return { success: true, projectId: response.data.id };
    } catch (error) {
      console.error('[gitlab-get-project-id] 错误:', error.response?.data || error.message);
      return { success: false, error: error.response?.data?.message || error.message };
    }
  });

  ipcMain.handle('gitlab-create-merge-request', async (event, serverUrl, token, projectId, sourceBranch, targetBranch, title, description, removeSourceBranch = true) => {
    try {
      // projectId 可以是数字 ID 或 URL 编码的项目路径
      const response = await axios.post(
        `${serverUrl}/api/v4/projects/${projectId}/merge_requests`,
        {
          source_branch: sourceBranch,
          target_branch: targetBranch,
          title: title,
          description: description,
          remove_source_branch: removeSourceBranch
        },
        {
          headers: { 'PRIVATE-TOKEN': token },
          timeout: 30000
        }
      );
      console.log('[gitlab-create-merge-request] 合并请求创建成功，源分支将被删除:', removeSourceBranch);
      return { success: true, mergeRequest: response.data };
    } catch (error) {
      console.error('[gitlab-create-merge-request] 错误:', error.response?.data || error.message);
      return { success: false, error: error.response?.data?.message || error.message };
    }
  });

  // 在浏览器中打开
  ipcMain.handle('open-external', (event, url) => {
    shell.openExternal(url);
  });

  // 显示消息框
  ipcMain.handle('show-message-box', async (event, options) => {
    return await dialog.showMessageBox(mainWindow, options);
  });

  // 显示错误框
  ipcMain.handle('show-error-box', (event, title, content) => {
    dialog.showErrorBox(title, content);
  });

  // 导出日志文件为 zip
  ipcMain.handle('export-log-zip', async (event) => {
    try {
      const logPath = getLogFilePath();
      if (!fs.existsSync(logPath)) {
        return { success: false, error: '日志文件不存在' };
      }

      const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出日志文件',
        defaultPath: `LandrayGitTool-日志-${new Date().toISOString().slice(0, 10)}.zip`,
        filters: [{ name: 'ZIP压缩文件', extensions: ['zip'] }]
      });

      if (result.canceled) {
        return { success: false, canceled: true };
      }

      const output = fs.createWriteStream(result.filePath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      return new Promise((resolve) => {
        output.on('close', () => {
          console.log(`[export-log-zip] 日志已压缩至: ${result.filePath}`);
          resolve({ success: true, path: result.filePath });
        });

        archive.on('error', (err) => {
          console.error(`[export-log-zip] 压缩失败:`, err);
          resolve({ success: false, error: err.message });
        });

        archive.pipe(output);
        archive.file(logPath, { name: 'app.log' });
        archive.finalize();
      });
    } catch (error) {
      console.error(`[export-log-zip] 导出失败:`, error);
      return { success: false, error: error.message };
    }
  });

  // ========== Claude AI 相关 IPC handlers ==========

  // 读取本地 Claude 配置文件
  ipcMain.handle('claude-read-local-config', async () => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [claude-read-local-config] 读取本地 Claude 配置`);
    const os = require('os');

    // 辅助：剥离 [1m]/[1M] 标记，返回 { cleanName, supports1M }
    const parseModelName = (raw) => {
      const supports1M = raw.endsWith('[1m]') || raw.endsWith('[1M]');
      return {
        cleanName: supports1M ? raw.slice(0, -4) : raw,
        supports1M
      };
    };

    const homeDir = os.homedir();
    const config = {
      exists: false,
      apiUrl: '',
      apiKey: '',
      model: '',            // 剥离 [1m] 后的默认模型名
      modelSupports1M: false,
      models: [],           // 剥离 [1m] 后的模型名列表
      modelsMeta: {}        // { modelName: true } 表示该模型在配置中带有 [1m]
    };

    // 1. 环境变量
    if (process.env.ANTHROPIC_AUTH_TOKEN) {
      config.apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
    }
    if (process.env.ANTHROPIC_BASE_URL) {
      config.apiUrl = process.env.ANTHROPIC_BASE_URL;
    }
    if (process.env.ANTHROPIC_MODEL) {
      const parsed = parseModelName(process.env.ANTHROPIC_MODEL);
      config.model = parsed.cleanName;
      config.modelSupports1M = parsed.supports1M;
    }

    // 2. ~/.claude/settings.json
    const settingsPath = path.join(homeDir, '.claude', 'settings.json');
    try {
      if (fs.existsSync(settingsPath)) {
        const content = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        const env = content.env || {};

        if (!config.apiKey && env.ANTHROPIC_AUTH_TOKEN) {
          config.apiKey = env.ANTHROPIC_AUTH_TOKEN;
        }
        if (!config.apiUrl && env.ANTHROPIC_BASE_URL) {
          config.apiUrl = env.ANTHROPIC_BASE_URL;
        }
        if (!config.model && env.ANTHROPIC_MODEL) {
          const parsed = parseModelName(env.ANTHROPIC_MODEL);
          config.model = parsed.cleanName;
          config.modelSupports1M = parsed.supports1M;
        }

        // 提取所有 *_MODEL 字段的模型名，剥离 [1m] 并记录标记
        const modelSet = new Set();
        const meta = {};
        Object.keys(env).forEach(key => {
          if (key.endsWith('_MODEL') || key === 'ANTHROPIC_MODEL') {
            const val = env[key];
            if (val && typeof val === 'string') {
              const parsed = parseModelName(val);
              modelSet.add(parsed.cleanName);
              if (parsed.supports1M) {
                meta[parsed.cleanName] = true;
              }
            }
          }
        });
        config.models = Array.from(modelSet);
        config.modelsMeta = meta;

        if (config.apiKey && config.apiUrl) {
          config.exists = true;
        }
      }
    } catch (e) {
      console.log(`[${timestamp}] [claude-read-local-config] 读取失败:`, e.message);
    }

    console.log(`[${timestamp}] [claude-read-local-config] 结果: exists=${config.exists}, models=${config.models.length}个, supports1M=${config.modelSupports1M}`);
    return { success: true, config };
  });

  // Claude API 模型列表获取（内部实现，供测试连接与获取模型列表共用）
  // 参考 cc-switch：通过 OpenAI 兼容的 GET /v1/models 端点验证连接/获取模型，
  // 不发送真实推理请求，避免上游账号池耗尽（503 No available accounts）等
  // 与连接本身无关的错误导致连接测试误判。
  const fetchClaudeModelsInternal = async (apiUrl, apiKey, logTag, asConnectionTest = false) => {
    const timestamp = formatTimestamp();

    // Anthropic 兼容 API 可能位于子路径下，需要剥离后缀尝试根路径
    const COMPAT_SUFFIXES = [
      '/api/claudecode', '/api/anthropic', '/apps/anthropic', '/api/coding',
      '/claudecode', '/anthropic', '/step_plan', '/coding', '/claude'
    ];

    // 辅助函数：判断 HTTP 错误是否为"端点不存在"
    const isNotFound = (err) => {
      const status = err?.status || err?.response?.status;
      return status === 404 || status === 405 || status === 501;
    };

    // 构建候选 URL 列表
    const buildUrlCandidates = (baseUrl) => {
      const urls = [];
      let url = baseUrl.replace(/\/+$/, ''); // 去尾部斜杠

      // 候选 1：直接拼接 /v1/models（针对 Anthropic SDK 路径）
      urls.push(`${url}/v1/models`);

      // 候选 2：如果已经是 /v{N} 结尾，直接拼 /models
      if (/\/v\d+$/.test(url)) {
        urls.push(`${url}/models`);
      }

      // 候选 3：剥离兼容后缀后，尝试根路径
      let strippedUrl = null;
      for (const suffix of COMPAT_SUFFIXES) {
        if (url.endsWith(suffix)) {
          strippedUrl = url.slice(0, -suffix.length);
          break;
        }
      }
      if (strippedUrl) {
        urls.push(`${strippedUrl}/v1/models`);
        urls.push(`${strippedUrl}/models`);
      }

      // 去重
      return [...new Set(urls)];
    };

    // 尝试解析响应（支持多种格式），并剥离 [1m]/[1M] 后缀
    // 部分代理的 /v1/models 会把"支持 1M 上下文"标记拼进模型 id（如 glm5.2[1M]），
    // 这里统一剥成 cleanName，并记录到 meta，避免下拉框出现带后缀的独立条目。
    const parseModelsResponse = (data) => {
      let rawModels;
      if (Array.isArray(data)) rawModels = data.map(m => m.id || m).filter(Boolean);
      else if (data.data && Array.isArray(data.data)) rawModels = data.data.map(m => m.id).filter(Boolean);
      else if (data.models && Array.isArray(data.models)) rawModels = data.models.map(m => m.id || m).filter(Boolean);
      else return { models: [], meta: {} };

      const models = [];
      const meta = {};
      for (const raw of rawModels) {
        const supports1M = raw.endsWith('[1m]') || raw.endsWith('[1M]');
        const cleanName = supports1M ? raw.slice(0, -4) : raw;
        models.push(cleanName);
        if (supports1M) meta[cleanName] = true;
      }
      return { models: [...new Set(models)], meta };
    };

    const candidates = buildUrlCandidates(apiUrl);
    console.log(`[${timestamp}] [${logTag}] 候选 URL (${candidates.length}个):`, candidates);

    // 依次尝试每个候选 URL
    const errors = [];
    for (const candidateUrl of candidates) {
      console.log(`[${timestamp}] [${logTag}] 尝试: ${candidateUrl}`);
      try {
        const response = await axios.get(candidateUrl, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          timeout: 15000
        });

        const { models, meta } = parseModelsResponse(response.data);
        if (models.length > 0) {
          console.log(`[${timestamp}] [${logTag}] ${asConnectionTest ? `验证成功, 端点 ${candidateUrl} 返回 ${models.length} 个模型` : `成功! 从 ${candidateUrl} 获取到 ${models.length} 个模型`}`);
          return { success: true, models, modelsMeta: meta, endpoint: candidateUrl };
        }
        // 响应 200 但无模型数据，记录并继续尝试
        console.log(`[${timestamp}] [${logTag}] 响应成功但无模型数据，继续尝试下一个`);
        errors.push(`${candidateUrl}: 返回空模型列表`);
      } catch (err) {
        const status = err?.response?.status || err?.status || 'network';
        console.log(`[${timestamp}] [${logTag}] ${candidateUrl} 失败: ${status}`);
        if (isNotFound(err)) {
          // 404/405 → 端点不存在，继续尝试下一个
          errors.push(`${candidateUrl}: HTTP ${status}`);
          continue;
        }
        // 其他错误（401/403/超时等）→ 立即返回
        const msg = err?.response?.data?.error?.message || err.message;
        return { success: false, error: `获取模型列表失败: ${msg}` };
      }
    }

    // 所有候选 URL 都返回 404/405 → 不支持
    console.log(`[${timestamp}] [${logTag}] ${asConnectionTest ? '所有候选 URL 均无法验证连接' : '所有候选 URL 均失败'}`);
    return {
      success: false,
      notSupported: true,
      error: asConnectionTest
        ? '无法连接到 API 服务，请检查地址与密钥'
        : '当前 API 服务不支持获取模型列表，请手动输入模型名称'
    };
  };

  // 测试 Claude API 连接（参考 cc-switch：用 GET /v1/models 验证，不发推理请求）
  ipcMain.handle('claude-test-connection', async (event, apiUrl, apiKey, model) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [claude-test-connection] 测试连接: ${apiUrl} (通过 GET /v1/models 验证)`);

    const result = await fetchClaudeModelsInternal(apiUrl, apiKey, 'claude-test-connection', true);
    if (result.success) {
      console.log(`[${timestamp}] [claude-test-connection] 连接正常, 可用模型 ${result.models.length} 个`);
      return { success: true, model: model || result.models[0], models: result.models };
    }
    console.error(`[${timestamp}] [claude-test-connection] 连接失败:`, result.error);
    return { success: false, error: result.error };
  });

  // 获取可用模型列表（参考 cc-switch 的多候选 URL 策略）
  ipcMain.handle('claude-fetch-models', async (event, apiUrl, apiKey) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [claude-fetch-models] 获取模型列表: ${apiUrl}`);
    return await fetchClaudeModelsInternal(apiUrl, apiKey, 'claude-fetch-models');
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

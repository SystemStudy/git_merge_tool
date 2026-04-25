const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const isDev = require('electron-is-dev');
const path = require('path');
const Store = require('electron-store');
const simpleGit = require('simple-git');
const fs = require('fs');
const fsPromises = require('fs').promises;
const axios = require('axios');
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
      defaultDeleteSourceEnabled: true
    }
  }
});

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
        console.warn(prefix, message);
        break;
      default:
        console.log(prefix, message);
    }
  });

  // 移除菜单栏
  mainWindow.setMenuBarVisibility(false);
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
    await currentGit.pull('origin', branch);
    return { success: true };
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

  ipcMain.handle('git-has-uncommitted-changes', async () => {
    if (!currentGit) throw new Error('未打开项目');

    // 先清理任何可能的 cherry-pick 残留状态，避免干扰检测
    try {
      await currentGit.raw(['cherry-pick', '--abort']);
    } catch {
      // 没有正在进行的 cherry-pick，忽略
    }

    // 使用 git status --porcelain 精确检测当前模块下是否有真实的未提交变更（排除 .trae 目录）
    const status = await currentGit.raw(['status', '--porcelain', '.', ':(exclude).trae']);
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
    console.log(`[${timestamp}] [git-check-commits-in-branch] 通过commit信息检查提交是否存在: ${branch}`);

    if (!currentGit) throw new Error('未打开项目');

    try {
      const logOutput = await currentGit.raw(['log', branch, '--format=%s', '-n', '5000']);
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

  ipcMain.handle('gitlab-create-merge-request', async (event, serverUrl, token, projectId, sourceBranch, targetBranch, title, description, removeSourceBranch = true) => {
    try {
      // projectId 已经从前端编码过，这里直接使用
      const response = await axios.post(
        `${serverUrl}/api/v4/projects/${projectId}/merge_requests`,
        {
          source_branch: sourceBranch,
          target_branch: targetBranch,
          title: title,
          description: description,
          should_remove_source_branch: removeSourceBranch
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
}

// 应用生命周期
app.whenReady().then(() => {
  createWindow();
  setupIpcHandlers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  closeLogger();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

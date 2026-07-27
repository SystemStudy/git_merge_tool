const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { formatTimestamp } = require('./utils');

function getRepoCacheDir(repoId) {
  return path.join(os.tmpdir(), 'git-merge-tool-repos', repoId);
}

function ensureCacheBaseDir() {
  const baseDir = path.join(os.tmpdir(), 'git-merge-tool-repos');
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
}

module.exports = function registerRemoteRepoHandlers(ipcMain, { store, getProjectPath }) {
  // 获取当前项目的仓库列表（含一次性迁移逻辑）
  // 若该项目无专属配置，则将全局 remoteRepos 复制为初始值
  function getProjectRepos(projectPath) {
    if (!projectPath) return [];
    const projectsRepos = store.get('projectsRepos', {});
    if (projectsRepos[projectPath]) {
      return projectsRepos[projectPath];
    }
    // 一次性迁移：首次访问该项目时，将全局 remoteRepos 复制为该项目初始配置
    const globalRepos = store.get('remoteRepos', []);
    projectsRepos[projectPath] = [...globalRepos];
    store.set('projectsRepos', projectsRepos);
    console.log(`[remote-repos] 首次访问项目 ${projectPath}，已迁移全局 ${globalRepos.length} 个仓库为项目初始配置`);
    return globalRepos;
  }

  function setProjectRepos(projectPath, repos) {
    if (!projectPath) return;
    const projectsRepos = store.get('projectsRepos', {});
    projectsRepos[projectPath] = repos;
    store.set('projectsRepos', projectsRepos);
  }

  ipcMain.handle('remote-repos:list', async () => {
    const timestamp = formatTimestamp();
    const projectPath = getProjectPath();
    console.log(`[${timestamp}] [remote-repos:list] 获取项目仓库列表: ${projectPath || '(无项目)'}`);
    try {
      const repos = getProjectRepos(projectPath);
      console.log(`[${timestamp}] [remote-repos:list] 共 ${repos.length} 个仓库`);
      return repos;
    } catch (error) {
      console.error(`[${timestamp}] [remote-repos:list] 错误: ${error.message}`);
      return [];
    }
  });

  ipcMain.handle('remote-repos:save', async (event, repos) => {
    const timestamp = formatTimestamp();
    const projectPath = getProjectPath();
    console.log(`[${timestamp}] [remote-repos:save] 保存项目仓库列表: ${projectPath || '(无项目)'}，共 ${repos.length} 个`);
    if (!projectPath) {
      return { success: false, error: '未打开项目，无法保存仓库配置' };
    }
    try {
      setProjectRepos(projectPath, repos);
      return { success: true };
    } catch (error) {
      console.error(`[${timestamp}] [remote-repos:save] 错误: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('remote-repos:clone', async (event, { url, repoId }) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [remote-repos:clone] 准备仓库: ${url}`);
    ensureCacheBaseDir();

    const repoPath = getRepoCacheDir(repoId);

    try {
      if (fs.existsSync(repoPath) && fs.existsSync(path.join(repoPath, '.git'))) {
        console.log(`[${timestamp}] [remote-repos:clone] 缓存已存在，执行 fetch: ${repoPath}`);
        const git = simpleGit(repoPath);
        await git.fetch('origin');
        console.log(`[${timestamp}] [remote-repos:clone] fetch 完成`);
        return { success: true, repoPath, isNewClone: false };
      }

      if (fs.existsSync(repoPath)) {
        fs.rmSync(repoPath, { recursive: true, force: true });
      }

      console.log(`[${timestamp}] [remote-repos:clone] 开始 clone: ${url} -> ${repoPath}`);
      await simpleGit().clone(url, repoPath);
      console.log(`[${timestamp}] [remote-repos:clone] clone 完成`);
      return { success: true, repoPath, isNewClone: true };
    } catch (error) {
      console.error(`[${timestamp}] [remote-repos:clone] 错误: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('remote-repos:get-branches', async (event, { repoPath }) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [remote-repos:get-branches] 获取分支列表: ${repoPath}`);
    try {
      const git = simpleGit(repoPath);
      const branches = await git.branch(['-a']);
      const cleanedBranches = branches.all.map(b => b.replace('remotes/origin/', '')).filter((v, i, a) => a.indexOf(v) === i);
      console.log(`[${timestamp}] [remote-repos:get-branches] 获取到 ${cleanedBranches.length} 个分支`);
      return cleanedBranches;
    } catch (error) {
      console.error(`[${timestamp}] [remote-repos:get-branches] 错误: ${error.message}`);
      throw error;
    }
  });

  ipcMain.handle('remote-repos:cherry-pick-push', async (event, { repoPath, branch, commitShas, sourceProjectPath }) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [remote-repos:cherry-pick-push] 开始操作: repo=${repoPath}, branch=${branch}, commits=${commitShas.length}, source=${sourceProjectPath}`);

    try {
      const git = simpleGit(repoPath);

      console.log(`[${timestamp}] [remote-repos:cherry-pick-push] 强制同步分支: ${branch}`);
      const remoteCheck = await git.raw(['ls-remote', '--heads', 'origin', branch]);
      if (!remoteCheck || !remoteCheck.trim()) {
        return { success: false, error: `远程分支不存在: origin/${branch}` };
      }
      await git.raw(['fetch', 'origin', branch]);
      try {
        await git.checkout(branch);
      } catch {
        await git.checkoutBranch(branch, `origin/${branch}`);
      }
      await git.raw(['reset', '--hard', `origin/${branch}`]);

      try {
        await git.raw(['cherry-pick', '--abort']);
      } catch {}

      if (sourceProjectPath) {
        console.log(`[${timestamp}] [remote-repos:cherry-pick-push] 直接从源项目路径 fetch: ${sourceProjectPath}`);
        try {
          await git.raw(['fetch', sourceProjectPath, '--no-tags']);
          console.log(`[${timestamp}] [remote-repos:cherry-pick-push] 已从源项目 fetch 提交`);
        } catch (fetchError) {
          console.error(`[${timestamp}] [remote-repos:cherry-pick-push] fetch 源项目失败: ${fetchError.message}`);
          return { success: false, error: `fetch 源项目失败: ${fetchError.message} (path=${sourceProjectPath})` };
        }

        console.log(`[${timestamp}] [remote-repos:cherry-pick-push] 验证 commit 是否存在:`);
        for (const sha of commitShas) {
          try {
            const catFileResult = await git.raw(['cat-file', '-t', sha]);
            console.log(`[${timestamp}] [remote-repos:cherry-pick-push] ${sha}: ${catFileResult.trim()}`);
          } catch (catError) {
            console.error(`[${timestamp}] [remote-repos:cherry-pick-push] ${sha} 不存在: ${catError.message}`);
            return { success: false, error: `提交 ${sha} 在源项目中不存在，无法跨仓库 cherry-pick` };
          }
        }
      } else {
        console.warn(`[${timestamp}] [remote-repos:cherry-pick-push] 未提供 sourceProjectPath，cherry-pick 可能失败`);
      }

      const results = { success: [], skipped: [], errors: [] };

      for (const sha of commitShas) {
        console.log(`[${timestamp}] [remote-repos:cherry-pick-push] cherry-pick: ${sha}`);
        try {
          await git.raw(['cherry-pick', sha]);
          results.success.push(sha);
          console.log(`[${timestamp}] [remote-repos:cherry-pick-push] 成功: ${sha}`);
        } catch (error) {
          const msg = error.message || '';
          console.error(`[${timestamp}] [remote-repos:cherry-pick-push] cherry-pick ${sha} 失败: ${msg}`);

          if (msg.includes('empty') || msg.includes('nothing to commit') || msg.includes('already exists')) {
            console.log(`[${timestamp}] [remote-repos:cherry-pick-push] 已存在，跳过: ${sha}`);
            try { await git.raw(['cherry-pick', '--skip']); } catch {}
            results.skipped.push(sha);
          } else if (msg.includes('could not apply') || msg.includes('CONFLICT') || msg.includes('conflict')) {
            console.log(`[${timestamp}] [remote-repos:cherry-pick-push] 冲突: ${sha}`);
            try {
              const diffOutput = await git.raw(['diff', '--name-only', '--diff-filter=U']);
              const conflictedFiles = diffOutput.trim().split('\n').filter(Boolean);
              results.errors.push({ sha, error: `冲突文件: ${conflictedFiles.join(', ')}`, conflictedFiles, detail: msg });
            } catch {
              results.errors.push({ sha, error: msg, detail: msg });
            }
            try { await git.raw(['cherry-pick', '--abort']); } catch {}
            results.success = [];
            break;
          } else {
            console.log(`[${timestamp}] [remote-repos:cherry-pick-push] 其他错误: ${sha} - ${msg}`);
            try { await git.raw(['cherry-pick', '--abort']); } catch {}
            results.errors.push({ sha, error: msg, detail: msg });
            results.success = [];
            break;
          }
        }
      }

      if (results.errors.length > 0) {
        console.log(`[${timestamp}] [remote-repos:cherry-pick-push] 存在错误，中止推送`);
        return { success: false, results };
      }

      console.log(`[${timestamp}] [remote-repos:cherry-pick-push] 推送到远程: ${branch}`);
      await git.push('origin', branch);
      console.log(`[${timestamp}] [remote-repos:cherry-pick-push] 推送完成`);

      return { success: true, results };
    } catch (error) {
      console.error(`[${timestamp}] [remote-repos:cherry-pick-push] 错误: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('remote-repos:create-merge-branch', async (event, { repoPath, targetBranch, mergeBranchName, commitShas, sourceProjectPath }) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [remote-repos:create-merge-branch] 开始: repo=${repoPath}, target=${targetBranch}, merge=${mergeBranchName}, commits=${commitShas.length}, source=${sourceProjectPath}`);

    try {
      const git = simpleGit(repoPath);

      console.log(`[${timestamp}] [remote-repos:create-merge-branch] 强制同步目标分支: ${targetBranch}`);
      const remoteCheck = await git.raw(['ls-remote', '--heads', 'origin', targetBranch]);
      if (!remoteCheck || !remoteCheck.trim()) {
        return { success: false, error: `远程目标分支不存在: origin/${targetBranch}` };
      }
      await git.raw(['fetch', 'origin', targetBranch]);

      try {
        await git.raw(['cherry-pick', '--abort']);
      } catch {}

      if (sourceProjectPath) {
        console.log(`[${timestamp}] [remote-repos:create-merge-branch] 从源项目 fetch: ${sourceProjectPath}`);
        try {
          await git.raw(['fetch', sourceProjectPath, '--no-tags']);
        } catch (fetchError) {
          return { success: false, error: `fetch 源项目失败: ${fetchError.message} (path=${sourceProjectPath})` };
        }
        for (const sha of commitShas) {
          try {
            await git.raw(['cat-file', '-t', sha]);
          } catch {
            return { success: false, error: `提交 ${sha} 在源项目中不存在` };
          }
        }
      }

      console.log(`[${timestamp}] [remote-repos:create-merge-branch] 创建合并分支: ${mergeBranchName} 基于 origin/${targetBranch}`);
      try {
        await git.raw(['checkout', '-B', mergeBranchName, `origin/${targetBranch}`]);
      } catch (checkoutError) {
        console.error(`[${timestamp}] [remote-repos:create-merge-branch] 创建分支失败: ${checkoutError.message}`);
        return { success: false, error: `创建分支失败: ${checkoutError.message}` };
      }

      const results = { success: [], skipped: [], errors: [] };

      for (const sha of commitShas) {
        console.log(`[${timestamp}] [remote-repos:create-merge-branch] cherry-pick: ${sha}`);
        try {
          await git.raw(['cherry-pick', sha]);
          results.success.push(sha);
          console.log(`[${timestamp}] [remote-repos:create-merge-branch] 成功: ${sha}`);
        } catch (error) {
          const msg = error.message || '';
          console.error(`[${timestamp}] [remote-repos:create-merge-branch] cherry-pick ${sha} 失败: ${msg}`);
          if (msg.includes('empty') || msg.includes('nothing to commit') || msg.includes('already exists')) {
            try { await git.raw(['cherry-pick', '--skip']); } catch {}
            results.skipped.push(sha);
          } else if (msg.includes('could not apply') || msg.includes('CONFLICT') || msg.includes('conflict')) {
            try {
              const diffOutput = await git.raw(['diff', '--name-only', '--diff-filter=U']);
              const conflictedFiles = diffOutput.trim().split('\n').filter(Boolean);
              results.errors.push({ sha, error: `冲突文件: ${conflictedFiles.join(', ')}`, detail: msg });
            } catch {
              results.errors.push({ sha, error: msg, detail: msg });
            }
            try { await git.raw(['cherry-pick', '--abort']); } catch {}
            results.success = [];
            break;
          } else {
            try { await git.raw(['cherry-pick', '--abort']); } catch {}
            results.errors.push({ sha, error: msg, detail: msg });
            results.success = [];
            break;
          }
        }
      }

      if (results.errors.length > 0) {
        console.log(`[${timestamp}] [remote-repos:create-merge-branch] 存在错误，不推送`);
        return { success: false, results };
      }

      console.log(`[${timestamp}] [remote-repos:create-merge-branch] 推送合并分支到远程: ${mergeBranchName}`);
      await git.push('origin', mergeBranchName);
      console.log(`[${timestamp}] [remote-repos:create-merge-branch] 推送完成`);

      let remoteUrl = '';
      try {
        const remotes = await git.getRemotes(true);
        const origin = remotes.find(r => r.name === 'origin');
        remoteUrl = origin?.refs?.fetch || origin?.refs?.push || '';
      } catch (e) {
        console.warn(`[${timestamp}] [remote-repos:create-merge-branch] 获取 remoteUrl 失败: ${e.message}`);
      }

      return { success: true, results, mergeBranchName, remoteUrl };
    } catch (error) {
      console.error(`[${timestamp}] [remote-repos:create-merge-branch] 错误: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('remote-repos:clear-cache', async () => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [remote-repos:clear-cache] 清理缓存目录`);
    try {
      const baseDir = path.join(os.tmpdir(), 'git-merge-tool-repos');
      if (fs.existsSync(baseDir)) {
        fs.rmSync(baseDir, { recursive: true, force: true });
      }
      console.log(`[${timestamp}] [remote-repos:clear-cache] 清理完成`);
      return { success: true };
    } catch (error) {
      console.error(`[${timestamp}] [remote-repos:clear-cache] 错误: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('remote-repos:test-connection', async (event, { url }) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [remote-repos:test-connection] 测试连接: ${url}`);
    try {
      const result = await simpleGit().raw(['ls-remote', '--heads', url]);
      const branchCount = result.trim().split('\n').filter(Boolean).length;
      console.log(`[${timestamp}] [remote-repos:test-connection] 连接成功，远程分支数: ${branchCount}`);
      return { success: true, branchCount };
    } catch (error) {
      console.error(`[${timestamp}] [remote-repos:test-connection] 连接失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
};

/**
 * Git 操作相关 IPC handlers
 */
const { formatTimestamp } = require('./utils');

module.exports = function registerGitHandlers(ipcMain, { getGit, getProjectPath }) {
  ipcMain.handle('git-get-branches', async () => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-get-branches] 开始获取分支列表`);

    if (!getGit()) {
      console.error(`[${timestamp}] [git-get-branches] 错误: 未打开项目`);
      throw new Error('未打开项目');
    }

    try {
      const git = getGit();
      const branches = await git.branch(['-a']);
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

    if (!getGit()) {
      console.error(`[${timestamp}] [git-get-current-branch] 错误: 未打开项目`);
      throw new Error('未打开项目');
    }

    try {
      const git = getGit();
      const status = await git.status();
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

    if (!getGit()) {
      console.error(`[${timestamp}] [git-get-user-config] 错误: 未打开项目`);
      throw new Error('未打开项目');
    }

    try {
      const git = getGit();
      const nameResult = await git.getConfig('user.name');
      const emailResult = await git.getConfig('user.email');

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

    if (!getGit()) {
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
      const git = getGit();
      console.log(`[${timestamp}] [git-get-commits] 正在执行 git log 命令...`);

      // 只使用本地分支名称，排除远程分支
      let branchToUse = branch;
      if (!branch.startsWith('origin/') && !branch.startsWith('refs/')) {
        const localBranches = await git.branchLocal();
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
        const branches = await git.branchLocal();
        if (branches.all.includes(localBranchName)) {
          branchToUse = localBranchName;
          console.log(`[${timestamp}] [git-get-commits] 转换为本地分支: ${localBranchName}`);
        }
      }

      console.log(`[${timestamp}] [git-get-commits] 最终使用分支: "${branchToUse}"`);

      let log;
      if (skip > 0) {
        const format = '%H%n%an%n%ae%n%ad%n%s%n%b%n---END---';
        log = await git.raw([
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
            author_email: parts[2] || '',
            date: parts[3],
            message: parts[4],
            body: parts.slice(5).join('\n')
          };
        });

        log = { all: parsedCommits };
      } else {
        const format = '%H%n%an%n%ae%n%ad%n%s%n%b%n---END---';
        log = await git.raw([
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
            author_email: parts[2] || '',
            date: parts[3],
            message: parts[4],
            body: parts.slice(5).join('\n')
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

    if (!getGit()) {
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
      const git = getGit();
      let branchToUse = branch;
      if (!branch.startsWith('origin/') && !branch.startsWith('refs/')) {
        const localBranches = await git.branchLocal();
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
        const localBranches = await git.branchLocal();
        if (localBranches.all.includes(localBranchName)) {
          branchToUse = localBranchName;
          console.log(`[${timestamp}] [git-get-all-commits] 转换为本地分支: ${localBranchName}`);
        }
      }

      console.log(`[${timestamp}] [git-get-all-commits] 使用分支: "${branchToUse}"`);

      const format = '%H%n%an%n%ae%n%ad%n%s%n%b%n---END---';
      const log = await git.raw([
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
          author_email: parts[2] || '',
          date: parts[3],
          message: parts[4],
          body: parts.slice(5).join('\n')
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
    if (!getGit()) throw new Error('未打开项目');
    await getGit().fetch();
    return { success: true };
  });

  ipcMain.handle('git-pull', async (event, branch) => {
    if (!getGit()) throw new Error('未打开项目');

    // 拉取前检查远程分支是否存在，避免 simple-git 抛出
    // "couldn't find remote ref <branch>" 这类晦涩错误
    let remoteExists = true;
    try {
      const remote = await getGit().raw(['ls-remote', '--heads', 'origin', branch]);
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

    const git = getGit();
    try {
      await git.pull('origin', branch);
      return { status: 'success' };
    } catch (error) {
      const msg = error.message || '';
      // 检测合并冲突：以工作区是否存在未解决冲突文件为准（与错误信息字符串解耦）
      try {
        const diffOutput = await git.raw(['diff', '--name-only', '--diff-filter=U']);
        const conflictedFiles = diffOutput.trim().split('\n').filter(Boolean);
        if (conflictedFiles.length > 0) {
          console.log(`[git-pull] 检测到合并冲突，冲突文件:`, conflictedFiles);
          return { status: 'conflict', conflictedFiles };
        }
      } catch (e) {
        console.error(`[git-pull] 获取冲突文件列表失败:`, e.message);
      }
      console.error(`[git-pull] 拉取失败: ${msg}`);
      return { status: 'error', error: msg };
    }
  });

  // 强制使用远程分支覆盖本地分支：fetch origin <branch> + reset --hard origin/<branch>
  // 用于 cherry-pick 推送 / 合并到已有远程分支 / 冲突检测 前同步目标分支，
  // 使本地分支严格等于远程最新，丢弃本地已提交但未推送的 commit。
  ipcMain.handle('git-force-sync-branch', async (event, branch) => {
    if (!getGit()) throw new Error('未打开项目');

    // 预检远程分支是否存在，与 git-pull 保持一致的错误提示
    let remoteExists = true;
    try {
      const remote = await getGit().raw(['ls-remote', '--heads', 'origin', branch]);
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
        await getGit().checkout(branch);
      } catch (e) {
        console.warn(`[git-force-sync-branch] 本地分支也不存在: ${branch}，跳过切换`);
      }
      return { success: true, remoteExists: false };
    }

    const git = getGit();
    // 拉取远程分支引用
    await git.raw(['fetch', 'origin', branch]);

    // 切换到本地分支；若本地不存在则基于 origin/<branch> 创建跟踪分支
    try {
      await git.checkout(branch);
    } catch (e) {
      await git.checkoutBranch(branch, `origin/${branch}`);
    }

    // 强制用远程分支覆盖本地分支
    await git.raw(['reset', '--hard', `origin/${branch}`]);
    return { success: true, remoteExists: true };
  });

  ipcMain.handle('git-checkout', async (event, branch) => {
    if (!getGit()) throw new Error('未打开项目');
    await getGit().checkout(branch);
    return { success: true };
  });

  ipcMain.handle('git-push', async (event, branch) => {
    if (!getGit()) throw new Error('未打开项目');
    
    const maxRetries = 2;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[git-push] 第 ${attempt} 次尝试推送分支 ${branch}`);
        
        // 使用 push 的数组参数形式，添加 --porcelain 获取标准化输出
        await getGit().push(['origin', branch, '--porcelain']);
        
        console.log(`[git-push] 推送成功: ${branch}`);
        return { success: true };
        
      } catch (error) {
        lastError = error;
        console.error(`[git-push] 第 ${attempt} 次推送失败: ${error.message}`);
        
        // 检查是否是认证相关错误
        const isAuthError = 
          error.message.includes('403') || 
          error.message.includes('401') ||
          error.message.includes('Authentication failed') ||
          error.message.includes('could not read Username') ||
          error.message.includes('could not read Password') ||
          error.message.includes('Invalid username or password');
        
        if (isAuthError) {
          console.warn('[git-push] 检测到认证失败');
          
          // 如果不是最后一次尝试，等待后重试
          if (attempt < maxRetries) {
            console.log(`[git-push] 等待 1 秒后重试...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }
          
          // 所有重试失败，抛出详细的用户友好错误
          throw new Error(
            `推送失败：Git 认证错误\n\n` +
            `错误详情：${error.message}\n\n` +
            `可能原因：\n` +
            `• HTTPS 凭证已过期或无效\n` +
            `• Windows 凭证管理器中的凭证状态异常\n` +
            `• Git Credential Manager 进程被锁定\n\n` +
            `建议操作：\n` +
            `1. 在命令行中手动执行一次 "git push origin ${branch}" 完成认证\n` +
            `2. 或打开"控制面板 → 凭据管理器 → Windows 凭据"，删除相关的 Git 凭证\n` +
            `3. 或考虑改用 SSH 方式（git@host:path）替代 HTTPS 认证\n` +
            `4. 如果问题持续，尝试重启计算机清除锁定的进程句柄`
          );
        }
        
        // 非认证错误（如 non-fast-forward、网络错误等）
        if (attempt === maxRetries) {
          throw new Error(
            `推送失败: ${error.message}\n\n` +
            `请检查：\n` +
            `• 是否需要先拉取远程更新（git pull）\n` +
            `• 是否存在冲突需要手动解决\n` +
            `• 网络连接是否正常`
          );
        }
        
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // 理论上不会到达这里
    throw lastError || new Error('推送失败：未知错误');
  });

  ipcMain.handle('git-create-branch', async (event, branchName, baseBranch) => {
    if (!getGit()) throw new Error('未打开项目');
    await getGit().checkoutBranch(branchName, baseBranch || 'HEAD');
    return { success: true };
  });

  ipcMain.handle('git-check-branch-name-conflict', async (event, branchName) => {
    if (!getGit()) throw new Error('未打开项目');
    try {
      const git = getGit();
      const result = await git.raw(['ls-remote', '--heads', 'origin']);
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
    if (!getGit()) throw new Error('未打开项目');
    try {
      const git = getGit();
      // 预检远程分支是否存在
      const remote = await git.raw(['ls-remote', '--heads', 'origin', branchName]);
      if (!remote || !remote.trim()) {
        console.log(`[git-fetch-branch] 远程分支不存在: origin/${branchName}，跳过拉取`);
        return { success: true, remoteExists: false };
      }
      await git.raw(['fetch', 'origin', branchName]);
      return { success: true, remoteExists: true };
    } catch (error) {
      console.error(`[git-fetch-branch] 拉取远程分支 ${branchName} 失败: ${error.message}`);
      throw new Error(`拉取远程分支 ${branchName} 失败: ${error.message}`);
    }
  });

  ipcMain.handle('git-delete-local-branch', async (event, branchName, force = false) => {
    if (!getGit()) throw new Error('未打开项目');
    try {
      const git = getGit();
      // 先尝试普通删除
      await git.deleteLocalBranch(branchName);
      return { success: true };
    } catch (error) {
      // 如果普通删除失败（如分支未合并），尝试强制删除
      if (force || error.message.includes('not fully merged')) {
        console.log(`[git-delete-local-branch] 普通删除失败，强制删除分支: ${branchName}`);
        await getGit().raw(['branch', '-D', branchName]);
        return { success: true };
      }
      console.error(`[git-delete-local-branch] 删除分支 ${branchName} 失败:`, error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('git-delete-remote-branch', async (event, branchName) => {
    if (!getGit()) throw new Error('未打开项目');
    try {
      await getGit().push(['origin', '--delete', branchName]);
      return { success: true };
    } catch (error) {
      console.error(`[git-delete-remote-branch] 删除远程分支 ${branchName} 失败:`, error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('git-has-uncommitted-changes', async () => {
    if (!getGit()) throw new Error('未打开项目');

    const git = getGit();

    // 先清理任何可能的 cherry-pick 残留状态，避免干扰检测
    try {
      await git.raw(['cherry-pick', '--abort']);
    } catch {
      // 没有正在进行的 cherry-pick，忽略
    }

    const status = await git.raw(['status', '--porcelain', '.']);
    return status.trim().length > 0;
  });

  // 检查当前分支相对于目标远程分支是否有新的提交
  ipcMain.handle('git-check-has-new-commits', async (event, targetBranch) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-check-has-new-commits] 检查是否有新提交: ${targetBranch}`);

    if (!getGit()) throw new Error('未打开项目');

    try {
      const result = await getGit().raw(['rev-list', '--count', `origin/${targetBranch}..HEAD`]);
      const count = parseInt(result.trim(), 10) || 0;
      console.log(`[${timestamp}] [git-check-has-new-commits] 新提交数量: ${count}`);
      return { hasNewCommits: count > 0, count };
    } catch (error) {
      // 如果 origin/xxx 不存在（首次推送），说明一定有新提交
      console.log(`[${timestamp}] [git-check-has-new-commits] 检查失败(可能是首次推送), 认为有新提交: ${error.message}`);
      return { hasNewCommits: true, count: 1 };
    }
  });

  // 检查远程分支领先本地多少提交（本地落后远程的提交数）
  ipcMain.handle('git-check-behind', async (event, targetBranch) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-check-behind] 检查远程领先提交数: ${targetBranch}`);

    if (!getGit()) throw new Error('未打开项目');

    try {
      const result = await getGit().raw(['rev-list', '--count', `HEAD..origin/${targetBranch}`]);
      const count = parseInt(result.trim(), 10) || 0;
      console.log(`[${timestamp}] [git-check-behind] 远程领先提交数: ${count}`);
      return { behind: count > 0, count };
    } catch (error) {
      // origin/xxx 不存在或引用未更新，认为无远程新提交
      console.log(`[${timestamp}] [git-check-behind] 检查失败(可能是远程引用不存在), 认为无新提交: ${error.message}`);
      return { behind: false, count: 0 };
    }
  });

  ipcMain.handle('git-stash-create', async (event, message) => {
    if (!getGit()) throw new Error('未打开项目');
    await getGit().stash(['save', message]);
    return { success: true };
  });

  ipcMain.handle('git-stash-pop', async () => {
    if (!getGit()) throw new Error('未打开项目');
    await getGit().stash(['pop']);
    return { success: true };
  });

  ipcMain.handle('git-get-remote-url', async () => {
    if (!getGit()) throw new Error('未打开项目');
    const remotes = await getGit().getRemotes(true);
    const origin = remotes.find(r => r.name === 'origin');
    return origin ? origin.refs.fetch : '';
  });

  ipcMain.handle('git-commit-exists', async (event, branch, commitHash) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-commit-exists] 检查提交是否存在: ${commitHash} in ${branch}`);

    if (!getGit()) throw new Error('未打开项目');

    try {
      const result = await getGit().raw(['branch', '--contains', commitHash, '--list', branch]);
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

    if (!getGit()) throw new Error('未打开项目');

    try {
      const logOutput = await getGit().raw(['log', `origin/${branch}`, '--format=%s', '-n', '5000']);
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

    if (!getGit()) throw new Error('未打开项目');

    const git = getGit();

    // 清理可能的 cherry-pick 残留状态
    try {
      await git.raw(['cherry-pick', '--abort']);
    } catch {
      // 无需清理，忽略
    }

    try {
      await git.raw(['cherry-pick', sha]);
      console.log(`[${timestamp}] [git-cherry-pick-single] 成功: ${sha}`);
      return { status: 'success', sha };
    } catch (error) {
      const msg = error.message || '';

      // 已存在的提交（空操作）
      if (msg.includes('empty') || msg.includes('nothing to commit') || msg.includes('already exists')) {
        console.log(`[${timestamp}] [git-cherry-pick-single] 提交已存在，跳过: ${sha}`);
        try { await git.raw(['cherry-pick', '--skip']); } catch {}
        return { status: 'skipped', sha };
      }

      // 检测冲突
      if (msg.includes('could not apply') || msg.includes('CONFLICT') || msg.includes('conflict')) {
        console.log(`[${timestamp}] [git-cherry-pick-single] 检测到冲突: ${sha}`);
        try {
          const diffOutput = await git.raw(['diff', '--name-only', '--diff-filter=U']);
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
      try { await git.raw(['cherry-pick', '--abort']); } catch {}
      return { status: 'error', sha, error: msg };
    }
  });

  ipcMain.handle('git-cherry-pick-continue', async () => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-cherry-pick-continue] 继续 cherry-pick`);

    const { exec } = require('child_process');

    if (!getGit() || !getProjectPath()) throw new Error('未打开项目');

    try {
      await getGit().raw(['add', '-A']);
      await new Promise((resolve, reject) => {
        exec('git -c core.editor=true cherry-pick --continue', { cwd: getProjectPath() }, (err) => {
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

    if (!getGit()) throw new Error('未打开项目');

    try {
      await getGit().raw(['cherry-pick', '--abort']);
      return { success: true };
    } catch (error) {
      console.error(`[${timestamp}] [git-cherry-pick-abort] 失败: ${error.message}`);
      return { success: true };
    }
  });

  // 解决 merge 冲突后继续合并（用于 pull 产生的 merge 冲突）
  ipcMain.handle('git-merge-continue', async () => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-merge-continue] 继续 merge`);

    const { exec } = require('child_process');

    if (!getGit() || !getProjectPath()) throw new Error('未打开项目');

    try {
      await getGit().raw(['add', '-A']);
      await new Promise((resolve, reject) => {
        exec('git -c core.editor=true merge --continue', { cwd: getProjectPath() }, (err) => {
          if (err) reject(err); else resolve();
        });
      });
      console.log(`[${timestamp}] [git-merge-continue] 成功`);
      return { success: true };
    } catch (error) {
      console.error(`[${timestamp}] [git-merge-continue] 失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // 放弃 merge（用于 pull 产生的 merge 冲突）
  ipcMain.handle('git-merge-abort', async () => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-merge-abort] 中止 merge`);

    if (!getGit()) throw new Error('未打开项目');

    try {
      await getGit().raw(['merge', '--abort']);
      return { success: true };
    } catch (error) {
      console.error(`[${timestamp}] [git-merge-abort] 失败: ${error.message}`);
      return { success: true };
    }
  });

  ipcMain.handle('git-amend-author', async (event, authorName, authorEmail) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-amend-author] 修改 HEAD author 为: ${authorName} <${authorEmail}>`);

    if (!getGit()) throw new Error('未打开项目');

    try {
      await getGit().raw([
        'commit', '--amend', '--no-edit',
        `--author=${authorName} <${authorEmail}>`
      ]);
      console.log(`[${timestamp}] [git-amend-author] 成功`);
      return { success: true };
    } catch (error) {
      console.error(`[${timestamp}] [git-amend-author] 失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('git-get-head-sha', async () => {
    if (!getGit()) throw new Error('未打开项目');
    const sha = (await getGit().raw(['rev-parse', 'HEAD'])).trim();
    return { sha };
  });
};

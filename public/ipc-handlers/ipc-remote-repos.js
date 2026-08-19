const simpleGit = require('simple-git');
const { formatTimestamp } = require('./utils');

module.exports = function registerRemoteRepoHandlers(ipcMain, { getGit }) {
  // 获取当前项目的远程仓库列表（通过原生 git remote 读取，过滤默认 origin）
  ipcMain.handle('remote-repos:list', async () => {
    const timestamp = formatTimestamp();
    const git = getGit();
    if (!git) {
      console.log(`[${timestamp}] [remote-repos:list] 未打开项目，返回空列表`);
      return [];
    }
    try {
      const remotes = await git.getRemotes(true);
      const repos = remotes
        .filter(r => r.name !== 'origin')
        .map(r => ({
          id: r.name,
          name: r.name,
          url: (r.refs && (r.refs.fetch || r.refs.push)) || ''
        }));
      console.log(`[${timestamp}] [remote-repos:list] 共 ${repos.length} 个远程仓库（已过滤 origin）`);
      return repos;
    } catch (error) {
      console.error(`[${timestamp}] [remote-repos:list] 错误: ${error.message}`);
      return [];
    }
  });

  // 添加远程仓库：git remote add <name> <url>
  ipcMain.handle('remote-repos:add', async (event, { name, url }) => {
    const timestamp = formatTimestamp();
    const git = getGit();
    if (!git) {
      return { success: false, error: '未打开项目，无法添加远程仓库' };
    }
    console.log(`[${timestamp}] [remote-repos:add] 添加远程仓库: ${name} -> ${url}`);
    try {
      await git.raw(['remote', 'add', name, url]);
      return { success: true };
    } catch (error) {
      console.error(`[${timestamp}] [remote-repos:add] 错误: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // 编辑远程仓库：改名用 git remote rename，改地址用 git remote set-url
  ipcMain.handle('remote-repos:update', async (event, { oldName, name, url }) => {
    const timestamp = formatTimestamp();
    const git = getGit();
    if (!git) {
      return { success: false, error: '未打开项目，无法编辑远程仓库' };
    }
    console.log(`[${timestamp}] [remote-repos:update] 编辑远程仓库: ${oldName} -> ${name} (${url})`);
    try {
      if (oldName !== name) {
        await git.raw(['remote', 'rename', oldName, name]);
      }
      await git.raw(['remote', 'set-url', name, url]);
      return { success: true };
    } catch (error) {
      console.error(`[${timestamp}] [remote-repos:update] 错误: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // 删除远程仓库：git remote remove <name>
  ipcMain.handle('remote-repos:remove', async (event, { name }) => {
    const timestamp = formatTimestamp();
    const git = getGit();
    if (!git) {
      return { success: false, error: '未打开项目，无法删除远程仓库' };
    }
    console.log(`[${timestamp}] [remote-repos:remove] 删除远程仓库: ${name}`);
    try {
      await git.raw(['remote', 'remove', name]);
      return { success: true };
    } catch (error) {
      console.error(`[${timestamp}] [remote-repos:remove] 错误: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // 测试远程地址连通性：git ls-remote --heads <url>
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

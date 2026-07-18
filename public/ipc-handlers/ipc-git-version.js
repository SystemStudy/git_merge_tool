/**
 * Git 版本替换相关 IPC handlers
 */
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { formatTimestamp } = require('./utils');
const { transformInstanceofPatterns } = require('./instanceof-transform');

module.exports = function registerGitVersionHandlers(ipcMain, { getGit, getProjectPath }) {
  ipcMain.handle('git-detect-version', async (event, targetBranch, commitMessage) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-detect-version] 检测版本: branch=${targetBranch}, message=${commitMessage}`);

    if (!getGit()) throw new Error('未打开项目');

    try {
      const git = getGit();
      const branchRef = `origin/${targetBranch}`;

      const logOutput = await git.raw([
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
          const tagOutput = await git.raw([
            'tag', '--contains', sha, '-l', 'V5.*.R.*'
          ]);
          const tagNames = tagOutput.trim().split('\n').filter(Boolean);

          for (const tagName of tagNames) {
            if (!tagMap.has(tagName)) {
              const dateOutput = await git.raw([
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
        const latestTagOutput = await git.raw([
          'describe', '--tags', '--match', 'V5.*.R.*', '--abbrev=0', branchRef
        ]);
        const latestTagName = latestTagOutput.trim();
        const latestDateOutput = await git.raw([
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

  // 获取冲突文件的 ours/theirs 干净版本（用于多语言自动合并）
  ipcMain.handle('git-get-conflict-file-versions', async (event, filePaths) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [git-get-conflict-file-versions] 获取冲突文件版本: ${filePaths.length} 个文件`);

    if (!getGit() || !getProjectPath()) throw new Error('未打开项目');

    try {
      const git = getGit();
      const files = [];
      for (const filePath of filePaths) {
        let ours = '';
        let theirs = '';
        try {
          ours = await git.raw(['show', `:2:${filePath}`]);
        } catch {
          // 文件在ours侧不存在（如新文件），保持空字符串
        }
        try {
          theirs = await git.raw(['show', `:3:${filePath}`]);
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

    if (!getProjectPath()) throw new Error('未打开项目');

    try {
      const files = [];
      for (const filePath of filePaths) {
        const absPath = path.join(getProjectPath(), filePath);
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

    if (!getGit() || !getProjectPath()) throw new Error('未打开项目');

    try {
      const git = getGit();
      for (const { path: filePath, content } of files) {
        const absPath = path.join(getProjectPath(), filePath);
        fs.writeFileSync(absPath, content, 'utf-8');
        await git.raw(['add', filePath]);
        console.log(`[${timestamp}] [git-write-file-and-stage] 已处理: ${filePath}`);
      }
      return { success: true };
    } catch (error) {
      console.error(`[${timestamp}] [git-write-file-and-stage] 失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // 读取工作区 pom.xml 的 parent.version（判断当前代码基线版本）
  // 返回 { success, version?, error? }；error: 'no-pom' | 'no-parent-version' | 其他
  ipcMain.handle('git-read-pom-parent-version', async () => {
    if (!getProjectPath()) throw new Error('未打开项目');
    const pomPath = path.join(getProjectPath(), 'pom.xml');
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
    if (!getGit()) throw new Error('未打开项目');
    if (!sinceSha) throw new Error('基点 sha 不能为空');
    try {
      const out = await getGit().raw(['diff', '--name-only', sinceSha, 'HEAD']);
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
    if (!getGit() || !getProjectPath()) throw new Error('未打开项目');
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
      const git = getGit();
      for (const filePath of files) {
        const absPath = path.join(getProjectPath(), filePath);
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
        // JDK21→JDK8 降级：reverse 方向额外转换 instanceof 模式匹配（Java 16+ 语法，JDK8 不支持）
        if (direction === 'reverse') {
          const tr = transformInstanceofPatterns(result);
          if (tr.count > 0) {
            result = tr.content;
            console.log(`[${timestamp}] [git-apply-version-replacement] instanceof 降级: ${filePath} 转换 ${tr.count} 处`);
          }
          for (const sk of tr.skipped) {
            console.warn(`[${timestamp}] [git-apply-version-replacement] instanceof 跳过: ${filePath} (${sk.expr} instanceof ${sk.type} ${sk.var}) 原因: ${sk.reason}`);
          }
        }
        if (result !== content) {
          fs.writeFileSync(absPath, result, 'utf-8');
          await git.raw(['add', filePath]);
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
    if (!getGit() || !getProjectPath()) throw new Error('未打开项目');
    if (!beforePickSha) return { success: false, error: 'beforePickSha 不能为空' };

    const git = getGit();
    const projectPath = getProjectPath();

    const runExec = (cmd) => new Promise((resolve, reject) => {
      exec(cmd, { cwd: projectPath }, (err, stdout, stderr) => {
        if (err) reject(new Error(`${err.message}${stderr ? `\n${stderr}` : ''}`));
        else resolve(stdout);
      });
    });

    try {
      // 1. 暂存所有改动
      await git.raw(['add', '-A']);
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
};

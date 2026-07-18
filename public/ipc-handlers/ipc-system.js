/**
 * 系统操作相关 IPC handlers（窗口控制、设置、目录选择等）
 */
const path = require('path');
const fs = require('fs');
const { dialog, shell } = require('electron');
const archiver = require('archiver');
const { exec } = require('child_process');
const { formatTimestamp } = require('./utils');

module.exports = function registerSystemHandlers(ipcMain, { mainWindow, store, globalConfigStore, globalConfigStatus, getProjectPath, getLogFilePath, openProject }) {
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
    let recentProjects = store.get('recentProjects') || [];
    recentProjects = recentProjects.filter(p => p.path !== projectPath);
    store.set('recentProjects', recentProjects);
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

  // 获取当前项目路径
  ipcMain.handle('git-get-project-path', () => {
    return getProjectPath() || '';
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
    const fullPath = path.join(getProjectPath() || '', filePath);
    console.log(`[${timestamp}] [open-file-in-editor] 尝试打开文件: ${fullPath}`);

    if (!fs.existsSync(fullPath)) {
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
};

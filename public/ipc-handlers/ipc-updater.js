/**
 * 应用自动更新（electron-updater）相关 IPC handlers
 *
 * 覆盖两种检查来源：
 * - 静默检查（启动后自动触发）：发现新版本照常弹窗提示；无更新/网络不可达时
 *   静默结束（仅记日志），下次打开应用再重新检查，不打扰用户。
 * - 手动检查（设置中"检查更新"按钮）：结果（含失败原因）通过 update:status
 *   推送，由渲染进程提示"已是最新"或"无法访问更新服务器"。
 *
 * 更新源地址：环境变量 GIT_TOOL_UPDATE_URL > 开发环境 localhost:8899 > 生产环境
 * 更新通道：设置 updateChannel=beta 走 beta（latest-beta.yml），否则走 stable（latest.yml）
 */
const { ipcMain, app } = require('electron');
const { autoUpdater } = require('electron-updater');
const isDev = require('electron-is-dev');

const DEV_UPDATE_URL = 'http://localhost:8899';
const PROD_UPDATE_URL = 'https://mkenv.ywork.me/mkenv/gitMergeVersion/';

let getWindow = () => null;
let store = null;

// 静默检查进行中标记：期间无更新/出错不向渲染进程推送（避免打扰用户）
let silentCheckInProgress = false;
// 检查互斥锁：避免静默检查与手动检查并发触发
let checking = false;

function sendToRenderer(payload) {
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('update:status', payload);
  }
}

function resolveFeedUrl() {
  if (process.env.GIT_TOOL_UPDATE_URL) {
    return process.env.GIT_TOOL_UPDATE_URL;
  }
  return isDev ? DEV_UPDATE_URL : PROD_UPDATE_URL;
}

function resolveChannel() {
  const settings = (store && store.get('settings')) || {};
  return settings.updateChannel === 'beta' ? 'beta' : 'latest';
}

// 刷新更新源配置（每次检查前调用，保证设置中修改通道后立即生效）
function refreshFeedConfig() {
  autoUpdater.setFeedURL({ provider: 'generic', url: resolveFeedUrl(), channel: resolveChannel() });
}

function initAutoUpdater() {
  // 检查到新版本后不自动下载，由用户确认后 downloadUpdate()
  autoUpdater.autoDownload = false;
  // 开发模式（未打包）下也允许检查更新，便于本地联调
  autoUpdater.forceDevUpdateConfig = true;

  refreshFeedConfig();

  autoUpdater.on('checking-for-update', () => {
    sendToRenderer({ status: 'checking' });
  });

  // 静默/手动检查发现新版本都推送（有更新值得提示用户）
  autoUpdater.on('update-available', (info) => {
    sendToRenderer({
      status: 'available',
      version: info.version,
      currentVersion: app.getVersion(),
      releaseDate: info.releaseDate || null,
      channel: resolveChannel(),
    });
  });

  // 静默检查无更新时不打扰用户，仅手动检查时提示
  autoUpdater.on('update-not-available', () => {
    if (silentCheckInProgress) return;
    sendToRenderer({ status: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer({
      status: 'downloading',
      percent: Math.round(progress.percent * 10) / 10,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendToRenderer({ status: 'downloaded', version: info.version });
  });

  // 静默检查期间的错误不推送（网络不可达时保持安静，下次启动再检查）
  autoUpdater.on('error', (error) => {
    const message = error && error.message ? error.message : String(error);
    if (silentCheckInProgress) {
      console.error(`[${new Date().toISOString()}] [autoUpdater] 静默检查更新失败（不提示用户）: ${message}`);
      return;
    }
    console.error(`[${new Date().toISOString()}] [autoUpdater] 更新出错: ${message}`);
    sendToRenderer({ status: 'error', message });
  });
}

/**
 * 静默检查更新：网络不可达时静默结束（仅日志），下次启动重新检查。
 * 发现新版本时由 update-available 事件驱动渲染进程弹窗。
 */
async function checkForUpdatesSilently() {
  if (checking) return;
  checking = true;
  silentCheckInProgress = true;
  try {
    refreshFeedConfig();
    console.debug(`[${new Date().toISOString()}] [autoUpdater] 静默检查更新: feed=${resolveFeedUrl()}, channel=${resolveChannel()}`);
    await autoUpdater.checkForUpdates();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [autoUpdater] 静默检查更新失败（下次启动重试）: ${error.message || error}`);
  } finally {
    checking = false;
    silentCheckInProgress = false;
  }
}

module.exports = function registerUpdaterHandlers(ipcMainRef, { getWindow: getWindowRef, store: storeRef }) {
  getWindow = getWindowRef;
  store = storeRef;
  initAutoUpdater();

  // 手动检查更新（设置中"检查更新"按钮）：结果通过 update:status 事件推送
  ipcMainRef.handle('app:check-update', () => {
    if (checking) {
      return { success: true, message: '正在检查更新中，请稍候' };
    }
    checking = true;
    silentCheckInProgress = false;
    refreshFeedConfig();
    autoUpdater.checkForUpdates().catch((error) => {
      console.error(`[${new Date().toISOString()}] [autoUpdater] 手动检查更新失败: ${error.message || error}`);
    }).finally(() => {
      checking = false;
    });
    return { success: true };
  });

  // 用户确认后下载更新（失败时渲染进程会收到 update:status error）
  ipcMainRef.handle('app:download-update', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message || String(error) };
    }
  });

  // 立即重启并安装已下载的更新
  ipcMainRef.handle('app:install-update', () => {
    autoUpdater.quitAndInstall(true, true);
    return { success: true };
  });

  // 供调试/设置界面展示当前更新源信息
  ipcMainRef.handle('app:get-update-info', () => ({
    currentVersion: app.getVersion(),
    feedUrl: resolveFeedUrl(),
    channel: resolveChannel(),
    isDev,
  }));

  return { checkForUpdatesSilently };
};

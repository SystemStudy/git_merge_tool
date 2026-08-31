/**
 * 日志模块：基于 electron-log，接管主进程 console 输出
 * - 开发环境（electron-dev）: 打印 debug 及以上级别
 * - 生产环境（打包产物）: 仅打印 warn 及以上级别
 * - 日志文件: 单文件上限 50MB（超出轮转为 <日期>.old.log），按天分片
 */
const path = require('path');
const log = require('electron-log/main');
const isDev = require('electron-is-dev');

let initialized = false;

function initLogger() {
  if (initialized) {
    return;
  }
  initialized = true;

  // 不注入 renderer preload：本项目 preload 由 public/preload.js 自行实现，renderer 日志无需落盘
  log.initialize({ preload: false });

  // 级别过滤：开发环境 debug，生产环境 warn
  const minLevel = isDev ? 'debug' : 'warn';
  log.transports.console.level = minLevel;
  log.transports.file.level = minLevel;

  // 单文件上限 50MB，按天分片（跨天时自动写入新文件）
  log.transports.file.maxSize = 50 * 1024 * 1024;
  log.transports.file.resolvePathFn = (variables, message) => {
    const date = (message && message.date) || new Date();
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return path.join(variables.libraryDefaultDir, `${day}.log`);
  };

  // 接管全局 console：业务代码中的 console.* 统一进入 electron-log
  console.log = log.log;
  console.info = log.info;
  console.warn = log.warn;
  console.error = log.error;
  console.debug = log.debug;

  log.debug(`[Logger] 日志目录: ${path.dirname(getLogFilePath())}`);
}

function getLogFilePath() {
  return log.transports.file.getFile().path;
}

function closeLogger() {
  // electron-log 文件 transport 默认同步写入，无需手动关闭
}

module.exports = { initLogger, getLogFilePath, closeLogger };

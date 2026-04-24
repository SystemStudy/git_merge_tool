const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_DIR = path.join(os.tmpdir(), 'git-merge-assistant', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

let logStream = null;

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function cleanOldLogs() {
  try {
    if (fs.existsSync(LOG_DIR)) {
      const files = fs.readdirSync(LOG_DIR);
      files.forEach(file => {
        const filePath = path.join(LOG_DIR, file);
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          // ignore
        }
      });
    }
  } catch (e) {
    // ignore
  }
}

function initLogger() {
  ensureLogDir();
  cleanOldLogs();

  logStream = fs.createWriteStream(LOG_FILE, { flags: 'a', encoding: 'utf8' });
  logStream.on('error', () => {});

  const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug
  };

  function formatArgs(args) {
    return args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
  }

  function writeToFile(level, args) {
    if (!logStream) return;
    const timestamp = new Date().toISOString();
    const message = formatArgs(args);
    logStream.write(`[${timestamp}] [${level}] ${message}\n`);
  }

  console.log = function (...args) {
    originalConsole.log.apply(console, args);
    writeToFile('LOG', args);
  };

  console.error = function (...args) {
    originalConsole.error.apply(console, args);
    writeToFile('ERROR', args);
  };

  console.warn = function (...args) {
    originalConsole.warn.apply(console, args);
    writeToFile('WARN', args);
  };

  console.info = function (...args) {
    originalConsole.info.apply(console, args);
    writeToFile('INFO', args);
  };

  console.debug = function (...args) {
    originalConsole.debug.apply(console, args);
    writeToFile('DEBUG', args);
  };

  console.log(`[Logger] 日志文件: ${LOG_FILE}`);
}

function getLogFilePath() {
  return LOG_FILE;
}

function closeLogger() {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
}

module.exports = { initLogger, getLogFilePath, closeLogger, LOG_DIR };

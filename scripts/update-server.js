/**
 * 开发环境更新源服务器
 *
 * 在 8899 端口托管 dist/ 目录，模拟生产环境的更新服务器。
 * 开发模式下应用会从 http://localhost:8899 检查更新（与生产地址自动切换）。
 *
 * 用法：
 *   1. 先构建安装包: npm run electron-build-win（产物在 dist/ 下，含 latest.yml）
 *   2. 启动本服务器: npm run update-server
 *   3. 以开发模式启动应用: npm run electron-dev，启动约 8 秒后应用会静默检查更新
 *      （若本地 latest.yml 中的版本高于当前 package.json 版本，即会提示更新）
 *
 * 注意：本地模拟更新只能验证"检查"与"下载"逻辑；"安装"需在打包后的应用中验证。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8899;
const DIST_DIR = path.join(__dirname, '..', 'dist');

const MIME_MAP = {
  '.yml': 'text/yaml',
  '.yaml': 'text/yaml',
  '.json': 'application/json',
  '.exe': 'application/octet-stream',
  '.dmg': 'application/octet-stream',
  '.zip': 'application/zip',
  '.blockmap': 'application/octet-stream',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const filePath = path.resolve(path.join(DIST_DIR, urlPath));

  // 防目录穿越
  if (!filePath.startsWith(path.resolve(DIST_DIR))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end('Not Found: ' + urlPath);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME_MAP[path.extname(filePath)] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`[update-server] 更新源已启动: http://localhost:${PORT}/`);
  console.log(`[update-server] 托管目录: ${DIST_DIR}`);
  console.log(`[update-server] 开发模式应用会自动从该地址检查更新（localhost:8899）`);
});

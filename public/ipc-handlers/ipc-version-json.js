/**
 * version.json 维护相关 IPC handlers
 * 入库合并到非 develop 分支时，在合并分支根目录的 version.json 的 relations 数组中追加一条记录
 */
const path = require('path');
const fs = require('fs');
const { formatTimestamp } = require('./utils');

// 去除 UTF-8 BOM
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// 序列化 version.json：4 空格缩进，但 relations 各条目的 relationModules 数组单行展示。
// 做法是先把数组替换成唯一占位字符串参与序列化，再把占位串换回单行 JSON，
// 避免用正则直接匹配已序列化的多行数组（模块名含特殊字符时会误伤）。
function stringifyVersionJson(json) {
  const placeholders = [];
  const toSerialize = {
    ...json,
    relations: (json.relations || []).map((rel, index) => {
      if (!rel || !Array.isArray(rel.relationModules)) return rel;
      const token = `__RELATION_MODULES_${index}__`;
      placeholders.push({ token, value: JSON.stringify(rel.relationModules) });
      return { ...rel, relationModules: token };
    })
  };

  let text = JSON.stringify(toSerialize, null, 4);
  for (const { token, value } of placeholders) {
    text = text.replace(`"${token}"`, value);
  }
  return `${text}\n`;
}

// 从 git remote origin 的 URL 中提取仓库名（不含 .git 后缀）
async function readRepoName(git) {
  try {
    const remotes = await git.getRemotes(true);
    const origin = remotes.find(r => r.name === 'origin') || remotes[0];
    const url = origin?.refs?.fetch || origin?.refs?.push || '';
    if (!url) return null;
    const match = url.replace(/\/+$/, '').match(/([^/:]+?)(?:\.git)?$/);
    return match ? match[1] : null;
  } catch (error) {
    console.warn(`[readRepoName] 读取远程仓库名失败: ${error.message}`);
    return null;
  }
}

// 从项目根目录 deploy.xml 的 <module><name>模块名</name></module> 中读取模块名
function readModuleNameFromDeployXml(projectPath) {
  const deployPath = path.join(projectPath, 'deploy.xml');
  if (!fs.existsSync(deployPath)) return null;
  try {
    const content = stripBom(fs.readFileSync(deployPath, 'utf-8'));
    const match = content.match(/<module\b[^>]*>[\s\S]*?<name>([\s\S]*?)<\/name>/);
    const name = match?.[1]?.trim();
    return name || null;
  } catch (error) {
    console.warn(`[readModuleNameFromDeployXml] 解析 deploy.xml 失败: ${error.message}`);
    return null;
  }
}

// 从项目根目录 package.json 的 description 中读取模块名
function readModuleNameFromPackageJson(projectPath) {
  const pkgPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(stripBom(fs.readFileSync(pkgPath, 'utf-8')));
    const desc = typeof pkg.description === 'string' ? pkg.description.trim() : '';
    return desc || null;
  } catch (error) {
    console.warn(`[readModuleNameFromPackageJson] 解析 package.json 失败: ${error.message}`);
    return null;
  }
}

module.exports = function registerVersionJsonHandlers(ipcMain, { getGit, getProjectPath }) {
  /**
   * 在当前工作区（已 checkout 到合并分支）的根目录 version.json 中追加一条 relations 记录。
   * version.json 不存在时按默认模板新建（moduleId 取远程仓库名，moduleName 依次尝试
   * deploy.xml / package.json / 调用方传入的 moduleName）。
   *
   * params: { issue, date, relationModules: string[], desc, moduleName? }
   * 返回: { success, created?, moduleName?, error?, needModuleName? }
   *   needModuleName=true 表示新建时无法自动获取模块名，需调用方向用户询问后重试
   */
  ipcMain.handle('version-json:append-relation', async (event, params) => {
    const timestamp = formatTimestamp();
    const { issue, date, relationModules, desc, moduleName } = params || {};

    if (!getGit() || !getProjectPath()) throw new Error('未打开项目');
    if (!issue) return { success: false, error: '昆仑单号不能为空' };
    if (!Array.isArray(relationModules) || relationModules.length === 0) {
      return { success: false, error: '模块名不能为空' };
    }

    const git = getGit();
    const projectPath = getProjectPath();
    const versionPath = path.join(projectPath, 'version.json');
    const entry = {
      issue,
      date,
      relationModules,
      desc: desc || ''
    };

    try {
      let json;
      let created = false;
      let resolvedModuleName = null;

      if (fs.existsSync(versionPath)) {
        const raw = stripBom(fs.readFileSync(versionPath, 'utf-8'));
        try {
          json = JSON.parse(raw);
        } catch (parseError) {
          console.error(`[${timestamp}] [version-json:append-relation] version.json 解析失败: ${parseError.message}`);
          return { success: false, error: `version.json 内容不是合法 JSON: ${parseError.message}` };
        }
        if (json === null || typeof json !== 'object' || Array.isArray(json)) {
          return { success: false, error: 'version.json 根节点不是对象' };
        }
        if (!Array.isArray(json.relations)) {
          json.relations = [];
        }
      } else {
        // 不存在则新建：moduleId 取远程仓库名，moduleName 依次尝试 deploy.xml / package.json / 入参
        const repoName = await readRepoName(git);
        resolvedModuleName =
          readModuleNameFromDeployXml(projectPath) ||
          readModuleNameFromPackageJson(projectPath) ||
          (typeof moduleName === 'string' && moduleName.trim() ? moduleName.trim() : null);

        if (!resolvedModuleName) {
          console.warn(`[${timestamp}] [version-json:append-relation] 无法自动获取模块名，需用户手动输入`);
          return { success: false, needModuleName: true, error: '缺少 version.json，且无法自动获取模块名' };
        }

        json = {
          moduleId: repoName || path.basename(projectPath),
          moduleName: resolvedModuleName,
          relations: []
        };
        created = true;
        console.log(`[${timestamp}] [version-json:append-relation] version.json 不存在，新建: moduleId=${json.moduleId}, moduleName=${resolvedModuleName}`);
      }

      json.relations.push(entry);
      fs.writeFileSync(versionPath, stringifyVersionJson(json), 'utf-8');
      await git.raw(['add', 'version.json']);

      console.log(`[${timestamp}] [version-json:append-relation] 已追加记录: issue=${issue}, modules=${relationModules.join('/')}, created=${created}`);
      return { success: true, created, moduleName: resolvedModuleName || json.moduleName };
    } catch (error) {
      console.error(`[${timestamp}] [version-json:append-relation] 失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
};

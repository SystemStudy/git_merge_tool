/**
 * 最近项目配置的独立存储（文件: git-merge-assistant-projects.json）
 *
 * recentProjects 从 git-merge-assistant-config.json 中拆分至此，
 * 每条只保留 path / name / lastOpened 三个字段。
 *
 * 注意：本 Store 刻意不设置 defaults。electron-store 在构造时若发现
 * defaults 与文件内容不一致会立即落盘，那样 hasProjectsFile() 永远为真，
 * 迁移判断就失效了。
 */
const fs = require('fs');
const Store = require('electron-store');

const projectStore = new Store({
  name: 'git-merge-assistant-projects'
});

// 最近项目保留条数上限（与拆分前的行为保持一致）
const MAX_RECENT_PROJECTS = 10;

/** projects 配置文件是否已存在于磁盘 */
function hasProjectsFile() {
  try {
    return fs.existsSync(projectStore.path);
  } catch (error) {
    console.warn(`[project-store] 检查配置文件失败: ${error.message}`);
    return false;
  }
}

/** 读取最近项目列表 */
function getRecentProjects() {
  const list = projectStore.get('recentProjects');
  return Array.isArray(list) ? list : [];
}

/** 写入最近项目列表 */
function setRecentProjects(projects) {
  projectStore.set('recentProjects', Array.isArray(projects) ? projects : []);
}

/** 把项目加入最近列表（已存在则移到最前） */
function addRecentProject(projectPath, projectName) {
  const projects = getRecentProjects();

  const next = [
    {
      path: projectPath,
      name: projectName,
      lastOpened: new Date().toISOString()
    },
    ...projects.filter(p => p.path !== projectPath)
  ].slice(0, MAX_RECENT_PROJECTS);

  setRecentProjects(next);
}

/** 从最近列表移除项目 */
function removeRecentProject(projectPath) {
  setRecentProjects(getRecentProjects().filter(p => p.path !== projectPath));
}

/**
 * 迁移程序：把旧配置文件中的 recentProjects 拆分到独立文件。
 *
 * 触发条件（两者都满足）：
 *   1. projects 配置文件尚不存在
 *   2. 旧配置文件中仍存在 recentProjects
 *
 * 迁移时只保留 path / name / lastOpened 三个字段，历史遗留的 repos 等字段一并剔除。
 * 新文件写入并回读校验通过后，才从旧配置文件中删除 recentProjects，
 * 并顺带删除已废弃的 projectsRepos。
 *
 * @param {import('electron-store')} legacyStore 旧的应用配置 Store
 * @returns {{ migrated: boolean, reason?: string, projectCount?: number }}
 */
function migrateFromLegacyStore(legacyStore) {
  if (hasProjectsFile()) {
    return { migrated: false, reason: 'projects 配置文件已存在' };
  }

  if (!legacyStore.has('recentProjects')) {
    return { migrated: false, reason: '旧配置中不存在 recentProjects' };
  }

  const legacyProjects = legacyStore.get('recentProjects');
  // 只取需要的字段，避免把 repos 等历史遗留属性带进新配置文件
  const projects = (Array.isArray(legacyProjects) ? legacyProjects : [])
    .filter(p => p && typeof p === 'object')
    .map(({ path: projectPath, name, lastOpened }) => ({ path: projectPath, name, lastOpened }));

  console.log(`[project-store] 开始迁移 recentProjects: ${projects.length} 条`);

  try {
    setRecentProjects(projects);

    // 回读校验：确认新文件确实落盘且条数一致，通过后才动旧配置
    const verify = getRecentProjects();
    if (!hasProjectsFile() || verify.length !== projects.length) {
      console.error('[project-store] 迁移校验失败，保留旧配置不做删除');
      return { migrated: false, reason: '新配置文件写入校验失败' };
    }

    legacyStore.delete('recentProjects');

    // projectsRepos 为已废弃配置，迁移时一并清理
    if (legacyStore.has('projectsRepos')) {
      legacyStore.delete('projectsRepos');
      console.log('[project-store] 已删除废弃配置 projectsRepos');
    }

    console.log(`[project-store] 迁移完成: ${projects.length} 个项目 -> ${projectStore.path}`);
    console.log('[project-store] 已从旧配置文件中删除 recentProjects');
    return { migrated: true, projectCount: projects.length };
  } catch (error) {
    console.error(`[project-store] 迁移失败: ${error.message}`);
    return { migrated: false, reason: error.message };
  }
}

module.exports = {
  projectStore,
  hasProjectsFile,
  getRecentProjects,
  setRecentProjects,
  addRecentProject,
  removeRecentProject,
  migrateFromLegacyStore
};

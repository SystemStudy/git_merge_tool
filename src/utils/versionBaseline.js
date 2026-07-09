/**
 * 版本基线相关纯函数：用于遴选后跨版本（V5 ↔ V5.5）替换的方向判定。
 *
 * 全局配置示例：
 *   { "branch": { "develop": { "version": "V5.5" }, "stable/sp1/*": { "version": "V5" } } }
 *
 * 当前版本来自仓库 pom.xml 的 parent.version（如 5.5.0-SNAPSHOT / 5.4.0-SNAPSHOT）。
 */

/**
 * 将 pom.xml 的 parent.version 原始值归一化为 'V5.5' 或 'V5'。
 * 规则：取 major.minor，minor === '5' → 'V5.5'，否则 → 'V5'。
 *   '5.5.0-SNAPSHOT' → 'V5.5'
 *   '5.4.0-SNAPSHOT' → 'V5'
 *   '5.0.0-SNAPSHOT' → 'V5'
 * 无法解析返回 null。
 */
export function normalizeVersion(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/-SNAPSHOT$/i, '').replace(/-RELEASE$/i, '');
  const parts = cleaned.split('.');
  if (parts.length < 2) return null;
  const major = parts[0];
  const minor = parts[1];
  if (!major || !minor) return null;
  // 目前只区分 V5.5 与 V5 两档
  if (major === '5' && minor === '5') return 'V5.5';
  return 'V5';
}

/**
 * 按目标分支名在全局配置的 branch 映射中通配匹配版本。
 * @param {string} branch 目标分支名，如 'stable/sp1/smoke'
 * @param {Object} branchConfig config.branch 对象
 * @returns {string|null} 命中的 version（如 'V5.5'），未命中返回 null
 *
 * 匹配规则：
 *  - 精确匹配优先（key === branch）
 *  - 否则按 '/' 分段通配：key 中 '*' 段匹配任意非空单段，其他段精确相等；段数必须相同
 *  - 多个通配命中时，取"非通配段数最多"（即最精确）者
 */
export function matchBranchVersion(branch, branchConfig) {
  if (!branch || !branchConfig || typeof branchConfig !== 'object') return null;

  // 精确匹配
  if (branchConfig[branch] && branchConfig[branch].version) {
    return branchConfig[branch].version;
  }

  const branchSegs = branch.split('/');
  let bestMatch = null;
  let bestSpecificity = -1;

  for (const key of Object.keys(branchConfig)) {
    if (key === branch) continue;
    const keySegs = key.split('/');
    if (keySegs.length !== branchSegs.length) continue;

    let matched = true;
    let nonWildcardSegs = 0;
    for (let i = 0; i < keySegs.length; i++) {
      const ks = keySegs[i];
      const bs = branchSegs[i];
      if (ks === '*') {
        // '*' 匹配任意非空单段
        if (!bs) { matched = false; break; }
      } else if (ks !== bs) {
        matched = false;
        break;
      } else {
        nonWildcardSegs++;
      }
    }
    if (matched && branchConfig[key].version) {
      if (nonWildcardSegs > bestSpecificity) {
        bestSpecificity = nonWildcardSegs;
        bestMatch = branchConfig[key].version;
      }
    }
  }
  return bestMatch;
}

/**
 * 根据当前版本与目标版本决定替换方向。
 * @returns {'forward'|'reverse'|'skip'}
 *   forward  : V5 → V5.5（javax→jakarta, fastjson→fastjson2）
 *   reverse  : V5.5 → V5（逆向）
 *   skip     : 一致或非两档组合，不处理
 */
export function decideDirection(currentV, targetV) {
  if (!currentV || !targetV) return 'skip';
  if (currentV === targetV) return 'skip';
  if (currentV === 'V5' && targetV === 'V5.5') return 'forward';
  if (currentV === 'V5.5' && targetV === 'V5') return 'reverse';
  return 'skip';
}

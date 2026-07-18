/**
 * 多语言文件合并相关工具函数
 * 从 MainWorkspace.js 中抽取
 */

/**
 * 格式化 Git 提交时间为 yyyy-MM-dd HH:mm:ss
 */
export const formatCommitDate = (dateStr) => {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
  } catch {
    return dateStr;
  }
};

/**
 * 判断单个文件是否是多语言文件
 */
export const isMultiLanguageFile = (filePath) => {
  if (!filePath) return false;
  // 前端: zh-CN.json, en-US.json 等 (<2-3字母>(-<2-4字母>)?.json)
  const frontendPattern = /(^|[/\\])[a-z]{2,3}(-[A-Z]{2,4})?\.json$/;
  // 后端: ApplicationResources.properties
  const backendPattern = /ApplicationResources\.properties$/;
  return frontendPattern.test(filePath) || backendPattern.test(filePath);
};

/**
 * 判断是否全部冲突文件都是多语言文件
 */
export const isMultiLanguageConflict = (files) => {
  return files && files.length > 0 && files.every(f => isMultiLanguageFile(f));
};

/**
 * 解析 .properties 单行，返回 {key, value} 或 null（注释/空行/无等号行）
 */
export const parsePropertiesLine = (line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) return null;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) return null;
  return { key: trimmed.substring(0, eqIdx).trim(), value: trimmed.substring(eqIdx + 1).trim() };
};

/**
 * 从 JSON 原文的缩进自动推断缩进格式（反序列化时保留原格式）
 */
export const detectJsonIndent = (content) => {
  const match = content.match(/\n([ \t]+)"/);
  return match ? match[1] : '  ';
};

/**
 * 合并 .properties：以 ours 原文为基准，保留原注释/空行/顺序/换行。
 * theirs 新增 key 在文件末尾或插入到前面 theirs 中的位置，
 * 即插入到前面一个 ours 已存在的 key（锚点）之后插入；
 * 无锚点则插入到文件头部。
 * 同 key 值不同则为冲突。
 */
export const mergePropertiesContent = (ours, theirs) => {
  const oursText = ours || '';
  const theirsText = theirs || '';
  const oursLines = oursText.split('\n');

  // ours key -> 首次出现行号
  const oursKeyLineIndex = {};
  const oursKeySet = new Set();
  oursLines.forEach((line, idx) => {
    const kv = parsePropertiesLine(line);
    if (kv && !oursKeySet.has(kv.key)) {
      oursKeySet.add(kv.key);
      oursKeyLineIndex[kv.key] = idx;
    }
  });

  // theirs 按顺序去重的 key 列表 + key -> 原行
  const theirsOrder = [];
  const theirsLineOf = {};
  const theirsSeen = new Set();
  for (const line of theirsText.split('\n')) {
    const kv = parsePropertiesLine(line);
    if (!kv || theirsSeen.has(kv.key)) continue;
    theirsSeen.add(kv.key);
    theirsOrder.push(kv.key);
    theirsLineOf[kv.key] = line;
  }

  const conflicts = [];
  const anchorToNew = {}; // anchorKey -> [newKey...]
  const headNew = []; // 无锚点新增 key
  for (let i = 0; i < theirsOrder.length; i++) {
    const key = theirsOrder[i];
    if (oursKeySet.has(key)) {
      const oursKv = parsePropertiesLine(oursLines[oursKeyLineIndex[key]]);
      const theirsKv = parsePropertiesLine(theirsLineOf[key]);
      if (oursKv.value !== theirsKv.value) conflicts.push(key);
      continue;
    }
    let anchor = null;
    for (let j = i - 1; j >= 0; j--) {
      if (oursKeySet.has(theirsOrder[j])) { anchor = theirsOrder[j]; break; }
    }
    if (anchor) {
      if (!anchorToNew[anchor]) anchorToNew[anchor] = [];
      anchorToNew[anchor].push(key);
    } else {
      headNew.push(key);
    }
  }
  if (conflicts.length > 0) return { mergedContent: null, conflicts };

  // 遍历 ours，遇到锚点 key 时立即插入新增行
  const result = [];
  for (let idx = 0; idx < oursLines.length; idx++) {
    result.push(oursLines[idx]);
    const kv = parsePropertiesLine(oursLines[idx]);
    if (kv && oursKeyLineIndex[kv.key] === idx && anchorToNew[kv.key]) {
      for (const nk of anchorToNew[kv.key]) result.push(theirsLineOf[nk]);
    }
  }
  // 以 ours 原文末尾换行状态为准
  let mergedContent = result.join('\n');
  if (headNew.length > 0) {
    mergedContent = headNew.map(k => theirsLineOf[k]).join('\n') + '\n' + mergedContent;
  }
  return { mergedContent, conflicts: [] };
};

/**
 * 合并 .json：浅层合并，只取 key，ours 顺序。theirs 新增 key 放到末尾。
 * 即插入到前面 theirs 中的位置，取前面一个 ours 已存在 key（锚点）之后插入；
 * 无锚点则插入到文件头部。所有值以 ours 为基准。同 key 值不同则为冲突。
 */
export const mergeJsonContent = (ours, theirs) => {
  let oursObj;
  let theirsObj;
  try {
    oursObj = JSON.parse(ours || '{}');
  } catch (e) {
    console.error('[mergeJsonContent] ours JSON 解析失败:', e.message);
    return { parseError: true };
  }
  try {
    theirsObj = JSON.parse(theirs || '{}');
  } catch (e) {
    console.error('[mergeJsonContent] theirs JSON 解析失败:', e.message);
    return { parseError: true };
  }

  const indent = detectJsonIndent(ours || '');
  const oursKeys = Object.keys(oursObj);
  const oursKeySet = new Set(oursKeys);
  const theirsOrder = Object.keys(theirsObj);

  const conflicts = [];
  const anchorToNew = {};
  const headNew = [];
  for (let i = 0; i < theirsOrder.length; i++) {
    const key = theirsOrder[i];
    if (oursKeySet.has(key)) {
      if (JSON.stringify(oursObj[key]) !== JSON.stringify(theirsObj[key])) conflicts.push(key);
      continue;
    }
    let anchor = null;
    for (let j = i - 1; j >= 0; j--) {
      if (oursKeySet.has(theirsOrder[j])) { anchor = theirsOrder[j]; break; }
    }
    if (anchor) {
      if (!anchorToNew[anchor]) anchorToNew[anchor] = [];
      anchorToNew[anchor].push(key);
    } else {
      headNew.push(key);
    }
  }
  if (conflicts.length > 0) return { mergedContent: null, conflicts };

  const merged = {};
  for (const k of headNew) merged[k] = theirsObj[k];
  for (const ok of oursKeys) {
    merged[ok] = oursObj[ok];
    if (anchorToNew[ok]) for (const nk of anchorToNew[ok]) merged[nk] = theirsObj[nk];
  }
  // 以 ours 原文末尾换行状态为准
  const trailingNewline = (ours || '').endsWith('\n');
  const mergedContent = JSON.stringify(merged, null, indent) + (trailingNewline ? '\n' : '');
  return { mergedContent, conflicts: [] };
};

/**
 * 多语言文件合并入口，返回 { mergedContent, conflicts, parseError }
 */
export const mergeMultiLanguageContent = (ours, theirs, filePath) => {
  if (filePath.endsWith('.json')) return mergeJsonContent(ours, theirs);
  if (filePath.endsWith('.properties')) return mergePropertiesContent(ours, theirs);
  return { parseError: true };
};

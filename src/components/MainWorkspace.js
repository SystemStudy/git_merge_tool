import React, { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import { List } from 'react-window';
import {
  Layout,
  Card,
  Button,
  Table,
  Input,
  Space,
  Tag,
  Radio,
  Checkbox,
  message,
  Modal,
  Drawer,
  Form,
  Select,
  Tabs,
  Alert,
  Tooltip,
  Spin,
  Progress,
  AutoComplete,
  Switch
} from 'antd';
import {
  ArrowLeftOutlined,
  ReloadOutlined,
  DownloadOutlined,
  BranchesOutlined,
  GlobalOutlined,
  SettingOutlined,
  SearchOutlined,
  UserOutlined,
  ClearOutlined,
  CodeOutlined,
  CopyOutlined,
  WarningOutlined,
  TagOutlined,
  PlusOutlined,
  CloseOutlined,
  LockOutlined
} from '@ant-design/icons';
import './MainWorkspace.css';
import { normalizeVersion, matchBranchVersion, decideDirection } from '../utils/versionBaseline';

/**
 * 遴选后跨版本基线替换 + squash into parent。
 * 在 cherry-pick 全部成功、推送前调用。任意跳过条件均 return 不抛错，不阻断主流程。
 * @param {Object} args
 * @param {string} args.beforePickSha 遴选前 HEAD sha（forceSync/createBranch 后取）
 * @param {string} args.targetBranch 目标分支名（用于匹配全局配置中的版本）
 * @param {Function} [args.setProgress] 进度文案更新回调 (statusText) => void
 * @param {string|null} args.currentV 源项目根 pom 归一化版本（遴选前读取，由调用方提供）
 */
async function applyBaselineReplacementAndSquash({ beforePickSha, targetBranch, setProgress, currentV }) {
  const logTag = `[applyBaselineReplacementAndSquash:${targetBranch}]`;
  try {
    // 1. 全局配置
    const globalCfg = await window.electronAPI.globalConfig.get();
    const branchConfig = globalCfg && globalCfg.config && globalCfg.config.branch;
    if (!branchConfig) {
      console.warn(`${logTag} 全局配置缺失，跳过基线替换`);
      return { skipped: 'no-config' };
    }

    // 2. 当前版本（由调用方在遴选前读源 pom 提供；假设 pom.xml 不在遴选改动里）
    if (!currentV) {
      console.warn(`${logTag} 未提供当前版本(源 pom 读取失败或无法归一化)，跳过`);
      return { skipped: 'no-current-version' };
    }

    // 3. 目标版本（全局配置按分支名通配匹配）
    const targetV = matchBranchVersion(targetBranch, branchConfig);
    if (!targetV) {
      console.warn(`${logTag} 匹配不到目标分支版本，跳过`);
      return { skipped: 'no-target-version' };
    }

    // 4. 方向
    const direction = decideDirection(currentV, targetV);
    if (direction === 'skip') {
      if (currentV === targetV) {
        console.log(`${logTag} 版本一致(${currentV})，跳过`);
        return { skipped: 'version-same' };
      }
      console.warn(`${logTag} 版本组合 ${currentV}→${targetV} 非两档替换，跳过`);
      return { skipped: 'version-mismatch' };
    }

    // 5. 列出本次遴选改动的 .java 文件
    const listRes = await window.electronAPI.git.listChangedJavaFiles(beforePickSha);
    if (!listRes.success || !listRes.files || listRes.files.length === 0) {
      console.log(`${logTag} 无 .java 改动文件，跳过`);
      return { skipped: 'no-java-files' };
    }

    // 6. 进度提示 + 应用替换
    if (setProgress) setProgress('检测到存在跨版本合并需要替换的内容，正在自动替换');
    const rep = await window.electronAPI.git.applyVersionReplacement({ files: listRes.files, direction });
    if (!rep.success) {
      console.warn(`${logTag} 替换失败: ${rep.error}`);
      return { skipped: 'replace-failed', error: rep.error };
    }
    if (!rep.changedFiles || rep.changedFiles.length === 0) {
      console.log(`${logTag} 替换后无变化，跳过 squash`);
      return { skipped: 'no-change' };
    }

    // 7. squash into parent（合并进最后一个遴选 commit）
    const sq = await window.electronAPI.git.squashIntoParent({ beforePickSha });
    if (!sq.success) {
      message.warning(`跨版本替换已应用，但 squash 合并失败（已回退），将推送未压缩版本: ${sq.error}`);
      return { skipped: 'squash-failed', error: sq.error };
    }
    console.log(`${logTag} 跨版本替换并 squash 成功: ${direction}, 改动 ${rep.changedFiles.length} 文件`);
    return { success: true, direction, changedFiles: rep.changedFiles };
  } catch (error) {
    console.error(`${logTag} 异常: ${error.message}`);
    message.warning(`跨版本替换异常: ${error.message}`);
    return { skipped: 'exception', error: error.message };
  }
}

const { Header, Content } = Layout;
const { Search } = Input;
const { Option } = Select;

// 格式化 Git 提交日期为 yyyy-MM-dd HH:mm:ss
const formatCommitDate = (dateStr) => {
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

// 性能监控工具
const performanceMonitor = {
  marks: {},
  slowOperations: [],
  
  start(label) {
    this.marks[label] = performance.now();
  },
  
  end(label) {
    if (this.marks[label]) {
      const duration = performance.now() - this.marks[label];
      if (duration > 100) {
        console.warn(`[PERFORMANCE] ${label} 耗时 ${duration.toFixed(2)}ms (超过100ms阈值)`);
      } else {
        console.log(`[PERFORMANCE] ${label} 耗时 ${duration.toFixed(2)}ms`);
      }
      delete this.marks[label];
      return duration;
    }
    return 0;
  },
  
  record(operation, duration) {
    this.slowOperations.push({
      operation,
      duration,
      timestamp: Date.now()
    });
    
    // 保留最近 10 条慢操作记录
    if (this.slowOperations.length > 10) {
      this.slowOperations.shift();
    }
    
    console.log(`[PERFORMANCE] 慢操作记录: ${operation} - ${duration.toFixed(2)}ms`);
  },
  
  getReport() {
    const avgDuration = this.slowOperations.length > 0
      ? this.slowOperations.reduce((sum, op) => sum + op.duration, 0) / this.slowOperations.length
      : 0;
    
    return {
      totalOperations: this.slowOperations.length,
      averageDuration: avgDuration,
      operations: this.slowOperations
    };
  },
  
  clear() {
    this.slowOperations = [];
  }
};

// 性能测试工具
const runPerformanceTest = (testName, fn, iterations = 10) => {
  const times = [];
  
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    const end = performance.now();
    times.push(end - start);
  }
  
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  
  console.log(`[PERFORMANCE TEST] ${testName}`);
  console.log(`  平均: ${avg.toFixed(2)}ms`);
  console.log(`  最小: ${min.toFixed(2)}ms`);
  console.log(`  最大: ${max.toFixed(2)}ms`);
  console.log(`  总计: ${times.reduce((a, b) => a + b, 0).toFixed(2)}ms`);
  
  return { avg, min, max, times };
};

// 合并类型配置
const MERGE_TYPES = [
  { value: 'bug', label: 'bug提测' },
  { value: 'test', label: '提测' },
  { value: 'release', label: '入库' },
  { value: 'custom', label: '指定分支合并' }
];

// 优化的提交项组件 - 使用 memo 和直接调用避免额外渲染
const CommitItem = memo(({ commit, isSelected, onToggle }) => {
  // 直接绑定 onClick，确保每次都能响应
  const handleClick = useCallback(() => {
    if (onToggle && commit.hash) {
      onToggle(commit.hash);
    }
  }, [commit.hash, onToggle]);

  const backgroundColor = isSelected ? '#e6f7ff' : 'transparent';

  return (
    <div 
      className={`commit-item ${isSelected ? 'selected' : ''}`}
      onClick={handleClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 12px',
        borderBottom: '1px solid #f0f0f0',
        cursor: 'pointer',
        userSelect: 'none',
        backgroundColor: backgroundColor,
        transition: 'background-color 0.15s ease'
      }}
    >
      <Checkbox
        checked={isSelected}
        style={{ marginRight: '12px' }}
        onChange={handleClick}
      />
      <Tooltip title={commit.hash}>
        <code className="commit-hash" style={{ 
          width: '100px', 
          marginRight: '12px',
          fontFamily: 'Monaco, Consolas, monospace',
          fontSize: '12px',
          backgroundColor: '#f5f5f5',
          padding: '2px 6px',
          borderRadius: '4px',
          color: isSelected ? '#1890ff' : '#666'
        }}>
          {commit.hash?.substring(0, 8)}
        </code>
      </Tooltip>
      <span style={{ 
        width: '120px', 
        marginRight: '12px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontWeight: isSelected ? '600' : '400'
      }}>
        {commit.author_name || '-'}
      </span>
      <span style={{ 
        width: '120px', 
        marginRight: '12px',
        color: '#999',
        fontSize: '12px'
      }}>
        {formatCommitDate(commit.date)}
      </span>
      <span style={{
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: isSelected ? '#262626' : '#595959'
      }}>
        {commit.message || '-'}
      </span>
    </div>
  );
});

// 虚拟列表行渲染器
const CommitRow = ({ index, style, data }) => {
  const isDataReady = data && data.commits && data.selectedCommitsRef && data.toggleCommitSelection;
  
  const { commits = [], selectedCommitsRef = { current: new Set() }, toggleCommitSelection = () => {} } = data || {};
  const commit = isDataReady ? commits[index] : null;
  
  const isSelected = commit && Boolean(selectedCommitsRef.current?.has(commit.hash));
  
  const handleClick = useCallback(() => {
    if (isDataReady && toggleCommitSelection && commit?.hash) {
      toggleCommitSelection(commit.hash);
    }
  }, [isDataReady, commit?.hash, toggleCommitSelection]);
  
  if (!isDataReady || !commit) {
    return <div style={style}>加载中...</div>;
  }
  
  return (
    <div
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        padding: '8px 12px',
        borderBottom: '1px solid #f0f0f0',
        cursor: 'pointer',
        userSelect: 'none',
        backgroundColor: isSelected ? '#e6f7ff' : 'transparent'
      }}
      onClick={handleClick}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = '#f5f5f5';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = isSelected ? '#e6f7ff' : 'transparent';
      }}
    >
      <Checkbox
        checked={isSelected}
        style={{ marginRight: '12px', pointerEvents: 'none' }}
      />
      <Tooltip title={commit.hash}>
        <code style={{
          width: '100px',
          marginRight: '12px',
          fontFamily: 'Monaco, Consolas, monospace',
          fontSize: '12px',
          backgroundColor: '#f5f5f5',
          padding: '2px 6px',
          borderRadius: '4px'
        }}>
          {commit.hash?.substring(0, 8) || '-'}
        </code>
      </Tooltip>
      <span style={{
        width: '120px',
        marginRight: '12px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}>
        {commit.author_name || '-'}
      </span>
      <span style={{
        width: '120px',
        marginRight: '12px',
        color: '#999',
        fontSize: '12px'
      }}>
        {formatCommitDate(commit.date)}
      </span>
      <span style={{
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}>
        {commit.message || '-'}
      </span>
    </div>
  );
};

// 判断单个文件是否多语言文件
const isMultiLanguageFile = (filePath) => {
  if (!filePath) return false;
  // 前端: zh-CN.json, en-US.json 等 (<2-3字母>(-<2-4字母>)?.json)
  const frontendPattern = /(^|[\/\\])[a-z]{2,3}(-[A-Z]{2,4})?\.json$/;
  // 后端: ApplicationResources.properties
  const backendPattern = /ApplicationResources\.properties$/;
  return frontendPattern.test(filePath) || backendPattern.test(filePath);
};

// 判断是否所有冲突文件都是多语言文件
const isMultiLanguageConflict = (files) => {
  return files && files.length > 0 && files.every(f => isMultiLanguageFile(f));
};

// 解析 .properties 单行，返回 {key, value} 或 null（注释/空行/无等号行）
const parsePropertiesLine = (line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) return null;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) return null;
  return { key: trimmed.substring(0, eqIdx).trim(), value: trimmed.substring(eqIdx + 1).trim() };
};

// 检测 JSON 原文的缩进风格（用于序列化时保持原格式）
const detectJsonIndent = (content) => {
  const match = content.match(/\n([ \t]+)"/);
  return match ? match[1] : '  ';
};

// 合并 .properties：以 ours 原文为基准，原样保留顺序/注释/空行/分组。
// theirs 中新增的 key 不放文件末尾，而是按其在 theirs 中的相对位置，
// 紧跟在它前一个 ours 已存在的 key（锚点）之后插入；无锚点者置于最前。
// 同 key 值不同则记为冲突。
const mergePropertiesContent = (ours, theirs) => {
  const oursText = ours || '';
  const theirsText = theirs || '';
  const oursLines = oursText.split('\n');

  // ours key -> 首次出现行索引
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

  // 逐行输出 ours，遇到锚点 key 行时紧跟插入其新增项
  const result = [];
  for (let idx = 0; idx < oursLines.length; idx++) {
    result.push(oursLines[idx]);
    const kv = parsePropertiesLine(oursLines[idx]);
    if (kv && oursKeyLineIndex[kv.key] === idx && anchorToNew[kv.key]) {
      for (const nk of anchorToNew[kv.key]) result.push(theirsLineOf[nk]);
    }
  }
  // 保留 ours 原文末尾换行状态，不强制追加换行
  // （否则会把原本无末尾换行的最后一行误判为改动）
  let mergedContent = result.join('\n');
  if (headNew.length > 0) {
    mergedContent = headNew.map(k => theirsLineOf[k]).join('\n') + '\n' + mergedContent;
  }
  return { mergedContent, conflicts: [] };
};

// 合并 .json：浅层合并顶层 key，保留 ours 顺序。theirs 新增 key 不放末尾，
// 而是按其在 theirs 中的相对位置，紧跟在前一个 ours 已存在 key（锚点）之后插入；
// 无锚点者置于最前。序列化沿用 ours 原文缩进。同 key 值不同则记为冲突。
const mergeJsonContent = (ours, theirs) => {
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
  // 保留 ours 原文末尾换行状态，避免把无末尾换行的文件误判为改动
  const trailingNewline = (ours || '').endsWith('\n');
  const mergedContent = JSON.stringify(merged, null, indent) + (trailingNewline ? '\n' : '');
  return { mergedContent, conflicts: [] };
};

// 多语言文件合并入口：返回 { mergedContent, conflicts, parseError }
const mergeMultiLanguageContent = (ours, theirs, filePath) => {
  if (filePath.endsWith('.json')) return mergeJsonContent(ours, theirs);
  if (filePath.endsWith('.properties')) return mergePropertiesContent(ours, theirs);
  return { parseError: true };
};

const MainWorkspace = ({ project, onClose }) => {
  const [branches, setBranches] = useState([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [commits, setCommits] = useState([]);
  const [selectedCommits, setSelectedCommits] = useState([]);
  const [selectedTargetBranches, setSelectedTargetBranches] = useState([]);
  const [customBranchInputs, setCustomBranchInputs] = useState(['']); // 指定分支合并模式的动态分支输入
  const [mergeType, setMergeType] = useState('bug');
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [settings, setSettings] = useState({});
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearchText, setDebouncedSearchText] = useState('');
  const [showMyCommits, setShowMyCommits] = useState(false);
  const [allCommits, setAllCommits] = useState([]);
  const fetchAllCommitsRef = useRef(false);
  const allCommitsLoadedRef = useRef(false);
  const searchHasLoadedRef = useRef(false);
  const searchDebouncerRef = useRef(null);
  const [initialized, setInitialized] = useState(false);
  const [viewBranch, setViewBranch] = useState(''); // 当前查看的分支（用于显示提交记录）
  const [originalBranch, setOriginalBranch] = useState(''); // 用户的初始分支（操作后恢复至此）
  const [branchSwitcherVisible, setBranchSwitcherVisible] = useState(false);
  const [selectedViewBranch, setSelectedViewBranch] = useState(''); // 弹窗中临时选中的分支
  const [branchSearchText, setBranchSearchText] = useState(''); // 分支搜索文本

  // 防抖搜索：延迟500ms再触发过滤，避免每输入一个字符就触发重新渲染
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchText]);

  // custom 模式：自动将 customBranchInputs 同步到 selectedTargetBranches（去重、trim、去空）
  useEffect(() => {
    if (mergeType === 'custom') {
      const validBranches = [...new Set(
        customBranchInputs.map(b => b.trim()).filter(Boolean)
      )];
      setSelectedTargetBranches(validBranches);
    }
  }, [customBranchInputs, mergeType]);

  const [currentUser, setCurrentUser] = useState({ name: '', email: '' });
  const [hasMoreCommits, setHasMoreCommits] = useState(true);
  const [skipCount, setSkipCount] = useState(0);
  const commitsListRef = useRef(null);
  const [mergeProgress, setMergeProgress] = useState({ visible: false, current: 0, total: 0, status: '', results: [] });
  const [mergeResultModal, setMergeResultModal] = useState({ visible: false, success: false, results: [] });
  const [cherryPickProgress, setCherryPickProgress] = useState({ visible: false, current: 0, total: 0, status: '', results: [] });
  const [cherryPickResultModal, setCherryPickResultModal] = useState({ visible: false, success: false, results: [] });
  const [conflictDetecting, setConflictDetecting] = useState(false);
  const [conflictProgress, setConflictProgress] = useState({ visible: false, current: 0, total: 0, status: '' });
  const [conflictResultModal, setConflictResultModal] = useState({ visible: false, results: [] });
  const [changeDetecting, setChangeDetecting] = useState(false);
  const [changeDetectProgress, setChangeDetectProgress] = useState({ visible: false, current: 0, total: 0, status: '' });
  const [changeDetectResultModal, setChangeDetectResultModal] = useState({ visible: false, results: [], isSingleCommit: false, allExist: true, missingBySubject: {}, commitSubjects: [] });
  const [versionDetecting, setVersionDetecting] = useState(false);
  const [versionDetectProgress, setVersionDetectProgress] = useState({ visible: false, current: 0, total: 0, status: '' });
  const [versionDetectResultModal, setVersionDetectResultModal] = useState({ visible: false, results: [] });
  const [conflictModal, setConflictModal] = useState({ visible: false, files: [], branch: '', sha: '' });
  const [conflictClaudeLoading, setConflictClaudeLoading] = useState(false);
  const [conflictAutoMerging, setConflictAutoMerging] = useState(false);
  const conflictResolveRef = useRef(null);
  // Claude 智能冲突对话 Modal：流式展示思考与返回值，用户确认后应用
  const [claudeStreamModal, setClaudeStreamModal] = useState({
    visible: false, loading: false, thinking: '', text: '', files: null, error: null
  });
  const claudeConfirmResolveRef = useRef(null);
  
  // 优化：使用 ref 存储 selectedCommits 的 Set 以提高查找性能
  const selectedCommitsRef = useRef(new Set());
  
  // 优化：更新 ref 当 selectedCommits 变化时
  useEffect(() => {
    selectedCommitsRef.current = new Set(selectedCommits);
  }, [selectedCommits]);
  
  // 从 commits（分页）和 allCommits（搜索全量）两个数据源查找提交
  const findCommitByHash = useCallback((hash) => {
    return commits.find(c => c.hash === hash) || allCommits.find(c => c.hash === hash);
  }, [commits, allCommits]);

  // 优化：使用 useCallback 缓存选择切换函数，并添加性能监控
  const toggleCommitSelection = useCallback((hash) => {
    const startTime = performance.now();
    const wasSelected = selectedCommitsRef.current.has(hash);
    
    if (wasSelected) {
      setSelectedCommits(prev => prev.filter(h => h !== hash));
    } else {
      setSelectedCommits(prev => [...prev, hash]);
    }
    
    // 使用 requestAnimationFrame 测量实际渲染时间
    requestAnimationFrame(() => {
      const renderTime = performance.now() - startTime;
      
      if (renderTime > 100) {
        console.warn(`[PERFORMANCE] 选择操作响应时间: ${renderTime.toFixed(2)}ms (可能需要优化)`);
      } else if (renderTime > 50) {
        console.log(`[PERFORMANCE] 选择操作响应时间: ${renderTime.toFixed(2)}ms`);
      }
      
      // 记录到性能监控
      if (renderTime > 100) {
        performanceMonitor.record('userInteraction', renderTime);
      }
    });
  }, []);

  // 冲突解决相关函数
  const allFilesResolved = conflictModal.files.length > 0 && conflictModal.files.every(f => f.resolved);

  const showSkipAbortDialog = useCallback(async (title, content) => {
    return await new Promise((resolve) => {
      Modal.confirm({
        title: title || 'Cherry-pick 失败',
        content: content || <div><p>请选择操作：</p></div>,
        okText: '跳过此分支',
        cancelText: '终止操作',
        onOk: () => resolve('skip'),
        onCancel: () => resolve('abort'),
        okButtonProps: { style: { background: '#1890ff' } },
        cancelButtonProps: { style: { background: '#ff4d4f' } }
      });
    });
  }, []);

  // 生成随机分支名后缀（a-z, 0-9）
  const generateRandomBranchSuffix = (length = 8) => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  };

  // 远程分支冲突时的五选项对话框：合并到已有分支 / 跳过 / 终止 / 删除远程并重建 / 生成新分支名
  const showMergeBranchConflictDialog = useCallback(async (branchName, conflictInfo) => {
    const { type, conflictingBranch } = conflictInfo;
    const isExactMatch = type === 'exact';

    const description = isExactMatch
      ? (<p>远程仓库已存在分支 <strong style={{ color: '#1890ff' }}>{conflictingBranch}</strong>，请选择处理方式：</p>)
      : (<div>
          <p>无法创建分支 <strong style={{ color: '#ff4d4f' }}>{branchName}</strong></p>
          <p>因为已有分支 <strong style={{ color: '#1890ff' }}>{conflictingBranch}</strong> 存在（git 不允许分支路径互为前缀），请选择处理方式：</p>
        </div>);

    return await new Promise((resolve) => {
      let actionResolved = false;
      const onAction = (action) => {
        if (actionResolved) return;
        actionResolved = true;
        destroy();
        resolve(action);
      };

      const { destroy } = Modal.confirm({
        title: '远程分支冲突',
        width: 750,
        bodyStyle: { padding: '20px 24px', minHeight: 100 },
        content: description,
        footer: (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'nowrap', marginTop: 16 }}>
            <Button type="primary" onClick={() => onAction('merge')}>
              合并到已有分支
            </Button>
            <Button onClick={() => onAction('rename')}>
              生成新分支名
            </Button>
            <Button onClick={() => onAction('skip')}>
              跳过
            </Button>
            <Button danger onClick={() => onAction('delete-remote')}>
              删除远程并重建
            </Button>
            <Button danger onClick={() => onAction('abort')}>
              终止
            </Button>
          </div>
        ),
        closable: true,
        maskClosable: true,
        onCancel: () => onAction('abort')
      });
    });
  }, []);

  const handleOpenFile = async (filePath) => {
    const result = await window.electronAPI.system.openFileInEditor(filePath);
    if (!result.success) {
      message.error(result.error);
    }
  };

  const handleMarkResolved = (filePath) => {
    setConflictModal(prev => ({
      ...prev,
      files: prev.files.map(f => f.path === filePath ? { ...f, resolved: true } : f)
    }));
  };

  const handleConflictConfirm = () => {
    conflictResolveRef.current?.('confirm');
  };

  const handleConflictCancel = () => {
    conflictResolveRef.current?.('abort');
  };

  // 多语言文件自动合并处理
  const handleAutoMergeLanguageFiles = useCallback(async (targetBranch, sha, conflictedFiles) => {
    message.info('检测到多语言文件冲突，正在执行自动合并操作');
    setConflictAutoMerging(true);

    try {
      const versionsResult = await window.electronAPI.git.getConflictFileVersions(conflictedFiles);
      if (!versionsResult.success) {
        message.warning('无法获取冲突文件版本: ' + versionsResult.error);
        return 'fallback';
      }

      const writeList = [];
      for (const file of versionsResult.files) {
        const result = mergeMultiLanguageContent(file.ours, file.theirs, file.path);

        if (result.parseError) {
          message.warning(`无法解析多语言文件 ${file.path}，切换到手动处理模式`);
          return 'fallback';
        }

        if (result.conflicts.length > 0) {
          message.warning(
            `自动合并失败，以下 key 在两个分支的值不一致：${result.conflicts.slice(0, 5).join(', ')}${result.conflicts.length > 5 ? '...' : ''}`,
            5
          );
          return 'fallback';
        }

        writeList.push({ path: file.path, content: result.mergedContent });
      }

      const writeResult = await window.electronAPI.git.writeFileAndStage(writeList);
      if (!writeResult.success) {
        message.warning('写入合并文件失败: ' + writeResult.error);
        return 'fallback';
      }

      message.success('多语言文件自动合并完成');
      return 'auto-success';
    } catch (e) {
      message.warning('自动合并出错: ' + e.message);
      return 'fallback';
    } finally {
      setConflictAutoMerging(false);
    }
  }, []);

  // Claude 智能冲突处理（流式，对话 Modal 展示思考与返回值，用户确认后应用）
  const handleClaudeResolveConflicts = useCallback(async (targetBranch, conflictedFiles) => {
    setConflictClaudeLoading(true);

    try {
      const contentResult = await window.electronAPI.git.getConflictFileContent(conflictedFiles);
      if (!contentResult.success) {
        message.error('无法读取冲突文件内容: ' + contentResult.error);
        return 'claude-failed';
      }

      const params = {
        files: contentResult.files,
        projectName: project.name,
        projectPath: project.path,
        operation: `cherry-pick 到 ${targetBranch}`
      };

      // 打开对话 Modal，初始 loading
      setClaudeStreamModal({ visible: true, loading: true, thinking: '', text: '', files: null, error: null });

      // 注册流式监听，增量更新思考与返回内容
      const offStream = window.electronAPI.claude.onResolveStream((chunk) => {
        setClaudeStreamModal((prev) => {
          if (chunk.type === 'thinking') return { ...prev, thinking: prev.thinking + chunk.data };
          if (chunk.type === 'text') return { ...prev, text: prev.text + chunk.data };
          return prev;
        });
      });

      let claudeResult;
      try {
        claudeResult = await window.electronAPI.claude.resolveConflicts(params);
      } finally {
        offStream();
      }

      if (!claudeResult.success) {
        // 展示错误，等待用户关闭后再回退到手动处理
        setClaudeStreamModal((prev) => ({ ...prev, loading: false, error: claudeResult.error }));
        await new Promise((resolve) => { claudeConfirmResolveRef.current = resolve; });
        setClaudeStreamModal((prev) => ({ ...prev, visible: false }));
        return 'claude-failed';
      }

      // 成功：展示结果，等待用户选择「应用并继续」或「放弃」
      setClaudeStreamModal((prev) => ({ ...prev, loading: false, files: claudeResult.files }));
      const userChoice = await new Promise((resolve) => { claudeConfirmResolveRef.current = resolve; });
      setClaudeStreamModal((prev) => ({ ...prev, visible: false }));

      if (userChoice === 'apply') {
        const writeResult = await window.electronAPI.git.writeFileAndStage(claudeResult.files);
        if (!writeResult.success) {
          message.error('写入已解决文件失败: ' + writeResult.error);
          return 'claude-failed';
        }
        message.success('智能冲突处理完成');
        return 'claude-success';
      }
      // 放弃 → 回退到手动冲突处理
      return 'claude-failed';
    } catch (e) {
      message.error('智能冲突处理出错: ' + e.message);
      setClaudeStreamModal((prev) => ({ ...prev, visible: false }));
      return 'claude-failed';
    } finally {
      setConflictClaudeLoading(false);
    }
  }, [project.name, project.path]);

  // 加载初始数据
  useEffect(() => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [useEffect init] 组件初始化，开始加载数据`);
    
    const init = async () => {
      try {
        console.log(`[${timestamp}] [init] 开始异步初始化...`);
        await loadSettings();
        console.log(`[${timestamp}] [init] 设置加载完成`);
        
        await loadCurrentUser();
        console.log(`[${timestamp}] [init] 用户配置加载完成`);
        
        await loadBranches();
        console.log(`[${timestamp}] [init] 分支加载完成`);
        
        const branch = await loadCurrentBranch();
        console.log(`[${timestamp}] [init] 当前分支加载完成`);

        if (branch) {
          setViewBranch(branch);
          setOriginalBranch(branch);
        }

        setInitialized(true);
        console.log(`[${timestamp}] [init] 初始化标志已设置`);
      } catch (error) {
        console.error(`[${timestamp}] [init] 初始化失败:`, error);
      }
    };
    init();
  }, []);

  // 当viewBranch变化时加载提交记录
  useEffect(() => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [useEffect commits] 检测到依赖变化`);
    console.log(`[${timestamp}] [useEffect commits] - viewBranch: ${viewBranch}`);
    console.log(`[${timestamp}] [useEffect commits] - initialized: ${initialized}`);

    if (viewBranch && initialized) {
      console.log(`[${timestamp}] [useEffect commits] 条件满足，开始加载提交记录`);
      setSelectedCommits([]);
      loadCommits(viewBranch, true);
      allCommitsLoadedRef.current = false;
      setAllCommits([]);
    } else {
      console.log(`[${timestamp}] [useEffect commits] 条件不满足，跳过加载`);
    }
  }, [viewBranch, initialized]);

  // 虚拟化列表滚动处理已集成在 List 组件中，无需额外滚动监听器

  const loadSettings = async () => {
    try {
      const settings = await window.electronAPI.settings.get();
      setSettings(settings);
    } catch (error) {
      console.error('加载设置失败:', error);
    }
  };

  const loadBranches = async () => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [loadBranches] 开始加载分支列表`);
    
    try {
      console.log(`[${timestamp}] [loadBranches] 调用 API 获取分支...`);
      const branches = await window.electronAPI.git.getBranches();
      
      console.log(`[${timestamp}] [loadBranches] 获取到 ${branches?.length || 0} 个分支`);
      console.log(`[${timestamp}] [loadBranches] 分支列表:`, branches?.slice(0, 5), branches?.length > 5 ? '...' : '');
      
      setBranches(branches);
      console.log(`[${timestamp}] [loadBranches] 分支列表已设置到状态`);
    } catch (error) {
      console.error(`[${timestamp}] [loadBranches] 加载分支失败:`, error);
      message.error('加载分支失败: ' + error.message);
    }
  };

  const loadCurrentBranch = async () => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [loadCurrentBranch] 开始获取当前分支`);
    
    try {
      console.log(`[${timestamp}] [loadCurrentBranch] 调用 API 获取当前分支...`);
      const branch = await window.electronAPI.git.getCurrentBranch();

      console.log(`[${timestamp}] [loadCurrentBranch] 当前分支: ${branch}`);
      setCurrentBranch(branch);
      console.log(`[${timestamp}] [loadCurrentBranch] 当前分支已设置到状态`);
      return branch;
    } catch (error) {
      console.error(`[${timestamp}] [loadCurrentBranch] 获取当前分支失败:`, error);
      message.error('获取当前分支失败: ' + error.message);
    }
  };

  const loadCurrentUser = async () => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [loadCurrentUser] 开始获取当前用户配置`);
    
    try {
      console.log(`[${timestamp}] [loadCurrentUser] 调用 API 获取用户配置...`);
      const user = await window.electronAPI.git.getUserConfig();
      
      console.log(`[${timestamp}] [loadCurrentUser] 用户名: ${user.name}, 邮箱: ${user.email}`);
      setCurrentUser(user);
      console.log(`[${timestamp}] [loadCurrentUser] 用户配置已设置到状态`);
    } catch (error) {
      console.error(`[${timestamp}] [loadCurrentUser] 获取用户配置失败:`, error);
    }
  };

  const loadCommits = async (branch, isInitial = true) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [loadCommits] 开始加载提交记录`);
    console.log(`[${timestamp}] [loadCommits] 参数: branch="${branch}", isInitial=${isInitial}`);
    
    if (!branch) {
      console.warn(`[${timestamp}] [loadCommits] 警告: 分支为空，跳过加载`);
      message.warning('当前分支为空，无法加载提交记录');
      return;
    }
    
    if (isInitial) {
      setLoading(true);
      setSkipCount(0);
      setHasMoreCommits(true);
    } else {
      setLoadingMore(true);
    }
    
    try {
      console.log(`[${timestamp}] [loadCommits] 调用 API 获取提交记录...`);
      const skipValue = isInitial ? 0 : skipCount;
      console.log(`[${timestamp}] [loadCommits] API调用参数: branch="${branch}", limit=50, skip=${skipValue}`);
      
      const newCommits = await window.electronAPI.git.getCommits(branch, 50, skipValue);
      
      console.log(`[${timestamp}] [loadCommits] API返回数据:`);
      console.log(`[${timestamp}] [loadCommits] - 新提交数量: ${newCommits?.length || 0}`);
      
      if (newCommits && newCommits.length > 0) {
        console.log(`[${timestamp}] [loadCommits] - 第一条提交:`, JSON.stringify(newCommits[0], null, 2));
        console.log(`[${timestamp}] [loadCommits] - 提交字段:`, Object.keys(newCommits[0]));
      }
      
      if (isInitial) {
        setCommits(newCommits || []);
        setSkipCount(newCommits?.length || 0);
      } else {
        setCommits(prev => [...prev, ...(newCommits || [])]);
        setSkipCount(prev => prev + (newCommits?.length || 0));
      }
      
      if (!newCommits || newCommits.length < 50) {
        setHasMoreCommits(false);
        console.log(`[${timestamp}] [loadCommits] 没有更多提交记录`);
      } else {
        setHasMoreCommits(true);
      }
      
      console.log(`[${timestamp}] [loadCommits] 提交记录已设置到状态`);
    } catch (error) {
      console.error(`[${timestamp}] [loadCommits] 加载提交历史失败:`, error);
      message.error('加载提交历史失败: ' + error.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      console.log(`[${timestamp}] [loadCommits] 加载完成`);
    }
  };

  const loadMoreCommits = () => {
    if (!loadingMore && hasMoreCommits && viewBranch) {
      console.log(`[loadMoreCommits] 加载更多提交...`);
      loadCommits(viewBranch, false);
    }
  };

  // 搜索防抖：统一处理防抖 + IPC 调用，用户暂停输入 300ms 后才触发
  useEffect(() => {
    if (searchHasLoadedRef.current) {
      searchHasLoadedRef.current = false;
    }
    if (searchDebouncerRef.current) {
      clearTimeout(searchDebouncerRef.current);
    }
    searchDebouncerRef.current = setTimeout(async () => {
      const activeSearch = searchText;
      if (activeSearch && viewBranch && !searchHasLoadedRef.current) {
        searchHasLoadedRef.current = true;
        try {
          const all = await window.electronAPI.git.getAllCommits(viewBranch);
          setAllCommits(all || []);
        } catch (error) {
          console.error('获取全部提交失败:', error);
        }
      } else if (!activeSearch) {
        searchHasLoadedRef.current = false;
      }
    }, 300);
    return () => clearTimeout(searchDebouncerRef.current);
  }, [searchText, viewBranch]);

  const handleRefresh = async () => {
    setSearchText('');
    setShowMyCommits(false);
    setAllCommits([]);
    allCommitsLoadedRef.current = false;
    if (viewBranch) {
      await loadCommits(viewBranch, true);
    }
    message.success('刷新成功');
  };

  const handleFetchOrigin = async () => {
    setFetchLoading(true);
    try {
      await window.electronAPI.git.fetch();
      message.success('Fetch成功');
      await loadBranches();
      if (viewBranch) {
        await loadCommits(viewBranch, true);
      }
    } catch (error) {
      message.error('Fetch失败: ' + error.message);
    } finally {
      setFetchLoading(false);
    }
  };

  const handlePullBranch = async () => {
    setLoading(true);
    try {
      await window.electronAPI.git.pull(currentBranch);
      message.success('拉取成功');
      await loadCommits(viewBranch, true);
    } catch (error) {
      message.error('拉取失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // 遴选推送整合按钮处理函数 - 添加进度条和成功弹窗
  const handleCherryPickAndPush = async () => {
    if (selectedCommits.length === 0) {
      message.warning('请选择要cherry-pick的提交');
      return;
    }
    if (selectedTargetBranches.length === 0) {
      message.warning(mergeType === 'custom' ? '请输入至少一个目标分支' : '请选择目标分支');
      return;
    }

    setLoading(true);

    // custom 模式：验证分支是否存在
    let effectiveBranches = selectedTargetBranches;
    if (mergeType === 'custom') {
      const { valid, invalid } = await validateCustomBranches(selectedTargetBranches);
      invalid.forEach(b => message.warning(`分支 "${b}" 不存在，已跳过`));
      if (valid.length === 0) {
        message.error('没有有效的目标分支，操作终止');
        setLoading(false);
        return;
      }
      effectiveBranches = valid;
    }

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [handleCherryPickAndPush] 开始遴选推送`);
    console.log(`[${timestamp}] [handleCherryPickAndPush] 选中的提交: ${selectedCommits.length}个`);
    console.log(`[${timestamp}] [handleCherryPickAndPush] 目标分支: ${effectiveBranches.join(', ')}`);

    const totalOperations = effectiveBranches.length;
    const results = [];

    // 检查是否有未提交的更改，如果有则自动 stash
    const hasUncommitted = await window.electronAPI.git.hasUncommittedChanges();
    if (hasUncommitted) {
      console.log(`[${new Date().toISOString()}] [handleCherryPickAndPush] 检测到未提交的更改，自动 stash`);
      await window.electronAPI.git.stashCreate('Git合并辅助工具自动暂存');
      message.info('已自动暂存未提交的更改');
    }

    setCherryPickProgress({
      visible: true,
      current: 0,
      total: totalOperations * 2,
      status: '正在准备遴选推送...',
      results: []
    });

    // 存储成功 cherry-pick 的分支，用于第二阶段推送
    const cherryPickedBranches = [];
    const originalBranch = currentBranch;

    try {

      // 在循环开始前保存 selectedCommits 的副本，确保在循环期间不会被修改
      const commitsToCherryPick = [...selectedCommits];
      console.log(`[${new Date().toISOString()}] [handleCherryPickAndPush] 保存提交列表副本: ${commitsToCherryPick.length}个提交`, commitsToCherryPick);

      // ========== 第一阶段：对所有目标分支进行 cherry-pick ==========
      console.log(`[${new Date().toISOString()}] [handleCherryPickAndPush] ========== 第一阶段：Cherry-pick 到所有目标分支 ==========`);

      // 读取当前项目根 pom.xml 的 parent.version 作为源版本基线（遴选前读取，假设 pom.xml 不在遴选改动里）
      let sourceVersion = null;
      try {
        const sourcePom = await window.electronAPI.git.readPomParentVersion();
        if (sourcePom.success) {
          sourceVersion = normalizeVersion(sourcePom.version);
          console.log(`[handleCherryPickAndPush] 源项目根 pom parent.version=${sourcePom.version} → 归一化 ${sourceVersion}`);
        } else {
          console.warn(`[handleCherryPickAndPush] 读取源 pom 失败(${sourcePom.error})，跨版本替换将跳过`);
        }
      } catch (e) {
        console.warn(`[handleCherryPickAndPush] 读取源 pom 异常: ${e.message}`);
      }

      for (let i = 0; i < effectiveBranches.length; i++) {
        const targetBranch = effectiveBranches[i];
        const currentOp = i + 1;
        const opTimestamp = new Date().toISOString();
        
        console.log(`[${opTimestamp}] [handleCherryPickAndPush] 开始 cherry-pick 第 ${currentOp}/${totalOperations} 个目标分支: ${targetBranch}`);
        console.log(`[${opTimestamp}] [handleCherryPickAndPush] 当前 selectedCommits 状态: ${selectedCommits.length}个`, selectedCommits);
        console.log(`[${opTimestamp}] [handleCherryPickAndPush] 使用副本进行 cherry-pick: ${commitsToCherryPick.length}个`, commitsToCherryPick);
        
        setCherryPickProgress(prev => ({
          ...prev,
          status: `Cherry-pick ${currentOp}/${totalOperations}: ${targetBranch}`
        }));

        setCherryPickProgress(prev => ({
          ...prev,
          status: `强制同步分支(以远程覆盖本地): ${targetBranch}`
        }));

        // 强制使用远程分支覆盖本地分支（远程不存在时跳过更新）
        const syncResult = await window.electronAPI.git.forceSyncBranch(targetBranch);
        if (syncResult.remoteExists === false) {
          console.log(`[handleCherryPickAndPush] 远程分支不存在: origin/${targetBranch}，已跳过远程更新，继续使用本地分支`);
        }

        // 记录遴选前 HEAD sha，用于后续版本替换的文件 diff 范围与 squash 基点
        const beforePickSha = (await window.electronAPI.git.getHeadSha()).sha;

        setCherryPickProgress(prev => ({
          ...prev,
          status: `Cherry-pick 提交到: ${targetBranch}`
        }));

        // 逐 commit cherry-pick，支持冲突解决
        console.log(`[${opTimestamp}] [handleCherryPickAndPush] 开始逐 commit cherry-pick: ${commitsToCherryPick.length} 个提交`);

        let branchHasError = false;
        let hasCherryPickContent = false;

        for (const sha of commitsToCherryPick) {
          if (branchHasError) break;

          const singleResult = await window.electronAPI.git.cherryPickSingle(sha);

          if (singleResult.status === 'success') {
            hasCherryPickContent = true;
            console.log(`[${opTimestamp}] [handleCherryPickAndPush] commit ${sha.substring(0, 8)} cherry-pick 成功`);
          } else if (singleResult.status === 'skipped') {
            console.log(`[${opTimestamp}] [handleCherryPickAndPush] commit ${sha.substring(0, 8)} 已存在，跳过`);
            console.log(`[${opTimestamp}] [handleCherryPickAndPush] commit ${sha.substring(0, 8)} 已存在，跳过`);
          } else if (singleResult.status === 'conflict') {
            console.log(`[${opTimestamp}] [handleCherryPickAndPush] commit ${sha.substring(0, 8)} 发生冲突`);
            const conflictedFiles = singleResult.conflictedFiles || [];

            // [新增] 多语言文件自动合并检测
            if (isMultiLanguageConflict(conflictedFiles)) {
              console.log(`[${opTimestamp}] [handleCherryPickAndPush] 检测到纯多语言文件冲突，尝试自动合并`);
              const autoResult = await handleAutoMergeLanguageFiles(targetBranch, sha, conflictedFiles);
              if (autoResult === 'auto-success') {
                const continueResult = await window.electronAPI.git.cherryPickContinue();
                if (continueResult.success) {
                  hasCherryPickContent = true;
                  continue; // 跳过手动冲突处理，继续下一个 commit
                }
                // 自动合并后 continue 失败
                const choice = await showSkipAbortDialog(
                  '自动合并后继续 cherry-pick 失败',
                  <div>
                    <p>多语言文件自动合并成功，但继续 cherry-pick 失败：{continueResult.error}</p>
                    <p>请选择操作：</p>
                  </div>
                );
                if (choice === 'abort') {
                  setCherryPickProgress(prev => ({ ...prev, visible: false, status: '操作已终止' }));
                  setLoading(false);
                  message.error('操作已终止');
                  return;
                } else {
                  branchHasError = true;
                  results.push({ success: false, targetBranch, error: continueResult.error, skipped: true });
                }
                continue;
              }
              // autoResult === 'fallback' → 继续走手动冲突处理
              message.warning('多语言自动合并失败，切换到手动处理模式');
            }

            // 显示冲突解决 modal，等待用户操作
            const userAction = await new Promise((resolve) => {
              conflictResolveRef.current = resolve;
              setConflictModal({
                visible: true,
                files: conflictedFiles.map(p => ({ path: p, resolved: false })),
                branch: targetBranch,
                sha: sha
              });
            });

            // 关闭冲突 modal
            setConflictModal(prev => ({ ...prev, visible: false }));

            if (userAction === 'claude-resolve') {
              // [新增] Claude 智能冲突处理
              const claudeResult = await handleClaudeResolveConflicts(targetBranch, conflictedFiles);
              if (claudeResult === 'claude-success') {
                const continueResult = await window.electronAPI.git.cherryPickContinue();
                if (continueResult.success) {
                  hasCherryPickContent = true;
                } else {
                  const choice = await showSkipAbortDialog(
                    '智能处理后继续 cherry-pick 失败',
                    <div>
                      <p>智能冲突处理完成，但继续 cherry-pick 失败：{continueResult.error}</p>
                      <p>请选择操作：</p>
                    </div>
                  );
                  if (choice === 'abort') {
                    setCherryPickProgress(prev => ({ ...prev, visible: false, status: '操作已终止' }));
                    setLoading(false);
                    message.error('操作已终止');
                    return;
                  } else {
                    branchHasError = true;
                    results.push({ success: false, targetBranch, error: continueResult.error, skipped: true });
                  }
                }
              } else {
                // Claude 失败 → 重新打开 conflictModal 让用户手动处理
                message.warning('智能处理失败，请手动解决冲突');
                const retryAction = await new Promise((resolve) => {
                  conflictResolveRef.current = resolve;
                  setConflictModal({
                    visible: true,
                    files: conflictedFiles.map(p => ({ path: p, resolved: false })),
                    branch: targetBranch,
                    sha: sha
                  });
                });
                setConflictModal(prev => ({ ...prev, visible: false }));

                if (retryAction === 'confirm') {
                  const continueResult = await window.electronAPI.git.cherryPickContinue();
                  if (!continueResult.success) {
                    const choice = await showSkipAbortDialog(
                      '继续 cherry-pick 失败',
                      <div><p>解决冲突后继续 cherry-pick 失败：{continueResult.error}</p><p>请选择操作：</p></div>
                    );
                    if (choice === 'abort') {
                      setCherryPickProgress(prev => ({ ...prev, visible: false, status: '操作已终止' }));
                      setLoading(false);
                      message.error('操作已终止');
                      return;
                    } else {
                      branchHasError = true;
                      results.push({ success: false, targetBranch, error: continueResult.error, skipped: true });
                    }
                  } else {
                    hasCherryPickContent = true;
                  }
                } else {
                  await window.electronAPI.git.cherryPickAbort();
                  const choice = await showSkipAbortDialog(
                    '已放弃冲突解决',
                    <div><p>已放弃解决冲突，cherry-pick 已中止。</p><p>请选择操作：</p></div>
                  );
                  if (choice === 'abort') {
                    setCherryPickProgress(prev => ({ ...prev, visible: false, status: '操作已终止' }));
                    setLoading(false);
                    message.error('操作已终止');
                    return;
                  } else {
                    branchHasError = true;
                    results.push({ success: false, targetBranch, error: '用户放弃冲突解决', skipped: true });
                  }
                }
              }
              setConflictClaudeLoading(false);
            } else if (userAction === 'confirm') {
              // 用户确认已解决冲突 → 继续 cherry-pick
              const continueResult = await window.electronAPI.git.cherryPickContinue();
              if (!continueResult.success) {
                // continue 也失败，询问跳过/终止
                const choice = await showSkipAbortDialog(
                  '继续 cherry-pick 失败',
                  <div>
                    <p>解决冲突后继续 cherry-pick 失败：{continueResult.error}</p>
                    <p>请选择操作：</p>
                  </div>
                );
                if (choice === 'abort') {
                  setCherryPickProgress(prev => ({ ...prev, visible: false, status: '操作已终止' }));
                  setLoading(false);
                  message.error('操作已终止');
                  return;
                } else {
                  branchHasError = true;
                  results.push({
                    success: false,
                    targetBranch: targetBranch,
                    error: continueResult.error,
                    skipped: true
                  });
                }
              } else {
                hasCherryPickContent = true;
              }
            } else {
              // 用户取消 → abort → 询问跳过/终止
              await window.electronAPI.git.cherryPickAbort();
              const choice = await showSkipAbortDialog(
                '已放弃冲突解决',
                <div>
                  <p>已放弃解决冲突，cherry-pick 已中止。</p>
                  <p>请选择操作：</p>
                </div>
              );
              if (choice === 'abort') {
                setCherryPickProgress(prev => ({ ...prev, visible: false, status: '操作已终止' }));
                setLoading(false);
                message.error('操作已终止');
                return;
              } else {
                branchHasError = true;
                results.push({
                  success: false,
                  targetBranch: targetBranch,
                  error: '用户放弃冲突解决',
                  skipped: true
                });
              }
            }
          } else if (singleResult.status === 'error') {
            // 其他错误
            console.error(`[${opTimestamp}] [handleCherryPickAndPush] commit ${sha.substring(0, 8)} 出错: ${singleResult.error}`);

            const choice = await showSkipAbortDialog(
              `Commit ${sha.substring(0, 8)} cherry-pick 失败`,
              <div>
                <p>错误信息：{singleResult.error}</p>
                <p>请选择操作：</p>
              </div>
            );

            if (choice === 'abort') {
              setCherryPickProgress(prev => ({ ...prev, visible: false, status: '操作已终止' }));
              setLoading(false);
              message.error('操作已终止');
              return;
            } else {
              branchHasError = true;
              results.push({
                success: false,
                targetBranch: targetBranch,
                error: singleResult.error,
                skipped: true
              });
            }
          }
        }

        if (!branchHasError) {
          // 通过 git 实际检查遴选后是否有新的提交
          const newCommitCheck = await window.electronAPI.git.checkHasNewCommits(targetBranch);
          if (newCommitCheck.hasNewCommits) {
            // 跨版本基线替换 + squash（跳过条件均不阻断主流程）
            await applyBaselineReplacementAndSquash({
              beforePickSha,
              targetBranch,
              currentV: sourceVersion,
              setProgress: (status) => setCherryPickProgress(prev => ({ ...prev, status }))
            });
            // 有实际合并内容，记录该分支用于后续推送
            cherryPickedBranches.push(targetBranch);
            console.log(`[${opTimestamp}] [handleCherryPickAndPush] ${targetBranch} cherry-pick 成功`);
          } else {
            // 无新的提交，提示用户
            console.log(`[${opTimestamp}] [handleCherryPickAndPush] ${targetBranch} 无需要合并的内容，跳过`);
            const shouldSkip = await new Promise((resolve) => {
              Modal.confirm({
                title: `分支 ${targetBranch} 无需要合并的内容`,
                content: '所选提交在该分支中已全部存在，无需要合并的内容。是否跳过此分支继续操作？',
                okText: '跳过',
                cancelText: '终止操作',
                onOk: () => resolve(true),
                onCancel: () => resolve(false),
              });
            });
            if (!shouldSkip) {
              setCherryPickProgress(prev => ({ ...prev, visible: false }));
              message.error('操作已终止');
              setLoading(false);
              return;
            }
          }
        }

      setCherryPickProgress(prev => ({
        ...prev,
        current: currentOp,
        results: [...results]
      }));
    }

      // ========== 第二阶段：对所有成功 cherry-pick 的分支进行推送 ==========
      console.log(`[${new Date().toISOString()}] [handleCherryPickAndPush] ========== 第二阶段：推送到所有目标分支 ==========`);
      
      setCherryPickProgress(prev => ({
        ...prev,
        current: totalOperations,
        status: '推送分支...'
      }));

      for (let i = 0; i < cherryPickedBranches.length; i++) {
        const targetBranch = cherryPickedBranches[i];
        const currentOp = i + 1;
        const opTimestamp = new Date().toISOString();
        
        console.log(`[${opTimestamp}] [handleCherryPickAndPush] 开始推送第 ${currentOp}/${cherryPickedBranches.length} 个分支: ${targetBranch}`);
        
        setCherryPickProgress(prev => ({
          ...prev,
          status: `推送 ${currentOp}/${cherryPickedBranches.length}: ${targetBranch}`
        }));

        try {
          // 切换到目标分支
          await window.electronAPI.git.checkout(targetBranch);
          
          // 推送
          await window.electronAPI.git.push(targetBranch);

          results.push({
            success: true,
            targetBranch: targetBranch,
            message: `成功推送到 ${targetBranch}`
          });

          console.log(`[${opTimestamp}] [handleCherryPickAndPush] ${targetBranch} 推送成功`);

        } catch (error) {
          console.error(`[${opTimestamp}] [handleCherryPickAndPush] ${targetBranch} 推送失败:`, error);
          
          results.push({
            success: false,
            targetBranch: targetBranch,
            error: error.message
          });
        }

        setCherryPickProgress(prev => ({
          ...prev,
          current: totalOperations + currentOp,
          results: [...results]
        }));
      }

      const finalTimestamp = new Date().toISOString();
      console.log(`[${finalTimestamp}] [handleCherryPickAndPush] 所有操作完成`);
      console.log(`[${finalTimestamp}] [handleCherryPickAndPush] 结果统计:`, {
        total: results.length,
        success: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      });

      setCherryPickProgress(prev => ({
        ...prev,
        visible: false
      }));

      setCherryPickResultModal({
        visible: true,
        success: results.every(r => r.success),
        results: results
      });

      if (results.every(r => r.success)) {
        message.success('遴选推送完成！');
      } else {
        message.warning('部分推送失败，请查看详情');
      }

      setSelectedCommits([]);

    } catch (error) {
      const errorTimestamp = new Date().toISOString();
      console.error(`[${errorTimestamp}] [handleCherryPickAndPush] 遴选推送失败:`, error);
      message.error('遴选推送失败: ' + error.message);
      setCherryPickProgress(prev => ({
        ...prev,
        visible: false
      }));
    } finally {
      // 确保切回原始分支
      if (originalBranch) {
        try {
          await window.electronAPI.git.checkout(originalBranch);
        } catch (e) {
          console.error('切回原始分支失败:', e);
        }
      }

      setLoading(false);

      // 如果之前自动 stash 了未提交的更改，现在恢复
      if (hasUncommitted) {
        console.log(`[${new Date().toISOString()}] [handleCherryPickAndPush] 恢复之前 stash 的更改`);
        try {
          await window.electronAPI.git.stashPop();
          message.info('已恢复之前暂存的更改');
        } catch (error) {
          console.error(`[${new Date().toISOString()}] [handleCherryPickAndPush] 恢复 stash 失败:`, error);
          message.warning('恢复暂存的更改失败，请手动处理');
        }
      }
      
      await loadCurrentBranch();
      await loadCommits(viewBranch, true);
    }
  };

  const handleCreateMergeBranch = async () => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [handleCreateMergeBranch] 开始创建合并分支`);
    console.log(`[${timestamp}] [handleCreateMergeBranch] 选中的提交: ${selectedCommits.length}个`);
    console.log(`[${timestamp}] [handleCreateMergeBranch] 目标分支: ${selectedTargetBranches.join(', ')}`);

    if (selectedCommits.length === 0) {
      message.warning('请选择要合并的提交');
      return;
    }
    if (selectedTargetBranches.length === 0) {
      message.warning(mergeType === 'custom' ? '请输入至少一个目标分支' : '请选择目标分支');
      return;
    }

    setLoading(true);

    // custom 模式：验证分支是否存在
    let effectiveBranches = selectedTargetBranches;
    if (mergeType === 'custom') {
      const { valid, invalid } = await validateCustomBranches(selectedTargetBranches);
      invalid.forEach(b => message.warning(`分支 "${b}" 不存在，已跳过`));
      if (valid.length === 0) {
        message.error('没有有效的目标分支，操作终止');
        setLoading(false);
        return;
      }
      effectiveBranches = valid;
    }

    if (!settings.gitlabServerUrl || !settings.gitlabAccessToken) {
      console.warn(`[${timestamp}] [handleCreateMergeBranch] GitLab配置缺失`);
      message.warning('请先配置GitLab服务器地址和访问令牌');
      setSettingsVisible(true);
      setLoading(false);
      return;
    }

    const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    const totalOperations = effectiveBranches.length;
    const results = [];

    // 检查是否有未提交的更改，如果有则自动 stash
    const hasUncommitted = await window.electronAPI.git.hasUncommittedChanges();
    if (hasUncommitted) {
      console.log(`[${new Date().toISOString()}] [handleCreateMergeBranch] 检测到未提交的更改，自动 stash`);
      await window.electronAPI.git.stashCreate('Git合并辅助工具自动暂存');
      message.info('已自动暂存未提交的更改');
    }

    setMergeProgress({
      visible: true,
      current: 0,
      total: totalOperations * 2,
      status: '正在准备创建合并分支...',
      results: []
    });

    // 提取问题单号
    const selectedCommitsData = selectedCommits.map(hash => findCommitByHash(hash)).filter(Boolean);
    const issueNumber = extractIssueNumber(selectedCommitsData);
    const username = currentUser.name || 'unknown';

    console.log(`[${new Date().toISOString()}] [handleCreateMergeBranch] 提取到问题单号: ${issueNumber || '无'}`);
    console.log(`[${new Date().toISOString()}] [handleCreateMergeBranch] 当前用户名: ${username}`);

    // 保存原始分支，用于最后切换回去
    const originalBranch = currentBranch;
    console.log(`[${new Date().toISOString()}] [handleCreateMergeBranch] 保存原始分支: ${originalBranch}`);
    
    // 记录所有创建的本地分支，用于最后清理
    const createdBranches = [];

    // 存储每个目标分支的信息，用于第二阶段
    const branchInfos = [];

    // 在循环开始前保存 selectedCommits 的副本，确保在循环期间不会被修改
    const commitsToCherryPick = [...selectedCommits];
    console.log(`[${new Date().toISOString()}] [handleCreateMergeBranch] 保存提交列表副本: ${commitsToCherryPick.length}个提交`, commitsToCherryPick);

    try {
      // ========== 第一阶段：对所有目标分支进行 cherry-pick ==========
      console.log(`[${new Date().toISOString()}] [handleCreateMergeBranch] ========== 第一阶段：Cherry-pick 到所有目标分支 ==========`);

      // 读取当前项目根 pom.xml 的 parent.version 作为源版本基线（遴选前读取，假设 pom.xml 不在遴选改动里）
      let sourceVersion = null;
      try {
        const sourcePom = await window.electronAPI.git.readPomParentVersion();
        if (sourcePom.success) {
          sourceVersion = normalizeVersion(sourcePom.version);
          console.log(`[handleCreateMergeBranch] 源项目根 pom parent.version=${sourcePom.version} → 归一化 ${sourceVersion}`);
        } else {
          console.warn(`[handleCreateMergeBranch] 读取源 pom 失败(${sourcePom.error})，跨版本替换将跳过`);
        }
      } catch (e) {
        console.warn(`[handleCreateMergeBranch] 读取源 pom 异常: ${e.message}`);
      }

      for (let i = 0; i < effectiveBranches.length; i++) {
        const targetBranch = effectiveBranches[i];
        const currentOp = i + 1;
        const opTimestamp = new Date().toISOString();
        
        console.log(`[${opTimestamp}] [handleCreateMergeBranch] 开始处理第 ${currentOp}/${totalOperations} 个目标分支: ${targetBranch}`);
        console.log(`[${opTimestamp}] [handleCreateMergeBranch] 当前 selectedCommits 状态: ${selectedCommits.length}个`, selectedCommits);
        console.log(`[${opTimestamp}] [handleCreateMergeBranch] 使用副本进行 cherry-pick: ${commitsToCherryPick.length}个`, commitsToCherryPick);
        
        setMergeProgress(prev => ({
          ...prev,
          status: `Cherry-pick ${currentOp}/${totalOperations}: ${targetBranch}`
        }));

        // 使用新的分支命名格式
        const mergeBranchName = generateBranchName(targetBranch, issueNumber, username);
        let actualBranchName = mergeBranchName; // 实际使用的分支名，冲突时可能使用已有分支

        console.log(`[${opTimestamp}] [handleCreateMergeBranch] 检查远程分支冲突: ${mergeBranchName}`);
        const conflictCheck = await window.electronAPI.git.checkBranchNameConflict(mergeBranchName);

        let isExistingRemoteBranch = false;

        if (conflictCheck.conflict) {
          console.log(`[${opTimestamp}] [handleCreateMergeBranch] 远程分支冲突: ${conflictCheck.type}, 冲突分支: ${conflictCheck.conflictingBranch}`);
          const userAction = await showMergeBranchConflictDialog(mergeBranchName, {
            type: conflictCheck.type,
            conflictingBranch: conflictCheck.conflictingBranch
          });

          if (userAction === 'merge') {
            console.log(`[${opTimestamp}] [handleCreateMergeBranch] 用户选择合并到已有分支: ${conflictCheck.conflictingBranch}`);
            isExistingRemoteBranch = true;
            actualBranchName = conflictCheck.conflictingBranch;
            setMergeProgress(prev => ({
              ...prev,
              status: `强制同步已有分支(以远程覆盖本地): ${actualBranchName}`
            }));
            const syncResult = await window.electronAPI.git.forceSyncBranch(actualBranchName);
            if (syncResult.remoteExists === false) {
              console.log(`[handleCreateMergeBranch] 远程分支不存在: origin/${actualBranchName}，已跳过远程更新，继续使用本地分支`);
            } else {
              console.log(`[${opTimestamp}] [handleCreateMergeBranch] 已强制同步已有分支至远程最新: ${actualBranchName}`);
            }
          } else if (userAction === 'delete-remote') {
            console.log(`[${opTimestamp}] [handleCreateMergeBranch] 用户选择删除远程分支并重建: ${conflictCheck.conflictingBranch}`);
            setMergeProgress(prev => ({
              ...prev,
              status: `删除远程分支: ${conflictCheck.conflictingBranch}`
            }));
            const deleteResult = await window.electronAPI.git.deleteRemoteBranch(conflictCheck.conflictingBranch);
            if (!deleteResult.success) {
              message.error(`删除远程分支失败: ${deleteResult.error}`);
              throw new Error(`删除远程分支失败: ${deleteResult.error}`);
            }
            message.info(`已删除远程分支 ${conflictCheck.conflictingBranch}`);
            console.log(`[${opTimestamp}] [handleCreateMergeBranch] 远程分支已删除，继续创建新分支`);
          } else if (userAction === 'rename') {
            console.log(`[${opTimestamp}] [handleCreateMergeBranch] 用户选择生成新分支名`);
            setMergeProgress(prev => ({
              ...prev,
              status: '生成新分支名...'
            }));
            let newBranchName;
            let newConflictCheck;
            do {
              newBranchName = `${mergeBranchName}.${generateRandomBranchSuffix()}`;
              newConflictCheck = await window.electronAPI.git.checkBranchNameConflict(newBranchName);
            } while (newConflictCheck.conflict);
            actualBranchName = newBranchName;
            console.log(`[${opTimestamp}] [handleCreateMergeBranch] 已生成新分支名: ${actualBranchName}`);
            message.info(`已生成新分支名: ${actualBranchName}`);
          } else if (userAction === 'skip') {
            console.log(`[${opTimestamp}] [handleCreateMergeBranch] 用户选择跳过分支 ${targetBranch}`);
            results.push({
              success: true,
              targetBranch: targetBranch,
              mergeBranch: mergeBranchName,
              error: null,
              skipped: true
            });
            continue;
          } else {
            console.log(`[${opTimestamp}] [handleCreateMergeBranch] 用户选择终止操作`);
            setMergeProgress(prev => ({ ...prev, status: '操作已终止' }));
            message.error('操作已终止');
            throw new Error('用户终止操作');
          }
        }

        if (!isExistingRemoteBranch) {
          setMergeProgress(prev => ({
            ...prev,
            status: `创建分支: ${actualBranchName}`
          }));

          try {
            await window.electronAPI.git.createBranch(actualBranchName, `origin/${targetBranch}`);
            // 记录创建的本地分支
            createdBranches.push(actualBranchName);
            console.log(`[${opTimestamp}] [handleCreateMergeBranch] 记录创建的本地分支: ${actualBranchName}`);
          } catch (error) {
            if (error.message.includes('fatal: A branch named')) {
              console.log(`分支 ${actualBranchName} 已存在，尝试直接切换`);
              await window.electronAPI.git.checkout(actualBranchName);
              // 即使分支已存在，也记录用于清理（如果之前不是我们创建的）
              if (!createdBranches.includes(actualBranchName)) {
                createdBranches.push(actualBranchName);
              }
            } else {
              throw error;
            }
          }
        }

        // 记录遴选前 HEAD sha，用于后续版本替换的文件 diff 范围与 squash 基点
        const beforePickSha = (await window.electronAPI.git.getHeadSha()).sha;

        setMergeProgress(prev => ({
          ...prev,
          status: `Cherry-pick 提交到: ${targetBranch}`
        }));

        // 逐 commit cherry-pick，支持冲突解决
        console.log(`[${opTimestamp}] [handleCreateMergeBranch] 开始逐 commit cherry-pick: ${commitsToCherryPick.length} 个提交`);

        let branchHasError = false;
        let hasCherryPickContent = false;

        for (const sha of commitsToCherryPick) {
          if (branchHasError) break;

          const singleResult = await window.electronAPI.git.cherryPickSingle(sha);

          if (singleResult.status === 'success') {
            hasCherryPickContent = true;
            console.log(`[${opTimestamp}] [handleCreateMergeBranch] commit ${sha.substring(0, 8)} cherry-pick 成功`);
          } else if (singleResult.status === 'skipped') {
            console.log(`[${opTimestamp}] [handleCreateMergeBranch] commit ${sha.substring(0, 8)} 已存在，跳过`);
          } else if (singleResult.status === 'conflict') {
            console.log(`[${opTimestamp}] [handleCreateMergeBranch] commit ${sha.substring(0, 8)} 发生冲突`);
            const conflictedFiles = singleResult.conflictedFiles || [];

            // [新增] 多语言文件自动合并检测
            if (isMultiLanguageConflict(conflictedFiles)) {
              console.log(`[${opTimestamp}] [handleCreateMergeBranch] 检测到纯多语言文件冲突，尝试自动合并`);
              const autoResult = await handleAutoMergeLanguageFiles(targetBranch, sha, conflictedFiles);
              if (autoResult === 'auto-success') {
                const continueResult = await window.electronAPI.git.cherryPickContinue();
                if (continueResult.success) {
                  hasCherryPickContent = true;
                  continue; // 跳过手动冲突处理，继续下一个 commit
                }
                const choice = await showSkipAbortDialog(
                  '自动合并后继续 cherry-pick 失败',
                  <div>
                    <p>多语言文件自动合并成功，但继续 cherry-pick 失败：{continueResult.error}</p>
                    <p>请选择操作：</p>
                  </div>
                );
                if (choice === 'abort') {
                  setMergeProgress(prev => ({ ...prev, status: '操作已终止' }));
                  message.error('操作已终止');
                  throw new Error('用户终止操作');
                } else {
                  branchHasError = true;
                  results.push({ success: false, targetBranch, mergeBranch: mergeBranchName, error: continueResult.error, skipped: true });
                }
                continue;
              }
              message.warning('多语言自动合并失败，切换到手动处理模式');
            }

            const userAction = await new Promise((resolve) => {
              conflictResolveRef.current = resolve;
              setConflictModal({
                visible: true,
                files: conflictedFiles.map(p => ({ path: p, resolved: false })),
                branch: targetBranch,
                sha: sha
              });
            });

            setConflictModal(prev => ({ ...prev, visible: false }));

            if (userAction === 'claude-resolve') {
              // [新增] Claude 智能冲突处理
              const claudeResult = await handleClaudeResolveConflicts(targetBranch, conflictedFiles);
              if (claudeResult === 'claude-success') {
                const continueResult = await window.electronAPI.git.cherryPickContinue();
                if (continueResult.success) {
                  hasCherryPickContent = true;
                } else {
                  const choice = await showSkipAbortDialog(
                    '智能处理后继续 cherry-pick 失败',
                    <div>
                      <p>智能冲突处理完成，但继续 cherry-pick 失败：{continueResult.error}</p>
                      <p>请选择操作：</p>
                    </div>
                  );
                  if (choice === 'abort') {
                    setMergeProgress(prev => ({ ...prev, status: '操作已终止' }));
                    message.error('操作已终止');
                    throw new Error('用户终止操作');
                  } else {
                    branchHasError = true;
                    results.push({ success: false, targetBranch, mergeBranch: mergeBranchName, error: continueResult.error, skipped: true });
                  }
                }
              } else {
                // Claude 失败 → 重新打开 conflictModal 让用户手动处理
                message.warning('智能处理失败，请手动解决冲突');
                const retryAction = await new Promise((resolve) => {
                  conflictResolveRef.current = resolve;
                  setConflictModal({
                    visible: true,
                    files: conflictedFiles.map(p => ({ path: p, resolved: false })),
                    branch: targetBranch,
                    sha: sha
                  });
                });
                setConflictModal(prev => ({ ...prev, visible: false }));

                if (retryAction === 'confirm') {
                  const continueResult = await window.electronAPI.git.cherryPickContinue();
                  if (!continueResult.success) {
                    const choice = await showSkipAbortDialog(
                      '继续 cherry-pick 失败',
                      <div><p>解决冲突后继续 cherry-pick 失败：{continueResult.error}</p><p>请选择操作：</p></div>
                    );
                    if (choice === 'abort') {
                      setMergeProgress(prev => ({ ...prev, status: '操作已终止' }));
                      message.error('操作已终止');
                      throw new Error('用户终止操作');
                    } else {
                      branchHasError = true;
                      results.push({ success: false, targetBranch, mergeBranch: mergeBranchName, error: continueResult.error, skipped: true });
                    }
                  } else {
                    hasCherryPickContent = true;
                  }
                } else {
                  await window.electronAPI.git.cherryPickAbort();
                  const choice = await showSkipAbortDialog(
                    '已放弃冲突解决',
                    <div><p>已放弃解决冲突，cherry-pick 已中止。</p><p>请选择操作：</p></div>
                  );
                  if (choice === 'abort') {
                    setMergeProgress(prev => ({ ...prev, status: '操作已终止' }));
                    message.error('操作已终止');
                    throw new Error('用户终止操作');
                  } else {
                    branchHasError = true;
                    results.push({ success: false, targetBranch, mergeBranch: mergeBranchName, error: '用户放弃冲突解决', skipped: true });
                  }
                }
              }
              setConflictClaudeLoading(false);
            } else if (userAction === 'confirm') {
              const continueResult = await window.electronAPI.git.cherryPickContinue();
              if (!continueResult.success) {
                const choice = await showSkipAbortDialog(
                  '继续 cherry-pick 失败',
                  <div>
                    <p>解决冲突后继续 cherry-pick 失败：{continueResult.error}</p>
                    <p>请选择操作：</p>
                  </div>
                );
                if (choice === 'abort') {
                  setMergeProgress(prev => ({ ...prev, status: '操作已终止' }));
                  message.error('操作已终止');
                  throw new Error('用户终止操作');
                } else {
                  branchHasError = true;
                  results.push({
                    success: false,
                    targetBranch: targetBranch,
                    mergeBranch: mergeBranchName,
                    error: continueResult.error,
                    skipped: true
                  });
                }
              } else {
                hasCherryPickContent = true;
              }
            } else {
              await window.electronAPI.git.cherryPickAbort();
              const choice = await showSkipAbortDialog(
                '已放弃冲突解决',
                <div>
                  <p>已放弃解决冲突，cherry-pick 已中止。</p>
                  <p>请选择操作：</p>
                </div>
              );
              if (choice === 'abort') {
                setMergeProgress(prev => ({ ...prev, status: '操作已终止' }));
                message.error('操作已终止');
                throw new Error('用户终止操作');
              } else {
                branchHasError = true;
                results.push({
                  success: false,
                  targetBranch: targetBranch,
                  mergeBranch: mergeBranchName,
                  error: '用户放弃冲突解决',
                  skipped: true
                });
              }
            }
          } else if (singleResult.status === 'error') {
            console.error(`[${opTimestamp}] [handleCreateMergeBranch] commit ${sha.substring(0, 8)} 出错: ${singleResult.error}`);

            const choice = await showSkipAbortDialog(
              `Commit ${sha.substring(0, 8)} cherry-pick 失败`,
              <div>
                <p>错误信息：{singleResult.error}</p>
                <p>请选择操作：</p>
              </div>
            );

            if (choice === 'abort') {
              setMergeProgress(prev => ({ ...prev, status: '操作已终止' }));
              message.error('操作已终止');
              throw new Error('用户终止操作');
            } else {
              branchHasError = true;
              results.push({
                success: false,
                targetBranch: targetBranch,
                mergeBranch: mergeBranchName,
                error: singleResult.error,
                skipped: true
              });
            }
          }
        }

        if (!branchHasError) {
          // 通过 git 实际检查遴选后是否有新的提交
          const newCommitCheck = await window.electronAPI.git.checkHasNewCommits(targetBranch);
          if (newCommitCheck.hasNewCommits) {
            // 跨版本基线替换 + squash（跳过条件均不阻断主流程）
            await applyBaselineReplacementAndSquash({
              beforePickSha,
              targetBranch,
              currentV: sourceVersion,
              setProgress: (status) => setMergeProgress(prev => ({ ...prev, status }))
            });
            // 有实际合并内容，保存分支信息用于后续推送和创建MR
            branchInfos.push({
              targetBranch,
              mergeBranchName: actualBranchName,
              intendedBranchName: mergeBranchName,
              index: i
            });
            console.log(`[${opTimestamp}] [handleCreateMergeBranch] 第 ${currentOp}/${totalOperations} 个目标分支 cherry-pick 完成`);
          } else {
            // 无新的提交，清理并提示用户
            console.log(`[${opTimestamp}] [handleCreateMergeBranch] ${targetBranch} 无需要合并的内容，清理合并分支`);
            try {
              await window.electronAPI.git.checkout(originalBranch);
              await window.electronAPI.git.deleteLocalBranch(actualBranchName, true);
            } catch (e) {
              console.log(`[${opTimestamp}] [handleCreateMergeBranch] 清理合并分支 ${actualBranchName} 失败:`, e.message);
            }
            const shouldSkip = await new Promise((resolve) => {
              Modal.confirm({
                title: `分支 ${targetBranch} 无需要合并的内容`,
                content: '所选提交在该分支中已全部存在，无需要合并的内容。是否跳过此分支继续操作？',
                okText: '跳过',
                cancelText: '终止操作',
                onOk: () => resolve(true),
                onCancel: () => resolve(false),
              });
            });
            if (!shouldSkip) {
              setMergeProgress(prev => ({ ...prev, visible: false }));
              message.error('操作已终止');
              throw new Error('用户终止操作');
            }
          }
        }
      }

      // ========== 第二阶段：对所有目标分支进行推送和创建合并请求 ==========
      console.log(`[${new Date().toISOString()}] [handleCreateMergeBranch] ========== 第二阶段：推送和创建合并请求 ==========`);
      
      // 获取远程URL并提取项目路径（只需获取一次）
      const remoteUrl = await window.electronAPI.git.getRemoteUrl();
      console.log(`[${new Date().toISOString()}] [handleCreateMergeBranch] 远程URL: ${remoteUrl}`);
      
      let projectPath = '';
      if (remoteUrl) {
        const urlMatch = remoteUrl.match(/(?:https?:\/\/[^\/]+\/|git@[^:]+:)(.+?)(?:\.git)?$/);
        if (urlMatch) {
          projectPath = urlMatch[1];
        }
      }
      
      if (!projectPath) {
        console.error(`[${new Date().toISOString()}] [handleCreateMergeBranch] 无法从远程URL提取项目路径`);
        throw new Error('无法获取项目路径，请检查远程仓库配置');
      }
      
      console.log(`[${new Date().toISOString()}] [handleCreateMergeBranch] 项目路径: ${projectPath}`);

      // 通过 GitLab API 获取项目的数字 ID
      setMergeProgress(prev => ({
        ...prev,
        status: '正在获取项目信息...'
      }));

      const projectIdResult = await window.electronAPI.gitlab.getProjectId(
        settings.gitlabServerUrl,
        settings.gitlabAccessToken,
        projectPath
      );

      if (!projectIdResult.success) {
        console.error(`[${new Date().toISOString()}] [handleCreateMergeBranch] 获取项目ID失败:`, projectIdResult.error);
        throw new Error(`获取项目ID失败: ${projectIdResult.error}`);
      }

      const projectId = projectIdResult.projectId;
      console.log(`[${new Date().toISOString()}] [handleCreateMergeBranch] 项目数字ID: ${projectId}`);

      setMergeProgress(prev => ({
        ...prev,
        current: totalOperations,
        status: '推送和创建合并请求...'
      }));

      for (let i = 0; i < branchInfos.length; i++) {
        const { targetBranch, mergeBranchName } = branchInfos[i];
        const currentOp = i + 1;
        const opTimestamp = new Date().toISOString();
        
        console.log(`[${opTimestamp}] [handleCreateMergeBranch] 开始推送和创建MR ${currentOp}/${totalOperations}: ${targetBranch}`);
        
        setMergeProgress(prev => ({
          ...prev,
          status: `推送 ${currentOp}/${totalOperations}: ${mergeBranchName}`
        }));

        await window.electronAPI.git.push(mergeBranchName);

        setMergeProgress(prev => ({
          ...prev,
          status: `创建合并请求 ${currentOp}/${totalOperations}: ${targetBranch}`
        }));

        const mergeRequestResult = await window.electronAPI.gitlab.createMergeRequest(
          settings.gitlabServerUrl,
          settings.gitlabAccessToken,
          projectId,
          mergeBranchName,
          targetBranch,
          `${mergeBranchName} -> ${targetBranch}`,
          `由 Git合并辅助工具自动创建\n\n源分支: ${currentBranch}\n目标分支: ${targetBranch}\n提交数量: ${commitsToCherryPick.length}`
        );

        let mrUrl = '';
        if (mergeRequestResult.success) {
          mrUrl = `${settings.gitlabServerUrl.replace(/\/$/, '')}/${projectPath}/-/merge_requests/${mergeRequestResult.mergeRequest?.iid || ''}`;
          console.log(`[${opTimestamp}] [handleCreateMergeBranch] 合并请求创建成功: ${mrUrl}`);
        } else {
          console.error(`[${opTimestamp}] [handleCreateMergeBranch] 合并请求创建失败:`, mergeRequestResult.error);
        }

        results.push({
          success: mergeRequestResult.success,
          sourceBranch: currentBranch,
          targetBranch: targetBranch,
          mergeBranch: mergeBranchName,
          mrUrl: mrUrl,
          error: mergeRequestResult.error || null
        });

        setMergeProgress(prev => ({
          ...prev,
          current: totalOperations + currentOp,
          results: [...results]
        }));
        
        console.log(`[${opTimestamp}] [handleCreateMergeBranch] 第 ${currentOp}/${totalOperations} 个目标分支推送和MR创建完成`);
      }

      const finalTimestamp = new Date().toISOString();
      console.log(`[${finalTimestamp}] [handleCreateMergeBranch] 所有操作完成`);
      console.log(`[${finalTimestamp}] [handleCreateMergeBranch] 结果统计:`, {
        total: results.length,
        success: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      });
      
      setMergeProgress(prev => ({
        ...prev,
        visible: false
      }));

      setMergeResultModal({
        visible: true,
        success: results.every(r => r.success),
        results: results
      });

      if (results.every(r => r.success)) {
        message.success('所有合并分支和合并请求创建成功！');
      } else {
        message.warning('部分合并请求创建失败，请查看详情');
      }

    } catch (error) {
      const errorTimestamp = new Date().toISOString();
      console.error(`[${errorTimestamp}] [handleCreateMergeBranch] 创建合并分支失败:`, error);
      message.error('创建合并分支失败: ' + error.message);
      setMergeProgress(prev => ({
        ...prev,
        visible: false
      }));
    } finally {
      const cleanupTimestamp = new Date().toISOString();
      
      // 1. 切换回原始分支
      if (originalBranch) {
        try {
          console.log(`[${cleanupTimestamp}] [handleCreateMergeBranch] 切换回原始分支: ${originalBranch}`);
          await window.electronAPI.git.checkout(originalBranch);
          console.log(`[${cleanupTimestamp}] [handleCreateMergeBranch] 成功切换回原始分支`);
        } catch (error) {
          console.error(`[${cleanupTimestamp}] [handleCreateMergeBranch] 切换回原始分支失败:`, error.message);
        }
      }
      
      // 2. 清理本地分支（只删除本地，保留远程）
      if (createdBranches.length > 0) {
        console.log(`[${cleanupTimestamp}] [handleCreateMergeBranch] 开始清理本地分支:`, createdBranches);
        for (const branchName of createdBranches) {
          try {
            // 确保不在要删除的分支上
            if (originalBranch && branchName !== originalBranch) {
              const result = await window.electronAPI.git.deleteLocalBranch(branchName, true);
              if (result.success) {
                console.log(`[${cleanupTimestamp}] [handleCreateMergeBranch] 成功删除本地分支: ${branchName}`);
              } else {
                console.warn(`[${cleanupTimestamp}] [handleCreateMergeBranch] 删除本地分支 ${branchName} 失败:`, result.error);
              }
            }
          } catch (error) {
            console.error(`[${cleanupTimestamp}] [handleCreateMergeBranch] 删除本地分支 ${branchName} 时出错:`, error.message);
          }
        }
      }
      
      setLoading(false);
      
      // 如果之前自动 stash 了未提交的更改，现在恢复
      if (hasUncommitted) {
        console.log(`[${new Date().toISOString()}] [handleCreateMergeBranch] 恢复之前 stash 的更改`);
        try {
          await window.electronAPI.git.stashPop();
          message.info('已恢复之前暂存的更改');
        } catch (error) {
          console.error(`[${new Date().toISOString()}] [handleCreateMergeBranch] 恢复 stash 失败:`, error);
          message.warning('恢复暂存的更改失败，请手动处理');
        }
      }
      
      await loadBranches();
      await loadCurrentBranch(); // 重新加载当前分支状态
    }
  };

  const handleDetectConflicts = async () => {
    if (selectedCommits.length === 0) {
      message.warning('请选择要检测的提交记录');
      return;
    }
    if (selectedTargetBranches.length === 0) {
      message.warning(mergeType === 'custom' ? '请输入至少一个目标分支' : '请选择目标分支');
      return;
    }

    setConflictDetecting(true);
    setConflictProgress({
      visible: true,
      current: 0,
      total: selectedTargetBranches.length,
      status: mergeType === 'custom' ? '正在验证分支...' : '正在准备检测冲突...'
    });

    // custom 模式：验证分支是否存在
    let effectiveBranches = selectedTargetBranches;
    if (mergeType === 'custom') {
      const { valid, invalid } = await validateCustomBranches(selectedTargetBranches);
      invalid.forEach(b => message.warning(`分支 "${b}" 不存在，已跳过`));
      if (valid.length === 0) {
        message.error('没有有效的目标分支，操作终止');
        setConflictDetecting(false);
        setConflictProgress(prev => ({ ...prev, visible: false }));
        return;
      }
      effectiveBranches = valid;
    }

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [handleDetectConflicts] 开始检测冲突`);
    console.log(`[${timestamp}] [handleDetectConflicts] 选中的提交: ${selectedCommits.length}个`);
    console.log(`[${timestamp}] [handleDetectConflicts] 目标分支: ${effectiveBranches.join(', ')}`);

    setConflictProgress({
      visible: true,
      current: 0,
      total: effectiveBranches.length,
      status: '正在准备检测冲突...'
    });

    const commitsToCherryPick = [...selectedCommits];
    const results = [];
    const originalBranch = currentBranch;
    const username = currentUser.name || 'unknown';

    try {
      const hasChanges = await window.electronAPI.git.hasUncommittedChanges();
      if (hasChanges) {
        await window.electronAPI.git.stashCreate('Git合并辅助冲突检测stash');
      }

      for (let i = 0; i < effectiveBranches.length; i++) {
        const targetBranch = effectiveBranches[i];
        const opTimestamp = new Date().toISOString();
        const branchTs = Date.now();
        const tempBranchName = `test/${username}/${branchTs}`;

        console.log(`[${opTimestamp}] [handleDetectConflicts] 检测分支 ${i + 1}/${effectiveBranches.length}: ${targetBranch}`);
        console.log(`[${opTimestamp}] [handleDetectConflicts] 临时分支: ${tempBranchName}`);

        setConflictProgress(prev => ({
          ...prev,
          status: `正在检测 ${i + 1}/${effectiveBranches.length}: ${targetBranch}`
        }));

        try {
          // 强制使用远程分支覆盖本地分支（远程不存在时跳过更新）
          const syncResult = await window.electronAPI.git.forceSyncBranch(targetBranch);
          if (syncResult.remoteExists === false) {
            console.log(`[handleDetectConflicts] 远程分支不存在: origin/${targetBranch}，已跳过远程更新，继续使用本地分支`);
          }

          await window.electronAPI.git.createBranch(tempBranchName, `origin/${targetBranch}`);
          await window.electronAPI.git.checkout(tempBranchName);

          const cherryPickResult = await window.electronAPI.git.cherryPick(commitsToCherryPick);
          console.log(`[${opTimestamp}] [handleDetectConflicts] ${targetBranch} cherry-pick 结果:`, cherryPickResult);

          const hasConflict = cherryPickResult.errors && cherryPickResult.errors.length > 0;

          results.push({
            targetBranch,
            hasConflict,
            errorCount: cherryPickResult.errors?.length || 0,
            skippedCount: cherryPickResult.skipped?.length || 0,
            successCount: cherryPickResult.success?.length || 0
          });

          setConflictProgress(prev => ({
            ...prev,
            current: i + 1
          }));

          await window.electronAPI.git.checkout(targetBranch);

          try {
            await window.electronAPI.git.deleteLocalBranch(tempBranchName, true);
          } catch (e) {
            console.log(`[${opTimestamp}] [handleDetectConflicts] 删除临时分支 ${tempBranchName} 失败:`, e.message);
          }

          try {
            await window.electronAPI.git.raw(['cherry-pick', '--abort']);
          } catch (e) {
            // ignore
          }

        } catch (error) {
          console.error(`[${opTimestamp}] [handleDetectConflicts] ${targetBranch} 检测失败:`, error);
          results.push({
            targetBranch,
            hasConflict: true,
            errorCount: 1,
            skippedCount: 0,
            successCount: 0
          });

          setConflictProgress(prev => ({
            ...prev,
            current: i + 1
          }));

          try {
            await window.electronAPI.git.checkout(targetBranch);
          } catch (e) {
            // ignore
          }

          try {
            await window.electronAPI.git.deleteLocalBranch(tempBranchName, true);
          } catch (e) {
            // ignore
          }

          try {
            await window.electronAPI.git.raw(['cherry-pick', '--abort']);
          } catch (e) {
            // ignore
          }
        }
      }

      await window.electronAPI.git.checkout(originalBranch);

      if (hasChanges) {
        await window.electronAPI.git.stashPop();
      }

      console.log(`[${new Date().toISOString()}] [handleDetectConflicts] 检测完成，结果:`, results);

      const allNoConflict = results.every(r => !r.hasConflict);
      if (allNoConflict) {
        message.success('所有分支均无冲突');
      } else {
        message.warning('部分分支存在冲突');
      }

      setConflictResultModal({ visible: true, results });

    } catch (error) {
      console.error(`[${new Date().toISOString()}] [handleDetectConflicts] 检测失败:`, error);
      message.error('冲突检测失败: ' + error.message);

      try {
        await window.electronAPI.git.checkout(originalBranch);
      } catch (e) {
        // ignore
      }

      try {
        const hasChanges = await window.electronAPI.git.hasUncommittedChanges();
        if (hasChanges) {
          await window.electronAPI.git.stashPop();
        }
      } catch (e) {
        // ignore
      }
    } finally {
      setConflictDetecting(false);
      setConflictProgress(prev => ({ ...prev, visible: false }));
      await loadCurrentBranch();
    }
  };

  const handleDetectChanges = async () => {
    if (selectedCommits.length === 0) {
      message.warning('请选择要检测的提交记录');
      return;
    }
    if (selectedTargetBranches.length === 0) {
      message.warning(mergeType === 'custom' ? '请输入至少一个目标分支' : '请选择目标分支');
      return;
    }

    setChangeDetecting(true);
    setChangeDetectProgress({
      visible: true,
      current: 0,
      total: selectedTargetBranches.length,
      status: mergeType === 'custom' ? '正在验证分支...' : '正在准备检测变更...'
    });

    // custom 模式：验证分支是否存在（内部已执行 git fetch）
    let effectiveBranches = selectedTargetBranches;
    if (mergeType === 'custom') {
      const { valid, invalid } = await validateCustomBranches(selectedTargetBranches);
      invalid.forEach(b => message.warning(`分支 "${b}" 不存在，已跳过`));
      if (valid.length === 0) {
        message.error('没有有效的目标分支，操作终止');
        setChangeDetecting(false);
        setChangeDetectProgress(prev => ({ ...prev, visible: false }));
        return;
      }
      effectiveBranches = valid;
    }

    const isSingleCommit = selectedCommits.length === 1;
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [handleDetectChanges] 开始检测变更`);
    console.log(`[${timestamp}] [handleDetectChanges] 选中的提交: ${selectedCommits.length}个`);
    console.log(`[${timestamp}] [handleDetectChanges] 目标分支: ${effectiveBranches.join(', ')}`);

    // 获取选中提交的 commit message (subject line) 用于精确比对
    const selectedCommitsData = selectedCommits.map(hash => findCommitByHash(hash)).filter(Boolean);
    const commitSubjects = selectedCommitsData.map(c => c.message || '').filter(Boolean);

    if (commitSubjects.length === 0) {
      message.error('无法获取选中提交的commit信息');
      setChangeDetecting(false);
      setChangeDetectProgress(prev => ({ ...prev, visible: false }));
      return;
    }

    setChangeDetectProgress({
      visible: true,
      current: 0,
      total: effectiveBranches.length,
      status: '正在准备检测变更...'
    });

    // 先获取远程最新分支信息（custom 模式已在 validateCustomBranches 中 fetch，非 custom 模式需单独 fetch）
    if (mergeType !== 'custom') {
      setChangeDetectProgress(prev => ({ ...prev, status: '正在获取远程分支最新信息...' }));
      await window.electronAPI.git.fetch();
    }

    // 无需 stash/checkout —— 只读操作，直接比较 commit message
    const results = [];

    try {
      for (let i = 0; i < effectiveBranches.length; i++) {
        const targetBranch = effectiveBranches[i];

        setChangeDetectProgress(prev => ({
          ...prev,
          status: `正在检测 ${i + 1}/${effectiveBranches.length}: ${targetBranch}`
        }));

        try {
          const checkResult = await window.electronAPI.git.checkCommitsInBranch(targetBranch, commitSubjects);
          results.push({ targetBranch, commits: checkResult });
        } catch (error) {
          results.push({
            targetBranch,
            commits: Object.fromEntries(commitSubjects.map(s => [s, false])),
            error: error.message
          });
        }

        setChangeDetectProgress(prev => ({
          ...prev,
          current: i + 1
        }));
      }

      setChangeDetectProgress(prev => ({ ...prev, status: '检测完成' }));

      // 汇总结果
      const allExist = results.every(r => Object.values(r.commits).every(v => v === true));
      const missingBySubject = {};
      results.forEach(r => {
        Object.entries(r.commits).forEach(([subject, exists]) => {
          if (!exists) {
            if (!missingBySubject[subject]) missingBySubject[subject] = [];
            missingBySubject[subject].push(r.targetBranch);
          }
        });
      });

      await new Promise(resolve => setTimeout(resolve, 300));
      setChangeDetectProgress(prev => ({ ...prev, visible: false }));

      setChangeDetectResultModal({
        visible: true,
        results,
        isSingleCommit,
        allExist,
        missingBySubject,
        commitSubjects
      });

      if (allExist) {
        message.success('所选提交在目标分支中均存在');
      } else {
        message.warning('部分变更在目标分支中不存在');
      }
    } catch (error) {
      message.error('检测变更失败: ' + error.message);
    } finally {
      setChangeDetecting(false);
      setChangeDetectProgress(prev => ({ ...prev, visible: false }));
    }
  };

  const handleDetectVersion = async () => {
    if (selectedCommits.length === 0) {
      message.warning('请选择要检测的提交记录');
      return;
    }
    if (selectedCommits.length > 1) {
      message.warning('检测版本仅支持选择一条提交记录，请重新选择。');
      return;
    }
    if (selectedTargetBranches.length === 0) {
      message.warning('请选择目标分支');
      return;
    }

    const selectedCommitData = findCommitByHash(selectedCommits[0]);
    if (!selectedCommitData || !selectedCommitData.message) {
      message.error('无法获取选中提交的信息');
      return;
    }

    const commitMessage = selectedCommitData.message;
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [handleDetectVersion] 开始检测版本: ${commitMessage}`);

    // 过滤掉 develop 分支（develop 不需要检测版本）
    const targetBranches = selectedTargetBranches.filter(b => b !== 'develop');
    if (targetBranches.length === 0) {
      message.info('目标分支中无需要检测版本的分支（已跳过 develop）');
      return;
    }

    setVersionDetecting(true);
    setVersionDetectProgress({
      visible: true,
      current: 0,
      total: targetBranches.length,
      status: '正在准备检测版本...'
    });

    const allResults = [];

    try {
      for (let i = 0; i < targetBranches.length; i++) {
        const targetBranch = targetBranches[i];

        setVersionDetectProgress(prev => ({
          ...prev,
          current: i + 1,
          status: `正在检测 ${i + 1}/${targetBranches.length}: ${targetBranch}`
        }));

        try {
          const branchResults = await window.electronAPI.git.detectVersion(targetBranch, commitMessage);
          allResults.push({
            targetBranch,
            tags: branchResults
          });
        } catch (error) {
          allResults.push({
            targetBranch,
            tags: [],
            error: error.message
          });
        }
      }

      setVersionDetectProgress(prev => ({ ...prev, status: '检测完成' }));

      await new Promise(resolve => setTimeout(resolve, 300));
      setVersionDetectProgress(prev => ({ ...prev, visible: false }));

      setVersionDetectResultModal({
        visible: true,
        results: allResults
      });

      const totalMatched = allResults.filter(r => r.tags?.matchedTag).length;
      if (totalMatched > 0) {
        message.success(`检测完成，${totalMatched} 个分支找到匹配版本 tag`);
      } else {
        message.info('未找到匹配的版本 tag');
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [handleDetectVersion] 检测失败:`, error);
      message.error('检测版本失败: ' + error.message);
      setVersionDetectProgress(prev => ({ ...prev, visible: false }));
    } finally {
      setVersionDetecting(false);
    }
  };

  const handleOpenInBrowser = async () => {
    try {
      const remoteUrl = await window.electronAPI.git.getRemoteUrl();
      if (remoteUrl) {
        let url = remoteUrl;
        if (url.startsWith('git@')) {
          url = url.replace('git@', 'https://').replace(':', '/');
        }
        // Remove username from HTTPS URLs (e.g., https://username@host/path -> https://host/path)
        url = url.replace(/^(https?:\/\/)([^@]+)@/, '$1');
        if (url.endsWith('.git')) {
          url = url.slice(0, -4);
        }
        await window.electronAPI.system.openExternal(url);
      } else {
        message.warning('未找到远程仓库地址');
      }
    } catch (error) {
      message.error('打开浏览器失败: ' + error.message);
    }
  };

  const getTargetBranches = () => {
    switch (mergeType) {
      case 'test':
        return settings.testBranches?.split('\n').filter(Boolean) || [];
      case 'release':
        return settings.releaseBranches?.split('\n').filter(Boolean) || [];
      case 'bug':
        return settings.bugTestBranches?.split('\n').filter(Boolean) || [];
      case 'custom':
        return customBranchInputs.map(b => b.trim()).filter(Boolean);
      default:
        return [];
    }
  };

  // 验证自定义分支是否存在，返回 { valid: string[], invalid: string[] }
  const validateCustomBranches = async (branchNames) => {
    await window.electronAPI.git.fetch();
    const allBranches = await window.electronAPI.git.getBranches();

    const valid = [];
    const invalid = [];

    for (const branch of branchNames) {
      if (allBranches.includes(branch)) {
        valid.push(branch);
      } else {
        try {
          await window.electronAPI.git.fetchBranch(branch);
          valid.push(branch);
        } catch {
          invalid.push(branch);
        }
      }
    }

    return { valid, invalid };
  };

  // 根据合并类型获取操作按钮
  const getActionButtons = () => {
    const buttons = [];
    
    if (mergeType === 'bug' || mergeType === 'test') {
      buttons.push(
        <Button 
          key="cherry-pick-push"
          type="primary" 
          icon={<CodeOutlined />}
          onClick={handleCherryPickAndPush}
          loading={loading}
        >
          遴选推送
        </Button>
      );
    } else if (mergeType === 'release') {
      buttons.push(
        <Button
          key="create-branch"
          type="primary"
          icon={<BranchesOutlined />}
          onClick={handleCreateMergeBranch}
          loading={loading}
        >
          创建合并分支
        </Button>
      );
    } else if (mergeType === 'custom') {
      buttons.push(
        <Button
          key="cherry-pick-push"
          type="primary"
          icon={<CodeOutlined />}
          onClick={handleCherryPickAndPush}
          loading={loading}
        >
          遴选推送
        </Button>
      );
      buttons.push(
        <Button
          key="create-branch"
          type="primary"
          icon={<BranchesOutlined />}
          onClick={handleCreateMergeBranch}
          loading={loading}
          style={{ marginLeft: 8 }}
        >
          创建合并分支
        </Button>
      );
    }
    
    return buttons;
  };

  const isDetectConflictDisabled = selectedCommits.length === 0 || selectedTargetBranches.length === 0 || conflictDetecting;

  // 从提交记录中提取问题单号
  const extractIssueNumber = (commits) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [extractIssueNumber] 开始提取问题单号`);
    console.log(`[${timestamp}] [extractIssueNumber] 提交数量: ${commits?.length || 0}`);
    
    if (!commits || commits.length === 0) {
      console.log(`[${timestamp}] [extractIssueNumber] 没有提交记录，返回null`);
      return null;
    }

    // 匹配格式：#XXX-数字，例如 #MKR-1970, #ISSUE-123
    const issuePattern = /#([A-Z]+-\d+)/i;
    
    for (let i = 0; i < commits.length; i++) {
      const commit = commits[i];
      const message = commit.message || '';
      
      console.log(`[${timestamp}] [extractIssueNumber] 检查提交 ${i + 1}: ${message.substring(0, 50)}...`);
      
      const match = message.match(issuePattern);
      if (match) {
        const issueNumber = match[1];
        console.log(`[${timestamp}] [extractIssueNumber] 找到问题单号: ${issueNumber}`);
        return issueNumber;
      }
    }
    
    console.log(`[${timestamp}] [extractIssueNumber] 未找到问题单号，返回null`);
    return null;
  };

  // 生成新的分支名称
  const generateBranchName = (targetBranch, issueNumber, username) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [generateBranchName] 生成分支名称`);
    console.log(`[${timestamp}] [generateBranchName] 目标分支: ${targetBranch}`);
    console.log(`[${timestamp}] [generateBranchName] 问题单号: ${issueNumber}`);
    console.log(`[${timestamp}] [generateBranchName] 用户名: ${username}`);
    
    // 新格式：merge/{用户名}/目标分支/{问题单号}
    const branchName = issueNumber 
      ? `merge/${username}/${targetBranch}/${issueNumber}`
      : `merge/${username}/${targetBranch}`;
    
    console.log(`[${timestamp}] [generateBranchName] 生成的分支名称: ${branchName}`);
    return branchName;
  };

  // 使用 useMemo 缓存过滤后的提交记录，依赖 debouncedSearchText（防抖后的搜索词）
  const filteredCommits = useMemo(() => {
    const startTime = performance.now();
    const source = debouncedSearchText ? allCommits : commits;
    const filtered = source.filter(commit => {
      const matchesSearch = !debouncedSearchText ||
        commit.message?.toLowerCase().includes(debouncedSearchText.toLowerCase()) ||
        commit.author_name?.toLowerCase().includes(debouncedSearchText.toLowerCase()) ||
        commit.hash === debouncedSearchText;

      const matchesMyCommits = !showMyCommits ||
        commit.author_name === currentUser.name ||
        commit.author_name === currentUser.email ||
        (currentUser.name && commit.author_name?.includes(currentUser.name));

      return matchesSearch && matchesMyCommits;
    });

    const duration = performance.now() - startTime;
    if (duration > 50) {
      console.warn(`[PERFORMANCE] filteredCommits 计算耗时 ${duration.toFixed(2)}ms (过滤了 ${filtered.length} 条记录)`);
    }

    return filtered;
  }, [commits, allCommits, debouncedSearchText, showMyCommits, currentUser]);

  // 优化：创建选中状态的 Set 用于快速查找
  const selectedCommitsSet = useMemo(() => {
    return new Set(selectedCommits);
  }, [selectedCommits]);

  if (!initialized) {
    return (
      <div className="loading-container">
        <Spin size="large" tip="正在加载..." />
      </div>
    );
  }

  return (
    <Layout className="main-workspace">
      <Header className="workspace-header">
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={onClose}>
            返回
          </Button>
          <span className="project-name">{project?.info?.name}</span>
          <Tag
            color="blue"
            style={{ cursor: 'pointer' }}
            onClick={() => {
              setSelectedViewBranch(viewBranch);
              setBranchSearchText('');
              setBranchSwitcherVisible(true);
            }}
          >
            <BranchesOutlined /> {viewBranch}
          </Tag>
          {viewBranch !== currentBranch && (
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => {
                setViewBranch(currentBranch);
                setSelectedCommits([]);
                setSearchText('');
                setShowMyCommits(false);
              }}
            >
              回到当前分支
            </Button>
          )}
          <Button
            size="small"
            icon={<BranchesOutlined />}
            onClick={() => {
              setSelectedViewBranch(viewBranch);
              setBranchSearchText('');
              setBranchSwitcherVisible(true);
            }}
          >
            切换
          </Button>
        </Space>
        <Space>
          <Button icon={<GlobalOutlined />} onClick={handleOpenInBrowser}>
            浏览器打开
          </Button>
        </Space>
      </Header>

      <Content className="workspace-content">
        <div className="commits-section">
          <div className="commits-toolbar">
            <Search
              placeholder="搜索提交..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ width: 300 }}
              prefix={<SearchOutlined />}
            />
            <Space>
              <Button 
                icon={<UserOutlined />}
                type={showMyCommits ? 'primary' : 'default'}
                onClick={() => setShowMyCommits(!showMyCommits)}
              >
                我的提交
              </Button>
              <Button
                icon={<ClearOutlined />}
                onClick={() => {
                  setSearchText('');
                  setShowMyCommits(false);
                }}
              >
                清空
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={handleRefresh}
              >
                刷新
              </Button>
            </Space>
          </div>

          <div 
            ref={commitsListRef}
            className="commits-list"
            style={{ 
              height: 'calc(100vh - 320px)', 
              overflowY: 'auto',
              overflowX: 'hidden'
            }}
            onScroll={(e) => {
              const { scrollTop, scrollHeight, clientHeight } = e.target;
              
              // 优化：滚动到距离底部200px时加载更多
              if (scrollTop + clientHeight >= scrollHeight - 200 && !loadingMore && hasMoreCommits) {
                loadMoreCommits();
              }
            }}
          >
            {loading && commits.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <Spin tip="正在加载提交记录..." />
              </div>
            )}
            
            {filteredCommits.length === 0 && !loading && (
              <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                暂无提交记录
              </div>
            )}
            
            {filteredCommits.length > 0 && (
              filteredCommits.map((commit) => (
                <CommitItem
                  key={commit.hash}
                  commit={commit}
                  isSelected={selectedCommitsSet.has(commit.hash)}
                  onToggle={toggleCommitSelection}
                />
              ))
            )}
            
            {loadingMore && (
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <Spin size="small" tip="加载更多..." />
              </div>
            )}
            
            {!hasMoreCommits && filteredCommits.length > 0 && (
              <div style={{ textAlign: 'center', padding: '20px', color: '#999', fontSize: '12px' }}>
                已加载全部提交记录
              </div>
            )}
          </div>
        </div>

        <div className="operations-panel">
          <Card title="合并操作" size="small">
            <div className="merge-type-section">
              <label className="section-label">合并类型:</label>
              <Radio.Group 
                value={mergeType} 
                onChange={(e) => {
                  setMergeType(e.target.value);
                  setSelectedTargetBranches([]);
                  if (e.target.value === 'custom') {
                    setCustomBranchInputs(['']);
                  }
                }}
                className="merge-type-radio-group"
              >
                {MERGE_TYPES.map(type => (
                  <Radio.Button key={type.value} value={type.value}>
                    {type.label}
                  </Radio.Button>
                ))}
              </Radio.Group>
            </div>

            <div className="target-branches-section">
              <label className="section-label">目标分支:</label>
              {mergeType === 'custom' ? (
                <div className="custom-branches-input-list">
                  {customBranchInputs.map((value, index) => (
                    <div key={index} className="custom-branch-input-row">
                      <AutoComplete
                        className="custom-branch-autocomplete"
                        placeholder="输入分支名搜索..."
                        value={value}
                        options={branches
                          .filter(b => b.toLowerCase().includes((value || '').toLowerCase()))
                          .slice(0, 20)
                          .map(b => ({ value: b, label: b }))
                        }
                        onChange={(val) => {
                          const newInputs = [...customBranchInputs];
                          newInputs[index] = val;
                          setCustomBranchInputs(newInputs);
                        }}
                        onSelect={(val) => {
                          const newInputs = [...customBranchInputs];
                          newInputs[index] = val;
                          setCustomBranchInputs(newInputs);
                        }}
                        allowClear
                      />
                      {customBranchInputs.length > 1 && (
                        <Button
                          type="text"
                          danger
                          icon={<CloseOutlined />}
                          onClick={() => setCustomBranchInputs(prev => prev.filter((_, i) => i !== index))}
                        />
                      )}
                      {index === customBranchInputs.length - 1 && (
                        <Button
                          type="dashed"
                          icon={<PlusOutlined />}
                          onClick={() => setCustomBranchInputs(prev => [...prev, ''])}
                        >
                          添加分支
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <Checkbox.Group
                  className="branches-checkbox-group"
                  options={getTargetBranches().map(b => ({ label: b, value: b }))}
                  value={selectedTargetBranches}
                  onChange={setSelectedTargetBranches}
                />
              )}
            </div>

            <div className="action-buttons">
              {getActionButtons()}
              <Button
                type="default"
                icon={<WarningOutlined />}
                onClick={handleDetectConflicts}
                loading={conflictDetecting}
                disabled={isDetectConflictDisabled}
                style={{ marginLeft: 8 }}
              >
                检测冲突
              </Button>
              <Button
                type="default"
                icon={<SearchOutlined />}
                onClick={handleDetectChanges}
                loading={changeDetecting}
                disabled={selectedCommits.length === 0 || selectedTargetBranches.length === 0 || changeDetecting}
                style={{ marginLeft: 8 }}
              >
                检测变更
              </Button>
              {mergeType !== 'custom' && (
                <Button
                  type="default"
                  icon={<TagOutlined />}
                  onClick={handleDetectVersion}
                  loading={versionDetecting}
                  disabled={selectedCommits.length !== 1 || selectedTargetBranches.length === 0 || versionDetecting}
                  style={{ marginLeft: 8 }}
                >
                  检测版本
                </Button>
              )}
            </div>
          </Card>
        </div>
      </Content>

      {/* 设置抽屉 */}
      <Drawer
        title="应用设置"
        placement="right"
        width={600}
        open={settingsVisible}
        onClose={() => setSettingsVisible(false)}
      >
        <SettingsForm
          settings={settings}
          onSave={async (newSettings) => {
            await window.electronAPI.settings.save(newSettings);
            setSettings(newSettings);
            message.success('设置已保存');
            setSettingsVisible(false);
          }}
        />
        <div style={{ marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
          <Button
            icon={<DownloadOutlined />}
            onClick={async () => {
              const result = await window.electronAPI.system.exportLogZip();
              if (result.success) {
                message.success('日志导出成功: ' + result.path);
              } else if (!result.canceled) {
                message.error('日志导出失败: ' + result.error);
              }
            }}
            block
          >
            导出日志
          </Button>
        </div>
      </Drawer>

      {/* 合并分支进度条Modal */}
      <Modal
        title="创建合并分支"
        open={mergeProgress.visible}
        closable={false}
        footer={null}
        maskClosable={false}
        width={600}
        zIndex={1000}
        className="merge-progress-modal"
      >
        <div style={{ padding: '20px 0' }}>
          <Progress
            percent={Math.round((mergeProgress.current / mergeProgress.total) * 100)}
            status="active"
            format={(percent) => `${percent}%`}
          />
          <div style={{ marginTop: 16, textAlign: 'center', color: '#666' }}>
            {mergeProgress.status}
          </div>
          {mergeProgress.results.length > 0 && (
            <div style={{ marginTop: 16, maxHeight: '200px', overflowY: 'auto' }}>
              <Alert
                message="已完成操作"
                description={
                  <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                    {mergeProgress.results.map((result, index) => (
                      <li key={index} style={{ marginBottom: '4px' }}>
                        {result.success ? '✓' : '✗'} {result.mergeBranch}
                        {result.success && result.mrUrl && (
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              window.electronAPI.system.openExternal(result.mrUrl);
                            }}
                            style={{ marginLeft: 8 }}
                          >
                            查看MR
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                }
                type={mergeProgress.current === mergeProgress.total ? 'success' : 'info'}
                showIcon
              />
            </div>
          )}
        </div>
      </Modal>

      {/* 合并分支成功提示Modal */}
      <Modal
        title="合并请求创建结果"
        open={mergeResultModal.visible}
        onCancel={() => setMergeResultModal({ visible: false, success: false, results: [] })}
        footer={[
          <Button
            key="copy"
            icon={<CopyOutlined />}
            onClick={() => {
              const formatResults = () => {
                const successResults = mergeResultModal.results.filter(r => r.success);
                if (successResults.length === 0) {
                  return '无成功的合并请求';
                }
                
                const firstCommitHash = selectedCommits[0];
                const firstCommit = findCommitByHash(firstCommitHash);
                const author = firstCommit?.author_name || '-';
                const date = firstCommit?.date || '-';
                const commitMessage = firstCommit?.message || '-';
                
                let text = '=== Git多分支合并信息 ===\n';
                text += `作者: ${author}   时间: ${date}\n`;
                text += `提交记录: ${commitMessage}\n`;
                successResults.forEach((result, index) => {
                  text += `${index + 1}. 分支: ${result.targetBranch}\n`;
                  if (result.mrUrl) {
                    text += `   合并请求地址: ${result.mrUrl}\n`;
                  }
                });
                return text;
              };

              const textToCopy = formatResults();
              navigator.clipboard.writeText(textToCopy).then(() => {
                message.success('已复制到剪贴板');
              }).catch((err) => {
                console.error('复制失败:', err);
                message.error('复制失败');
              });
            }}
          >
            复制信息
          </Button>,
          <Button
            key="close"
            type="primary"
            onClick={() => setMergeResultModal({ visible: false, success: false, results: [] })}
          >
            关闭
          </Button>
        ]}
        width={700}
        className="merge-result-modal"
      >
        <div style={{ padding: '10px 0' }}>
          <Alert
            message={mergeResultModal.success ? '全部创建成功' : '部分创建失败'}
            description={
              <div>
                <p style={{ marginBottom: '12px' }}>
                  共处理 {mergeResultModal.results.length} 个目标分支
                </p>
                {mergeResultModal.results.map((result, index) => (
                  <Card
                    key={index}
                    size="small"
                    className={`merge-result-card ${result.success ? 'success' : 'error'}`}
                    style={{ marginBottom: '12px' }}
                  >
                    <div style={{ marginBottom: '8px' }}>
                      <strong>目标分支:</strong> {result.targetBranch}
                    </div>
                    <div style={{ marginBottom: '8px' }}>
                      <strong>源分支:</strong> {result.sourceBranch}
                    </div>
                    <div style={{ marginBottom: '8px' }}>
                      <strong>创建分支:</strong> {result.mergeBranch}
                    </div>
                    {result.success && result.mrUrl && (
                      <div style={{ marginBottom: '8px' }}>
                        <strong>合并请求:</strong>{' '}
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            window.electronAPI.system.openExternal(result.mrUrl);
                          }}
                          className="merge-result-link"
                        >
                          {result.mrUrl}
                        </a>
                      </div>
                    )}
                    {result.error && (
                      <div style={{ color: '#ff4d4f' }}>
                        <strong>错误:</strong> {result.error}
                      </div>
                    )}
                    <div style={{ marginTop: '8px' }}>
                      <Tag color={result.success ? 'green' : 'red'}>
                        {result.success ? '成功' : '失败'}
                      </Tag>
                    </div>
                  </Card>
                ))}
              </div>
            }
            type={mergeResultModal.success ? 'success' : 'warning'}
            showIcon
          />
        </div>
      </Modal>

      {/* Claude 智能冲突对话 Modal：流式展示思考与返回值，用户确认后应用 */}
      <Modal
        title="智能冲突解决"
        open={claudeStreamModal.visible}
        closable={!claudeStreamModal.loading}
        maskClosable={false}
        zIndex={2100}
        width={720}
        footer={
          claudeStreamModal.loading
            ? null
            : claudeStreamModal.error
              ? [<Button key="close" onClick={() => claudeConfirmResolveRef.current?.('cancel')}>关闭</Button>]
              : [
                  <Button key="cancel" onClick={() => claudeConfirmResolveRef.current?.('cancel')}>放弃</Button>,
                  <Button key="apply" type="primary" onClick={() => claudeConfirmResolveRef.current?.('apply')}>应用并继续</Button>
                ]
        }
      >
        <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
          {claudeStreamModal.thinking && (
            <details open style={{ marginBottom: 12, background: '#fafafa', padding: '8px 12px', borderRadius: 6 }}>
              <summary style={{ cursor: 'pointer', color: '#888', fontWeight: 500 }}>模型思考</summary>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '8px 0 0', fontSize: 12, color: '#666' }}>{claudeStreamModal.thinking}</pre>
            </details>
          )}
          <div style={{ background: '#f5f5f5', padding: '8px 12px', borderRadius: 6 }}>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>返回内容</div>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontSize: 13 }}>{claudeStreamModal.text}{claudeStreamModal.loading ? '▍' : ''}</pre>
          </div>
          {claudeStreamModal.loading && (
            <div style={{ textAlign: 'center', marginTop: 16, color: '#888' }}>
              <Spin size="small" /> <span style={{ marginLeft: 8 }}>模型思考中...</span>
            </div>
          )}
          {claudeStreamModal.error && (
            <Alert type="error" message="处理失败" description={claudeStreamModal.error} style={{ marginTop: 12 }} />
          )}
        </div>
      </Modal>

      {/* 冲突解决Modal */}
      <Modal
        title="使用外部应用解决冲突"
        open={conflictModal.visible}
        closable={false}
        maskClosable={false}
        zIndex={2000}
        footer={[
          <Button key="cancel" onClick={handleConflictCancel}>
            取消
          </Button>,
          <Button key="confirm" type="primary" disabled={!allFilesResolved} onClick={handleConflictConfirm}>
            确认
          </Button>
        ]}
        width={600}
      >
        <div style={{ padding: '10px 0' }}>
          <Alert
            message={`Cherry-pick 到 ${conflictModal.branch} 时发生冲突`}
            description={'请在外部编辑器中手动解决冲突，解决后点击\u201C已处理\u201D标记该文件。所有文件标记为已处理后，点击\u201C确认\u201D继续。'}
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, color: '#333' }}>
            冲突文件（共 {conflictModal.files.length} 个）：
          </div>
          {conflictModal.files.map((file, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 12px',
                marginBottom: 6,
                border: '1px solid #f0f0f0',
                borderRadius: 6,
                background: file.resolved ? '#f6ffed' : '#fff'
              }}
            >
              <span style={{ flex: 1, fontSize: 13, fontFamily: 'Monaco, Consolas, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file.path}
              </span>
              <Space>
                <Button size="small" onClick={() => handleOpenFile(file.path)}>
                  解决
                </Button>
                <Button
                  size="small"
                  type={file.resolved ? 'default' : 'primary'}
                  disabled={file.resolved}
                  onClick={() => handleMarkResolved(file.path)}
                >
                  {file.resolved ? '已完成' : '已处理'}
                </Button>
              </Space>
            </div>
          ))}
            {/* 智能冲突处理按钮区域 */}
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #f0f0f0', textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                或使用 AI 自动解决冲突
              </div>
              <Button
                type="default"
                icon={<CodeOutlined />}
                loading={conflictClaudeLoading}
                onClick={() => conflictResolveRef.current?.('claude-resolve')}
              >
                智能冲突处理
              </Button>
              {conflictClaudeLoading && (
                <div style={{ marginTop: 12 }}>
                  <Spin tip="AI 正在分析并解决冲突..." />
                </div>
              )}
            </div>
          </div>
        </Modal>

        {/* 遴选推送进度条Modal */}
      <Modal
        title="遴选推送"
        open={cherryPickProgress.visible}
        closable={false}
        footer={null}
        maskClosable={false}
        width={600}
        zIndex={1000}
        className="merge-progress-modal"
      >
        <div style={{ padding: '20px 0' }}>
          <Progress
            percent={Math.round((cherryPickProgress.current / cherryPickProgress.total) * 100)}
            status="active"
            format={(percent) => `${percent}%`}
          />
          <div style={{ marginTop: 16, textAlign: 'center', color: '#666' }}>
            {cherryPickProgress.status}
          </div>
          {cherryPickProgress.results.length > 0 && (
            <div style={{ marginTop: 16, maxHeight: '200px', overflowY: 'auto' }}>
              <Alert
                message="已完成操作"
                description={
                  <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                    {cherryPickProgress.results.map((result, index) => (
                      <li key={index} style={{ marginBottom: '4px' }}>
                        {result.success ? '✓' : '✗'} {result.targetBranch}
                        {result.success && (
                          <span style={{ color: '#52c41a', marginLeft: 8 }}>
                            推送成功
                          </span>
                        )}
                        {result.error && (
                          <span style={{ color: '#ff4d4f', marginLeft: 8 }}>
                            {result.error}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                }
                type={cherryPickProgress.current === cherryPickProgress.total ? 'success' : 'info'}
                showIcon
              />
            </div>
          )}
        </div>
      </Modal>

      {/* 遴选推送成功提示Modal */}
      <Modal
        title="遴选推送结果"
        open={cherryPickResultModal.visible}
        onCancel={() => setCherryPickResultModal({ visible: false, success: false, results: [] })}
        footer={[
          <Button
            key="copy"
            icon={<CopyOutlined />}
            onClick={() => {
              const formatResults = () => {
                // 只复制成功的结果
                const successResults = cherryPickResultModal.results.filter(r => r.success);
                if (successResults.length === 0) {
                  return '无成功的推送';
                }
                
                let text = '=== Git遴选推送信息 ===\n';
                successResults.forEach((result, index) => {
                  text += `${index + 1}. 目标分支: ${result.targetBranch}\n`;
                  text += '   状态: 推送成功\n';
                });
                return text;
              };

              const textToCopy = formatResults();
              navigator.clipboard.writeText(textToCopy).then(() => {
                message.success('已复制到剪贴板');
              }).catch((err) => {
                console.error('复制失败:', err);
                message.error('复制失败');
              });
            }}
          >
            复制信息
          </Button>,
          <Button
            key="close"
            type="primary"
            onClick={() => setCherryPickResultModal({ visible: false, success: false, results: [] })}
          >
            关闭
          </Button>
        ]}
        width={600}
        className="merge-result-modal"
      >
        <div style={{ padding: '10px 0' }}>
          <Alert
            message={cherryPickResultModal.success ? '全部推送成功' : '部分推送失败'}
            description={
              <div>
                <p style={{ marginBottom: '12px' }}>
                  共处理 {cherryPickResultModal.results.length} 个目标分支
                </p>
                {cherryPickResultModal.results.map((result, index) => (
                  <Card
                    key={index}
                    size="small"
                    className={`merge-result-card ${result.success ? 'success' : 'error'}`}
                    style={{ marginBottom: '12px' }}
                  >
                    <div style={{ marginBottom: '8px' }}>
                      <strong>目标分支:</strong> {result.targetBranch}
                    </div>
                    {result.success && (
                      <div style={{ color: '#52c41a', marginBottom: '8px' }}>
                        ✓ 推送成功
                      </div>
                    )}
                    {result.error && (
                      <div style={{ color: '#ff4d4f' }}>
                        <strong>错误:</strong> {result.error}
                      </div>
                    )}
                    <div style={{ marginTop: '8px' }}>
                      <Tag color={result.success ? 'green' : 'red'}>
                        {result.success ? '成功' : '失败'}
                      </Tag>
                    </div>
                  </Card>
                ))}
              </div>
            }
            type={cherryPickResultModal.success ? 'success' : 'warning'}
            showIcon
          />
        </div>
      </Modal>

      {/* 冲突检测进度Modal */}
      <Modal
        title="检测冲突"
        open={conflictProgress.visible}
        onCancel={() => {}}
        footer={null}
        closable={false}
        maskClosable={false}
        width={500}
      >
        <div style={{ padding: '10px 0' }}>
          <Progress
            percent={conflictProgress.total > 0 ? Math.round((conflictProgress.current / conflictProgress.total) * 100) : 0}
            status="active"
          />
          <div style={{ marginTop: 8, color: '#666' }}>
            {conflictProgress.status}
          </div>
        </div>
      </Modal>

      {/* 冲突检测结果Modal */}
      <Modal
        title="冲突检测结果"
        open={conflictResultModal.visible}
        onCancel={() => setConflictResultModal({ visible: false, results: [] })}
        footer={[
          <Button
            key="close"
            type="primary"
            onClick={() => setConflictResultModal({ visible: false, results: [] })}
          >
            关闭
          </Button>
        ]}
        width={500}
      >
        <div style={{ padding: '10px 0' }}>
          <Alert
            message={
              conflictResultModal.results.every(r => !r.hasConflict)
                ? '所有分支均无冲突'
                : '部分分支存在冲突'
            }
            type={
              conflictResultModal.results.every(r => !r.hasConflict)
                ? 'success'
                : 'warning'
            }
            showIcon
            style={{ marginBottom: 16 }}
          />
          {conflictResultModal.results.map((result, index) => (
            <Card
              key={index}
              size="small"
              style={{
                marginBottom: 8,
                borderLeft: `4px solid ${result.hasConflict ? '#ff4d4f' : '#52c41a'}`
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 500 }}>{result.targetBranch}</span>
                <Tag color={result.hasConflict ? 'error' : 'success'}>
                  {result.hasConflict ? '有冲突' : '无冲突'}
                </Tag>
              </div>
            </Card>
          ))}
        </div>
      </Modal>

      {/* 变更检测进度Modal */}
      <Modal
        title="检测变更进度"
        open={changeDetectProgress.visible}
        footer={null}
        closable={false}
        width={500}
      >
        <div style={{ padding: '20px 0' }}>
          <Progress
            percent={changeDetectProgress.total > 0 ? Math.round((changeDetectProgress.current / changeDetectProgress.total) * 100) : 0}
            status={changeDetectProgress.current < changeDetectProgress.total ? 'active' : 'success'}
          />
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            {changeDetectProgress.status}
          </div>
        </div>
      </Modal>

      {/* 变更检测结果Modal */}
      <Modal
        title="变更检测结果"
        open={changeDetectResultModal.visible}
        onCancel={() => setChangeDetectResultModal({ visible: false, results: [], isSingleCommit: false, allExist: true, missingBySubject: {}, commitSubjects: [] })}
        footer={[
          <Button
            key="close"
            type="primary"
            onClick={() => setChangeDetectResultModal({ visible: false, results: [], isSingleCommit: false, allExist: true, missingBySubject: {}, commitSubjects: [] })}
          >
            关闭
          </Button>
        ]}
        width={550}
      >
        <div style={{ padding: '10px 0' }}>
          {changeDetectResultModal.allExist ? (
            // 全部存在 — 简单提示即可
            <Alert
              message="全部存在"
              description={
                changeDetectResultModal.isSingleCommit
                  ? '所选提交在目标分支中均存在'
                  : `所选 ${changeDetectResultModal.commitSubjects?.length || 0} 个提交在目标分支中均存在`
              }
              type="success"
              showIcon
            />
          ) : changeDetectResultModal.isSingleCommit ? (
            // 单条提交且不存在 — 按分支展示结果文本
            <div>
              <Alert
                message="部分分支不存在"
                type="error"
                showIcon
                style={{ marginBottom: 16 }}
              />
              {changeDetectResultModal.results.map((r, i) => (
                <div key={i} style={{ marginBottom: 6, fontSize: 14 }}>
                  <span style={{ fontWeight: 500 }}>{r.targetBranch}:</span>{' '}
                  <span style={{ color: Object.values(r.commits || {})[0] ? '#52c41a' : '#ff4d4f', fontWeight: 500 }}>
                    {Object.values(r.commits || {})[0] ? '存在' : '不存在'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            // 多条提交且部分不存在 — 详细展示
            <>
              <Alert
                message="部分变更不存在"
                description={
                  (() => {
                    const missing = Object.entries(changeDetectResultModal.missingBySubject || {});
                    return (
                      <div>
                        <p style={{ marginBottom: 8 }}>以下提交在部分目标分支中不存在：</p>
                        {missing.map(([subject, branches], i) => (
                          <div key={i} style={{ marginBottom: 6, padding: '6px 8px', background: '#fff2f0', borderRadius: 4 }}>
                            <div style={{ color: '#cf1322', fontWeight: 500, marginBottom: 4 }}>
                              ✗ {subject}
                            </div>
                            <div style={{ fontSize: 12, color: '#666' }}>
                              缺失分支: {branches.join(', ')}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()
                }
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
              />
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, color: '#333' }}>各分支检测详情</div>
                {changeDetectResultModal.results.map((result, index) => (
                  <Card
                    key={index}
                    size="small"
                    style={{ marginBottom: 8 }}
                  >
                    <div style={{ fontWeight: 500, marginBottom: 8 }}>{result.targetBranch}</div>
                    {Object.entries(result.commits || {}).map(([subject, exists], ci) => (
                      <div key={ci} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subject}</span>
                        <Tag color={exists ? 'success' : 'error'} style={{ flexShrink: 0, marginLeft: 8 }}>
                          {exists ? '已存在' : '不存在'}
                        </Tag>
                      </div>
                    ))}
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* 版本检测进度Modal */}
      <Modal
        title="检测版本"
        open={versionDetectProgress.visible}
        footer={null}
        closable={false}
        maskClosable={false}
        width={500}
      >
        <div style={{ padding: '20px 0' }}>
          <Progress
            percent={versionDetectProgress.total > 0 ? Math.round((versionDetectProgress.current / versionDetectProgress.total) * 100) : 0}
            status={versionDetectProgress.current < versionDetectProgress.total ? 'active' : 'success'}
          />
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            {versionDetectProgress.status}
          </div>
        </div>
      </Modal>

      {/* 版本检测结果Modal */}
      <Modal
        title="版本检测结果"
        open={versionDetectResultModal.visible}
        onCancel={() => setVersionDetectResultModal({ visible: false, results: [] })}
        footer={[
          <Button
            key="close"
            type="primary"
            onClick={() => setVersionDetectResultModal({ visible: false, results: [] })}
          >
            关闭
          </Button>
        ]}
        width={800}
      >
        <div style={{ padding: '10px 0' }}>
          {versionDetectResultModal.results.length === 0 ? (
            <Alert message="无检测结果" type="info" showIcon />
          ) : (
            versionDetectResultModal.results.map((branchResult, index) => {
              const data = branchResult.tags || {};
              const formatDate = (text) => {
                if (!text) return '-';
                try {
                  const d = new Date(text);
                  if (isNaN(d.getTime())) return text;
                  const y = d.getFullYear();
                  const m = String(d.getMonth() + 1).padStart(2, '0');
                  const day = String(d.getDate()).padStart(2, '0');
                  return `${y}/${m}/${day}`;
                } catch {
                  return text;
                }
              };

              return (
                <Card
                  key={index}
                  size="small"
                  title={<span><BranchesOutlined style={{ marginRight: 8 }} />{branchResult.targetBranch}</span>}
                  style={{ marginBottom: 12 }}
                >
                  {branchResult.error ? (
                    <Alert message={`查询失败: ${branchResult.error}`} type="error" showIcon />
                  ) : (
                    <Table
                      dataSource={[{
                        key: 0,
                        matchedTag: data.matchedTag?.tag || '-',
                        matchedDate: data.matchedTag?.tagDate || '-',
                        latestTag: data.latestTag?.tag || '-',
                        latestDate: data.latestTag?.tagDate || '-'
                      }]}
                      columns={[
                        {
                          title: '匹配Tag',
                          dataIndex: 'matchedTag',
                          key: 'matchedTag',
                          render: (text) => text !== '-' ? <Tag color="blue">{text}</Tag> : <span style={{ color: '#999' }}>-</span>
                        },
                        {
                          title: '匹配时间',
                          dataIndex: 'matchedDate',
                          key: 'matchedDate',
                          width: 110,
                          render: (text) => formatDate(text)
                        },
                        {
                          title: '最新Tag',
                          dataIndex: 'latestTag',
                          key: 'latestTag',
                          render: (text) => text !== '-' ? <Tag color="green">{text}</Tag> : <span style={{ color: '#999' }}>-</span>
                        },
                        {
                          title: '最新时间',
                          dataIndex: 'latestDate',
                          key: 'latestDate',
                          width: 110,
                          render: (text) => formatDate(text)
                        }
                      ]}
                      pagination={false}
                      size="small"
                    />
                  )}
                </Card>
              );
            })
          )}
        </div>
      </Modal>

      {/* 分支切换Modal */}
      <Modal
        title="切换分支 (仅切换视图，不切换当前分支)"
        open={branchSwitcherVisible}
        onOk={() => {
          setViewBranch(selectedViewBranch);
          setSelectedCommits([]);
          setSearchText('');
          setShowMyCommits(false);
          setBranchSearchText('');
          setBranchSwitcherVisible(false);
        }}
        onCancel={() => {
          setBranchSearchText('');
          setBranchSwitcherVisible(false);
        }}
        okText="确认切换"
        cancelText="取消"
        width={500}
      >
        <Search
          placeholder="搜索分支..."
          value={branchSearchText}
          onChange={(e) => {
            setBranchSearchText(e.target.value);
            // 如果当前选中的分支被搜索过滤掉了，清除选中状态
          }}
          style={{ marginBottom: 12 }}
          prefix={<SearchOutlined />}
        />
        {(() => {
          const filteredBranches = branchSearchText
            ? branches.filter(b => b.toLowerCase().includes(branchSearchText.toLowerCase()))
            : branches;

          if (filteredBranches.length === 0) {
            return (
              <div style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
                {branchSearchText ? '未找到匹配的分支' : '暂无可用分支'}
              </div>
            );
          }

          return (
            <div style={{ maxHeight: 360, overflow: 'auto' }}>
              {filteredBranches.map(branch => (
                <div
                  key={branch}
                  onClick={() => setSelectedViewBranch(branch)}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    background: selectedViewBranch === branch ? '#e6f7ff' : 'transparent',
                    border: selectedViewBranch === branch ? '1px solid #1890ff' : '1px solid transparent',
                    borderRadius: 4,
                    marginBottom: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                  onMouseEnter={(e) => {
                    if (selectedViewBranch !== branch) {
                      e.currentTarget.style.background = '#f5f5f5';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedViewBranch !== branch) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <BranchesOutlined style={{ marginRight: 8 }} />
                    {branch}
                  </span>
                  <Space size="small" style={{ flexShrink: 0 }}>
                    {branch === currentBranch && (
                      <Tag color="green" style={{ margin: 0 }}>当前</Tag>
                    )}
                    {branch === originalBranch && branch !== currentBranch && (
                      <Tag color="blue" style={{ margin: 0 }}>初始</Tag>
                    )}
                  </Space>
                </div>
              ))}
            </div>
          );
        })()}
      </Modal>
    </Layout>
  );
};

// 设置表单组件
const SettingsForm = ({ settings, onSave }) => {
  const [form] = Form.useForm();
  // 监听当前选中的模型，确保其始终出现在下拉选项中（避免选中值不在列表时显示为空）
  const claudeModelValue = Form.useWatch('claudeModel', form);
  const [testResult, setTestResult] = useState(null);
  // Claude 设置相关状态
  const [claudeUseLocal, setClaudeUseLocal] = useState(settings.claudeUseLocalConfig ?? true);
  const [claudeLoading, setClaudeLoading] = useState(false);
  const [claudeLocalApiUrl, setClaudeLocalApiUrl] = useState('');
  const [claudeLocalApiKey, setClaudeLocalApiKey] = useState('');
  const [claudeLocalModels, setClaudeLocalModels] = useState([]);
  const [claudeTestResult, setClaudeTestResult] = useState(null);
  const [claudeFetchedModels, setClaudeFetchedModels] = useState([]);
  const [claudeFetchingModels, setClaudeFetchingModels] = useState(false);
  const [claudeTesting, setClaudeTesting] = useState(false);
  const [claudeSupports1M, setClaudeSupports1M] = useState(settings.claudeModelSupports1M ?? false);
  const [claudeModelsMeta, setClaudeModelsMeta] = useState({}); // { modelName: true } 表示支持1M

  // 初始化：如果开关ON，读取本地配置
  useEffect(() => {
    if (settings.claudeUseLocalConfig) {
      loadLocalClaudeConfig();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadLocalClaudeConfig = async () => {
    setClaudeLoading(true);
    try {
      const result = await window.electronAPI.claude.readLocalConfig();
      if (result.success && result.config.exists) {
        setClaudeLocalApiUrl(result.config.apiUrl);
        setClaudeLocalApiKey(result.config.apiKey);
        setClaudeLocalModels(result.config.models);
        setClaudeModelsMeta(result.config.modelsMeta || {});
        // 如果表单中没有已选模型，优先用配置文件已保存的模型，否则用本地配置的默认值
        if (!form.getFieldValue('claudeModel')) {
          const savedModel = settings.claudeModel;
          if (savedModel) {
            form.setFieldsValue({ claudeModel: savedModel });
            setClaudeSupports1M(settings.claudeModelSupports1M ?? false);
          } else if (result.config.model) {
            form.setFieldsValue({ claudeModel: result.config.model });
            setClaudeSupports1M(result.config.modelSupports1M ?? false);
          }
        }
        setClaudeUseLocal(true);
        message.success('已读取本地 Claude 配置');
      } else {
        message.warning('当前系统未检测到 Claude 配置，请手动填写');
        setClaudeUseLocal(false);
      }
    } catch (e) {
      message.error('读取本地配置失败: ' + e.message);
      setClaudeUseLocal(false);
    } finally {
      setClaudeLoading(false);
    }
  };

  const handleTestToken = async () => {
    const values = form.getFieldsValue();
    if (!values.gitlabServerUrl || !values.gitlabAccessToken) {
      message.warning('请先填写GitLab地址和令牌');
      return;
    }

    try {
      const result = await window.electronAPI.gitlab.testToken(
        values.gitlabServerUrl,
        values.gitlabAccessToken
      );
      setTestResult(result);
      if (result.success) {
        message.success('令牌验证成功');
      } else {
        message.error(result.error);
      }
    } catch (error) {
      message.error('测试失败: ' + error.message);
    }
  };

  // 获取当前有效的 API 参数（开关ON用本地配置，OFF用表单值）
  const getCurrentApiParams = () => {
    if (claudeUseLocal) {
      return {
        apiUrl: claudeLocalApiUrl,
        apiKey: claudeLocalApiKey,
        model: form.getFieldValue('claudeModel')
      };
    }
    return {
      apiUrl: form.getFieldValue('claudeApiUrl'),
      apiKey: form.getFieldValue('claudeApiKey'),
      model: form.getFieldValue('claudeModel')
    };
  };

  const handleClaudeTestConnection = async () => {
    const { apiUrl, apiKey, model } = getCurrentApiParams();
    if (!apiUrl || !apiKey) {
      message.warning('请先配置 API 地址和 Key');
      return;
    }
    setClaudeTesting(true);
    try {
      const result = await window.electronAPI.claude.testConnection(apiUrl, apiKey, model);
      setClaudeTestResult(result);
      if (result.success) {
        message.success('Claude 连接测试成功');
      } else {
        message.error(result.error);
      }
    } catch (e) {
      setClaudeTestResult({ success: false, error: e.message });
      message.error('测试连接失败: ' + e.message);
    } finally {
      setClaudeTesting(false);
    }
  };

  const handleClaudeFetchModels = async () => {
    const { apiUrl, apiKey } = getCurrentApiParams();
    if (!apiUrl || !apiKey) {
      message.warning('请先配置 API 地址和 Key');
      return;
    }
    setClaudeFetchingModels(true);
    try {
      const result = await window.electronAPI.claude.fetchModels(apiUrl, apiKey);
      if (result.success) {
        setClaudeFetchedModels(result.models);
        if (result.modelsMeta) setClaudeModelsMeta(prev => ({ ...prev, ...result.modelsMeta }));
        message.success(`获取到 ${result.models.length} 个模型`);
      } else if (result.notSupported) {
        message.info('当前 API 服务不支持获取模型列表，请手动输入模型名称');
      } else {
        message.error(result.error);
      }
    } catch (e) {
      message.error('获取模型列表失败: ' + e.message);
    } finally {
      setClaudeFetchingModels(false);
    }
  };

  // 保存时：开关ON不存储apiUrl/apiKey
  const handleFinish = (values) => {
    // 以现有 settings 为底合并表单值，避免未在表单中出现的字段（如分支预设）被清空
    const newSettings = { ...settings, ...values };

    if (claudeUseLocal) {
      newSettings.claudeUseLocalConfig = true;
      delete newSettings.claudeApiUrl;
      delete newSettings.claudeApiKey;
    } else {
      newSettings.claudeUseLocalConfig = false;
    }

    // 保存 1M 标记
    newSettings.claudeModelSupports1M = claudeSupports1M;

    onSave(newSettings);
  };

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={settings}
      onFinish={handleFinish}
    >
      <Tabs items={[
        {
          key: 'gitlab',
          label: 'GitLab设置',
          children: (
            <>
              <Form.Item
                label="GitLab服务器地址"
                name="gitlabServerUrl"
                rules={[{ required: true, message: '请输入GitLab地址' }]}
              >
                <Input placeholder="https://git.landray.com.cn/" />
              </Form.Item>
              <Form.Item
                label="GitLab访问令牌"
                name="gitlabAccessToken"
              >
                <Input.Password placeholder="输入您的Personal Access Token" />
              </Form.Item>
              <Button onClick={handleTestToken}>测试令牌</Button>
              {testResult && (
                <Alert
                  style={{ marginTop: 16 }}
                  type={testResult.success ? 'success' : 'error'}
                  message={testResult.success ? '验证成功' : '验证失败'}
                  description={testResult.success ? `用户: ${testResult.user?.name}` : testResult.error}
                />
              )}
            </>
          )
        },
        {
          key: 'branches',
          label: '分支配置',
          children: (
            <>
              <Form.Item
                label="提测目标分支 (每行一个)"
                name="testBranches"
              >
                <Input.TextArea rows={4} />
              </Form.Item>
              <Form.Item
                label="入库目标分支 (每行一个)"
                name="releaseBranches"
              >
                <Input.TextArea rows={4} />
              </Form.Item>
              <Form.Item
                label="Bug提测目标分支 (每行一个)"
                name="bugTestBranches"
              >
                <Input.TextArea rows={4} />
              </Form.Item>
            </>
          )
        },
        {
          key: 'claude',
          label: 'Claude设置',
          children: (
            <>
              <div style={{ marginBottom: 16 }}>
                <Space align="center">
                  <span style={{ fontWeight: 500 }}>读取本地Claude配置</span>
                  <Switch
                    checked={claudeUseLocal}
                    loading={claudeLoading}
                    onChange={async (checked) => {
                      if (checked) {
                        await loadLocalClaudeConfig();
                      } else {
                        setClaudeUseLocal(false);
                      }
                    }}
                  />
                </Space>
                <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
                  开启后自动读取 ~/.claude/settings.json 和环境变量，API地址和Key不存储到本地
                </div>
              </div>

              <Form.Item
                label="Claude API 地址"
                name={claudeUseLocal ? undefined : 'claudeApiUrl'}
              >
                <Input
                  value={claudeUseLocal ? claudeLocalApiUrl : undefined}
                  placeholder="https://api.anthropic.com"
                  disabled={claudeUseLocal}
                  suffix={claudeUseLocal ? <LockOutlined style={{ color: '#999' }} /> : null}
                  onChange={!claudeUseLocal ? (e) => form.setFieldsValue({ claudeApiUrl: e.target.value }) : undefined}
                />
              </Form.Item>

              <Form.Item
                label="Claude API Key"
                name={claudeUseLocal ? undefined : 'claudeApiKey'}
              >
                <Input.Password
                  value={claudeUseLocal ? claudeLocalApiKey : undefined}
                  placeholder="输入 API Key"
                  disabled={claudeUseLocal}
                  suffix={claudeUseLocal ? <LockOutlined style={{ color: '#999' }} /> : null}
                  onChange={!claudeUseLocal ? (e) => form.setFieldsValue({ claudeApiKey: e.target.value }) : undefined}
                />
              </Form.Item>

              {/* 模型名称 + 1M 复选框 */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <Form.Item label="模型名称" name="claudeModel" style={{ flex: 1, marginBottom: 0 }}>
                  {claudeUseLocal ? (
                    <Select
                      placeholder="选择模型"
                      options={[...new Set([...claudeLocalModels, ...claudeFetchedModels, claudeModelValue].filter(Boolean))].map(m => ({ label: m, value: m }))}
                      onChange={(value) => {
                        // 如果选中的模型在本地配置中标记了 [1m]，自动勾选
                        if (claudeModelsMeta[value]) {
                          setClaudeSupports1M(true);
                        }
                      }}
                    />
                  ) : (
                    <AutoComplete
                      placeholder="输入或选择模型"
                      options={[...new Set([...claudeLocalModels, ...claudeFetchedModels, claudeModelValue].filter(Boolean))].map(m => ({ label: m, value: m }))}
                      filterOption={(inputValue, option) =>
                        option.label.toLowerCase().includes(inputValue.toLowerCase())
                      }
                    />
                  )}
                </Form.Item>
                <div style={{ paddingTop: 0 }}>
                  <div style={{ height: 22, display: 'flex', alignItems: 'flex-end', paddingBottom: 8, fontSize: 14, color: 'rgba(0,0,0,0.88)' }}>
                    声明支持 1M
                  </div>
                  <Checkbox
                    checked={claudeSupports1M}
                    onChange={(e) => setClaudeSupports1M(e.target.checked)}
                  >
                    1M
                  </Checkbox>
                </div>
              </div>

              <Form.Item>
                <Space>
                  <Button onClick={handleClaudeTestConnection} loading={claudeTesting}>测试连接</Button>
                  <Button
                    onClick={handleClaudeFetchModels}
                    loading={claudeFetchingModels}
                    icon={<DownloadOutlined />}
                  >
                    获取模型列表
                  </Button>
                </Space>
              </Form.Item>

              {claudeTestResult && (
                <Alert
                  style={{ marginBottom: 12 }}
                  type={claudeTestResult.success ? 'success' : 'error'}
                  message={claudeTestResult.success ? '连接成功' : '连接失败'}
                  description={claudeTestResult.success
                    ? `模型: ${claudeTestResult.model}`
                    : claudeTestResult.error}
                />
              )}

              <Alert
                type="info"
                message="支持 Anthropic 官方 API 及兼容服务（如 DeepSeek API），只需配置对应的 API 地址和 Key 即可。"
                style={{ fontSize: 12 }}
              />
            </>
          )
        }
      ]} />

      <Form.Item>
        <Button type="primary" htmlType="submit" block>
          保存设置
        </Button>
      </Form.Item>
    </Form>
  );
};

export default MainWorkspace;

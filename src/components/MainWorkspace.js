import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

import {
  Layout,
  Button,
  Space,
  message,
  Drawer,
  Spin,
} from 'antd';
import {
  ArrowLeftOutlined,
  ReloadOutlined,
  DownloadOutlined,
  BranchesOutlined,
  GlobalOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import './MainWorkspace.css';
import { mergeMultiLanguageContent } from '../utils/mergeUtils';
import { performanceMonitor } from '../utils/performanceUtils';
import SettingsForm from './SettingsForm';
import OperationPanel from './OperationPanel';
import CommitListPanel from './CommitListPanel';
import {
  MergeProgressModal,
  MergeResultModal,
  ConflictResolveModal,
  CherryPickProgressModal,
  CherryPickResultModal,
  ConflictProgressModal,
  ConflictResultModal,
  ChangeDetectProgressModal,
  ChangeDetectResultModal,
  VersionDetectProgressModal,
  VersionDetectResultModal,
  BranchSwitcherModal,
} from './ProgressModals';
import { useDetectOperations } from '../hooks/useDetectOperations';
import { useCherryPickAndPush } from '../hooks/useCherryPickAndPush';
import { useCreateMergeBranch } from '../hooks/useCreateMergeBranch';
import { useRemoteCherryPick } from '../hooks/useRemoteCherryPick';

const { Header, Content } = Layout;

const MainWorkspace = ({ project, onClose }) => {
  const [branches, setBranches] = useState([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [commits, setCommits] = useState([]);
  const [selectedCommits, setSelectedCommits] = useState([]);
  const [selectedTargetBranches, setSelectedTargetBranches] = useState([]);
  const [customBranchInputs, setCustomBranchInputs] = useState(['']); // 指定分支合并模式的动态分支输入
  const [mergeType, setMergeType] = useState('bug');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [settings, setSettings] = useState({});
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearchText, setDebouncedSearchText] = useState('');
  const [showMyCommits, setShowMyCommits] = useState(false);
  const [allCommits, setAllCommits] = useState([]);
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
  const [, setConflictAutoMerging] = useState(false);
  const conflictResolveRef = useRef(null);

  // 外部仓库相关状态
  const [remoteRepos, setRemoteRepos] = useState([]);
  const [selectedRemoteRepos, setSelectedRemoteRepos] = useState([]);
  const [remoteRepoBranches, setRemoteRepoBranches] = useState({});
  const [selectedRemoteBranches, setSelectedRemoteBranches] = useState({});
  const [loadingRemoteRepos, setLoadingRemoteRepos] = useState(false);

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
        
        await loadRemoteRepos();
        console.log(`[${timestamp}] [init] 外部仓库加载完成`);
        
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const loadRemoteRepos = async () => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [loadRemoteRepos] 开始加载外部仓库列表`);
    
    try {
      console.log(`[${timestamp}] [loadRemoteRepos] 调用 API 获取仓库列表...`);
      const repos = await window.electronAPI.remoteRepos.list();
      
      console.log(`[${timestamp}] [loadRemoteRepos] 获取到 ${repos?.length || 0} 个仓库`);
      setRemoteRepos(repos || []);
      console.log(`[${timestamp}] [loadRemoteRepos] 仓库列表已设置到状态`);
    } catch (error) {
      console.error(`[${timestamp}] [loadRemoteRepos] 加载仓库列表失败:`, error);
    }
  };

  // 监听选中仓库变化，自动加载分支
  useEffect(() => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [useEffect] 选中仓库变化，开始加载分支`);
    
    if (selectedRemoteRepos.length === 0) {
      setRemoteRepoBranches({});
      return;
    }

    setLoadingRemoteRepos(true);
    
    const loadBranchesForRepos = async () => {
      try {
        const newBranches = {};
        
        for (const repoId of selectedRemoteRepos) {
          // 使用函数式更新来读取缓存，避免将 remoteRepoBranches 加入依赖数组
          let cachedBranches = null;
          setRemoteRepoBranches(prev => {
            if (prev[repoId]) {
              cachedBranches = prev[repoId];
            }
            return prev;
          });
          
          // 如果已缓存，使用缓存
          if (cachedBranches) {
            newBranches[repoId] = cachedBranches;
            continue;
          }

          console.log(`[${timestamp}] [loadBranchesForRepos] 加载仓库 ${repoId} 的分支...`);
          
          // 查找仓库信息
          const repo = remoteRepos.find(r => r.id === repoId);
          if (!repo) {
            console.warn(`[${timestamp}] [loadBranchesForRepos] 未找到仓库 ${repoId}`);
            continue;
          }

          // Clone 仓库（如果尚未 clone）
          const cloneResult = await window.electronAPI.remoteRepos.clone({ 
            repoId, 
            url: repo.url 
          });
          
          if (!cloneResult.success) {
            console.error(`[${timestamp}] [loadBranchesForRepos] Clone 失败: ${cloneResult.error}`);
            message.error(`Clone 仓库 ${repo.name} 失败: ${cloneResult.error}`);
            continue;
          }

          // 获取分支列表
          const branches = await window.electronAPI.remoteRepos.getBranches({ 
            repoPath: cloneResult.repoPath 
          });
          
          console.log(`[${timestamp}] [loadBranchesForRepos] 获取到 ${branches?.length || 0} 个分支`);
          newBranches[repoId] = branches || [];
        }
        
        setRemoteRepoBranches(prev => ({ ...prev, ...newBranches }));
        console.log(`[${timestamp}] [loadBranchesForRepos] 分支加载完成`);
      } catch (error) {
        console.error(`[${timestamp}] [loadBranchesForRepos] 加载分支失败:`, error);
        message.error('加载外部仓库分支失败');
      } finally {
        setLoadingRemoteRepos(false);
      }
    };

    loadBranchesForRepos();
  }, [selectedRemoteRepos, remoteRepos]);

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
    // 先从远程 fetch 最新提交
    try {
      await window.electronAPI.git.fetch();
    } catch (e) {
      console.warn('[handleRefresh] fetch 失败:', e.message);
    }
    if (viewBranch) {
      await loadCommits(viewBranch, true);
    }
    message.success('刷新成功');
  };

  // 遴选推送操作（抽取到 hook）
  const handleCherryPickAndPush = useCherryPickAndPush({
    selectedCommits,
    selectedTargetBranches,
    mergeType,
    currentBranch,
    viewBranch,
    setLoading,
    setCherryPickProgress,
    setCherryPickResultModal,
    setSelectedCommits,
    setConflictModal,
    handleAutoMergeLanguageFiles,
    conflictResolveRef,
    loadCurrentBranch,
    loadCommits,
    findCommitByHash,
    settings,
    setSettings,
  });

  // 跨仓库遴选推送
  const handleRemoteCherryPick = useRemoteCherryPick({
    selectedCommits,
    selectedRemoteRepos,
    remoteRepoBranches,
    selectedRemoteBranches,
    remoteRepos,
    sourceProjectPath: project?.path,
    setLoading,
    setCherryPickProgress,
    setCherryPickResultModal,
  });

  // 整合遴选推送：先执行当前仓库，再执行外部仓库
  const handleCombinedCherryPickAndPush = async () => {
    await handleCherryPickAndPush();
    const remoteResult = await handleRemoteCherryPick();
    if (remoteResult?.hasRemoteWork && remoteResult.results) {
      setCherryPickResultModal(prev => ({
        ...prev,
        visible: true,
        success: (prev.results || []).every(r => r.success) && remoteResult.results.every(r => r.success),
        results: [...(prev.results || []), ...remoteResult.results]
      }));
    }
  };

  // 创建合并分支操作（抽取到 hook）
  const handleCreateMergeBranch = useCreateMergeBranch({
    selectedCommits,
    selectedTargetBranches,
    mergeType,
    currentBranch,
    currentUser,
    settings,
    viewBranch,
    setLoading,
    setMergeProgress,
    setMergeResultModal,
    setSettingsVisible,
    setConflictModal,
    handleAutoMergeLanguageFiles,
    conflictResolveRef,
    findCommitByHash,
    loadCurrentBranch,
    loadBranches,
    setSettings,
    selectedRemoteRepos,
    selectedRemoteBranches,
    remoteRepos,
    sourceProjectPath: project?.path,
  });

  const { handleDetectConflicts, handleDetectChanges, handleDetectVersion, handleOpenInBrowser } = useDetectOperations({
    selectedCommits,
    selectedTargetBranches,
    mergeType,
    currentBranch,
    currentUser,
    findCommitByHash,
    loadCurrentBranch,
    setConflictDetecting,
    setConflictProgress,
    setConflictResultModal,
    setChangeDetecting,
    setChangeDetectProgress,
    setChangeDetectResultModal,
    setVersionDetecting,
    setVersionDetectProgress,
    setVersionDetectResultModal,
  });

  const isDetectConflictDisabled = selectedCommits.length === 0 || selectedTargetBranches.length === 0 || conflictDetecting;

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
          <span
            className="branch-tag"
            onClick={() => {
              setSelectedViewBranch(viewBranch);
              setBranchSearchText('');
              setBranchSwitcherVisible(true);
            }}
          >
            <BranchesOutlined /> {viewBranch}
          </span>
          {viewBranch !== currentBranch && (
            <Button
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
          <Button icon={<SettingOutlined />} onClick={() => setSettingsVisible(true)}>
            设置
          </Button>
        </Space>
      </Header>

      <Content className="workspace-content">
        <CommitListPanel
          searchText={searchText}
          setSearchText={setSearchText}
          showMyCommits={showMyCommits}
          setShowMyCommits={setShowMyCommits}
          loading={loading}
          loadingMore={loadingMore}
          hasMoreCommits={hasMoreCommits}
          filteredCommits={filteredCommits}
          selectedCommitsSet={selectedCommitsSet}
          toggleCommitSelection={toggleCommitSelection}
          handleRefresh={handleRefresh}
          loadMoreCommits={loadMoreCommits}
          commitsListRef={commitsListRef}
        />

        <OperationPanel
          mergeType={mergeType}
          setMergeType={setMergeType}
          selectedTargetBranches={selectedTargetBranches}
          setSelectedTargetBranches={setSelectedTargetBranches}
          customBranchInputs={customBranchInputs}
          setCustomBranchInputs={setCustomBranchInputs}
          branches={branches}
          settings={settings}
          loading={loading}
          handleCherryPickAndPush={handleCombinedCherryPickAndPush}
          handleCreateMergeBranch={handleCreateMergeBranch}
          handleDetectConflicts={handleDetectConflicts}
          handleDetectChanges={handleDetectChanges}
          handleDetectVersion={handleDetectVersion}
          conflictDetecting={conflictDetecting}
          changeDetecting={changeDetecting}
          versionDetecting={versionDetecting}
          selectedCommitsCount={selectedCommits.length}
          isDetectConflictDisabled={isDetectConflictDisabled}
          remoteRepos={remoteRepos}
          selectedRemoteRepos={selectedRemoteRepos}
          setSelectedRemoteRepos={setSelectedRemoteRepos}
          remoteRepoBranches={remoteRepoBranches}
          selectedRemoteBranches={selectedRemoteBranches}
          setSelectedRemoteBranches={setSelectedRemoteBranches}
          loadingRemoteRepos={loadingRemoteRepos}
        />
      </Content>

      {/* 设置抽屉 */}
      <Drawer
        title="应用设置"
        placement="right"
        width={600}
        open={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        rootStyle={{ top: 40 }}
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


      {/* 所有进度/结果 Modal */}
      <MergeProgressModal mergeProgress={mergeProgress} />
      <MergeResultModal mergeResultModal={mergeResultModal} setMergeResultModal={setMergeResultModal} selectedCommits={selectedCommits} findCommitByHash={findCommitByHash} />
      <ConflictResolveModal conflictModal={conflictModal} allFilesResolved={allFilesResolved} handleConflictConfirm={handleConflictConfirm} handleConflictCancel={handleConflictCancel} handleOpenFile={handleOpenFile} handleMarkResolved={handleMarkResolved} />
      <CherryPickProgressModal cherryPickProgress={cherryPickProgress} />
      <CherryPickResultModal cherryPickResultModal={cherryPickResultModal} setCherryPickResultModal={setCherryPickResultModal} />
      <ConflictProgressModal conflictProgress={conflictProgress} />
      <ConflictResultModal conflictResultModal={conflictResultModal} setConflictResultModal={setConflictResultModal} />
      <ChangeDetectProgressModal changeDetectProgress={changeDetectProgress} />
      <ChangeDetectResultModal changeDetectResultModal={changeDetectResultModal} setChangeDetectResultModal={setChangeDetectResultModal} />
      <VersionDetectProgressModal versionDetectProgress={versionDetectProgress} />
      <VersionDetectResultModal versionDetectResultModal={versionDetectResultModal} setVersionDetectResultModal={setVersionDetectResultModal} />

      {/* 分支切换 Modal */}
      <BranchSwitcherModal
        branchSwitcherVisible={branchSwitcherVisible}
        setBranchSwitcherVisible={setBranchSwitcherVisible}
        branchSearchText={branchSearchText}
        setBranchSearchText={setBranchSearchText}
        branches={branches}
        selectedViewBranch={selectedViewBranch}
        setSelectedViewBranch={setSelectedViewBranch}
        setViewBranch={setViewBranch}
        setSelectedCommits={setSelectedCommits}
        setSearchText={setSearchText}
        setShowMyCommits={setShowMyCommits}
        currentBranch={currentBranch}
        originalBranch={originalBranch}
      />
    </Layout>
  );
};


export default MainWorkspace;

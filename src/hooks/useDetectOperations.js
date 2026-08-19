import { useCallback } from 'react';
import { message } from 'antd';
import { validateCustomBranches as validateCustomBranchesUtil } from '../utils/workspaceHelpers';

export function useDetectOperations({
  selectedCommits,
  selectedTargetBranches,
  mergeType,
  findCommitByHash,
  setChangeDetecting,
  setChangeDetectProgress,
  setChangeDetectResultModal,
  setVersionDetecting,
  setVersionDetectProgress,
  setVersionDetectResultModal,
}) {

  const handleDetectChanges = useCallback(async () => {
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
      const { valid, invalid } = await validateCustomBranchesUtil(selectedTargetBranches);
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
  }, [selectedCommits, selectedTargetBranches, mergeType, findCommitByHash, setChangeDetecting, setChangeDetectProgress, setChangeDetectResultModal]);

  const handleDetectVersion = useCallback(async () => {
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
  }, [selectedCommits, selectedTargetBranches, findCommitByHash, setVersionDetecting, setVersionDetectProgress, setVersionDetectResultModal]);

  const handleOpenInBrowser = useCallback(async () => {
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
  }, []);

  return {
    handleDetectChanges,
    handleDetectVersion,
    handleOpenInBrowser,
  };
}

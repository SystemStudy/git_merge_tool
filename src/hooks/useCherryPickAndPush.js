/**
 * 遴选推送操作 hook - 从 MainWorkspace.js 中抽取 handleCherryPickAndPush
 * 包含 cherry-pick + push 两阶段操作
 */
import { message } from 'antd';
import { normalizeVersion } from '../utils/versionBaseline';
import { runCherryPickLoop } from './useCherryPickLoop';
import { validateCustomBranches } from '../utils/workspaceHelpers';

/**
 * 遴选推送整合按钮处理函数 - 添加进度条和成功弹窗
 * @param {Object} deps - 所有依赖
 * @returns {Function} handleCherryPickAndPush
 */
export const useCherryPickAndPush = ({
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
  handleClaudeResolveConflicts,
  setConflictClaudeLoading,
  conflictResolveRef,
  loadCurrentBranch,
  loadCommits,
}) => {
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

        // 读取目标分支的 pom 版本，用于跨版本替换方向判定（比全局配置匹配更可靠）
        let targetVersion = null;
        try {
          const targetPom = await window.electronAPI.git.readPomParentVersion();
          if (targetPom.success) {
            targetVersion = normalizeVersion(targetPom.version);
            console.log(`[handleCherryPickAndPush] 目标分支 ${targetBranch} pom parent.version=${targetPom.version} → 归一化 ${targetVersion}`);
          } else {
            console.warn(`[handleCherryPickAndPush] 读取目标分支 pom 失败(${targetPom.error})，将回退到全局配置匹配`);
          }
        } catch (e) {
          console.warn(`[handleCherryPickAndPush] 读取目标分支 pom 异常: ${e.message}`);
        }

        // 记录遴选前 HEAD sha，用于后续版本替换的文件 diff 范围与 squash 基点
        const beforePickSha = (await window.electronAPI.git.getHeadSha()).sha;

        // 逐 commit cherry-pick + 冲突处理 + 基线替换（抽取到公共函数）
        const loopResult = await runCherryPickLoop({
          commitsToCherryPick,
          targetBranch,
          setProgress: setCherryPickProgress,
          handleAutoMergeLanguageFiles,
          handleClaudeResolveConflicts,
          setConflictClaudeLoading,
          throwOnError: false,
          sourceVersion,
          targetVersion,
          beforePickSha,
          onBranchSuccess: async () => {
            // 有实际合并内容，记录该分支用于后续推送
            cherryPickedBranches.push(targetBranch);
          },
          conflictResolveRef,
          setConflictModal,
          setLoading,
          results,
          logPrefix: 'handleCherryPickAndPush',
        });
        if (loopResult.aborted) return;

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

  return handleCherryPickAndPush;
};

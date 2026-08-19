/**
 * 创建合并分支操作 hook - 从 MainWorkspace.js 中抽取 handleCreateMergeBranch
 * 包含创建分支 + cherry-pick + push + 创建 MR 两阶段操作
 */
import { message } from 'antd';
import { normalizeVersion } from '../utils/versionBaseline';
import { runCherryPickLoop } from './useCherryPickLoop';
import {
  generateRandomBranchSuffix,
  showMergeBranchConflictDialog,
  validateCustomBranches,
  extractIssueNumber,
  generateBranchName,
  ensureAuthorEmailCompliance,
} from '../utils/workspaceHelpers';

/**
 * 创建合并分支处理函数
 * @param {Object} deps - 所有依赖
 * @returns {Function} handleCreateMergeBranch
 */
export const useCreateMergeBranch = ({
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
}) => {
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

    // custom 模式：验证分支是否存在（仅在有目标分支时验证）
    let effectiveBranches = selectedTargetBranches;
    if (mergeType === 'custom' && selectedTargetBranches.length > 0) {
      const { valid, invalid } = await validateCustomBranches(selectedTargetBranches);
      invalid.forEach(b => message.warning(`分支 "${b}" 不存在，已跳过`));
      effectiveBranches = valid;
    }

    if (!settings.gitlabServerUrl || !settings.gitlabAccessToken) {
      console.warn(`[${timestamp}] [handleCreateMergeBranch] GitLab配置缺失`);
      message.warning('请先配置GitLab服务器地址和访问令牌');
      setSettingsVisible(true);
      setLoading(false);
      return;
    }

    const hasLocalWork = effectiveBranches.length > 0;
    const totalOperations = effectiveBranches.length;
    const results = [];

    // 提取问题单号
    const selectedCommitsData = selectedCommits.map(hash => findCommitByHash(hash)).filter(Boolean);
    const issueNumber = extractIssueNumber(selectedCommitsData);
    const username = currentUser.name || 'unknown';

    // 校验选中提交的 author 邮箱合规性（不合规则弹窗获取替换邮箱）
    const compliance = await ensureAuthorEmailCompliance({ commits: selectedCommitsData, settings, setSettings });
    if (!compliance.proceed) {
      setLoading(false);
      message.info('操作已取消');
      return;
    }

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

    console.log(`[${new Date().toISOString()}] [handleCreateMergeBranch] 提取到问题单号: ${issueNumber || '无'}`);
    console.log(`[${new Date().toISOString()}] [handleCreateMergeBranch] 当前用户名: ${username}`);

    // 在循环开始前保存 selectedCommits 的副本，确保在循环期间不会被修改
    const commitsToCherryPick = [...selectedCommits];
    console.log(`[${new Date().toISOString()}] [handleCreateMergeBranch] 保存提交列表副本: ${commitsToCherryPick.length}个提交`, commitsToCherryPick);

    // 本地仓库操作变量（仅在有本地目标分支时使用）
    let originalBranch = null;
    const createdBranches = [];
    const branchInfos = [];

    try {
      // ========== 开始处理本地仓库目标分支 ==========
      if (hasLocalWork) {
        console.log(`[${new Date().toISOString()}] [handleCreateMergeBranch] ========== 开始处理本地仓库目标分支 ==========`);

        originalBranch = currentBranch;
        console.log(`[${new Date().toISOString()}] [handleCreateMergeBranch] 保存原始分支: ${originalBranch}`);
      }
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

        // 读取目标分支的 pom 版本，用于跨版本替换方向判定
        let targetVersion = null;
        try {
          const targetPom = await window.electronAPI.git.readPomParentVersion();
          if (targetPom.success) {
            targetVersion = normalizeVersion(targetPom.version);
            console.log(`[handleCreateMergeBranch] 目标分支 pom parent.version=${targetPom.version} → 归一化 ${targetVersion}`);
          } else {
            console.warn(`[handleCreateMergeBranch] 读取目标分支 pom 失败(${targetPom.error})，将回退到全局配置匹配`);
          }
        } catch (e) {
          console.warn(`[handleCreateMergeBranch] 读取目标分支 pom 异常: ${e.message}`);
        }

        // 记录遴选前 HEAD sha，用于后续版本替换的文件 diff 范围与 squash 基点
        const beforePickSha = (await window.electronAPI.git.getHeadSha()).sha;

        // 逐 commit cherry-pick + 冲突处理 + 基线替换（抽取到公共函数）
        // throwOnError: true 时，用户终止会抛异常被外层 catch 捕获，无需检查返回值
        await runCherryPickLoop({
          commitsToCherryPick,
          targetBranch,
          mergeBranchName,
          setProgress: setMergeProgress,
          handleAutoMergeLanguageFiles,
          throwOnError: true,
          sourceVersion,
          targetVersion,
          beforePickSha,
          onBranchSuccess: async () => {
            // 有实际合并内容，保存分支信息用于后续推送和创建MR
            branchInfos.push({
              targetBranch,
              mergeBranchName: actualBranchName,
              intendedBranchName: mergeBranchName,
              index: i
            });
            console.log(`[${opTimestamp}] [handleCreateMergeBranch] 第 ${currentOp}/${totalOperations} 个目标分支 cherry-pick 完成`);
          },
          onNoNewCommitsCleanup: async () => {
            // 无新的提交，清理合并分支
            console.log(`[${opTimestamp}] [handleCreateMergeBranch] ${targetBranch} 无需要合并的内容，清理合并分支`);
            try {
              await window.electronAPI.git.checkout(originalBranch);
              await window.electronAPI.git.deleteLocalBranch(actualBranchName, true);
            } catch (e) {
              console.log(`[${opTimestamp}] [handleCreateMergeBranch] 清理合并分支 ${actualBranchName} 失败:`, e.message);
            }
          },
          conflictResolveRef,
          setConflictModal,
          setLoading,
          results,
          logPrefix: 'handleCreateMergeBranch',
          invalidAuthorMap: compliance.invalidAuthorMap,
          replacementEmail: compliance.replacementEmail,
        });
      }

      // ========== 第二阶段：对所有目标分支进行推送和创建合并请求 ==========
      // 仅当存在本地目标分支时执行；纯跨仓库（无本地目标分支）时跳过，直接进入第三阶段
      if (hasLocalWork) {
        console.log(`[${new Date().toISOString()}] [handleCreateMergeBranch] ========== 第二阶段：推送和创建合并请求 ==========`);

      // 获取远程URL并提取项目路径（只需获取一次）
      const remoteUrl = await window.electronAPI.git.getRemoteUrl();
      console.log(`[${new Date().toISOString()}] [handleCreateMergeBranch] 远程URL: ${remoteUrl}`);
      
      let projectPath = '';
      if (remoteUrl) {
        const urlMatch = remoteUrl.match(/(?:https?:\/\/[^/]+\/|git@[^:]+:)(.+?)(?:\.git)?$/);
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
      } // end for branchInfos（推送 + 创建 MR 循环）
      } // end if (hasLocalWork) - second phase

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

  return handleCreateMergeBranch;
};

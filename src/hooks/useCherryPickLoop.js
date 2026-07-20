import { message, Modal } from 'antd';
import { applyBaselineReplacementAndSquash } from '../utils/baselineReplacement';
import { isMultiLanguageConflict } from '../utils/mergeUtils';
import { showSkipAbortDialog } from '../utils/workspaceHelpers';

/**
 * 执行 cherry-pick 循环（逐 commit cherry-pick + 冲突处理 + 基线替换）
 * 被 handleCherryPickAndPush 和 handleCreateMergeBranch 共用
 *
 * @param {Object} params
 * @param {string[]} params.commitsToCherryPick - 要 cherry-pick 的提交 hash 列表
 * @param {string} params.targetBranch - 目标分支
 * @param {string} [params.mergeBranchName] - 合并分支名（handleCreateMergeBranch 使用，会写入结果对象）
 * @param {Function} params.setProgress - React state setter for progress（接受 updater function）
 * @param {Function} params.handleAutoMergeLanguageFiles - 多语言自动合并函数
 * @param {boolean} params.throwOnError - 是否在终止时 throw（handleCreateMergeBranch 需要 throw）
 * @param {string} params.sourceVersion - 源版本号（归一化后）
 * @param {string} params.targetVersion - 目标版本号（归一化后）
 * @param {string} params.beforePickSha - cherry-pick 前的 HEAD sha
 * @param {Function} params.onBranchSuccess - 分支成功且有新提交时的回调（async）
 * @param {Function} [params.onNoNewCommitsCleanup] - "无新提交"时的清理回调（async）
 * @param {Object} params.conflictResolveRef - 冲突解决 ref
 * @param {Function} params.setConflictModal - 冲突 Modal state setter
 * @param {Function} params.setLoading - loading state setter
 * @param {Array} params.results - 结果数组（会直接 push）
 * @param {string} [params.logPrefix] - 日志前缀
 * @param {Map<string,string>} [params.invalidAuthorMap] - author 邮箱不合规的提交（hash -> 原作者名），遴选成功后重写邮箱
 * @param {string} [params.replacementEmail] - 替换邮箱
 * @returns {Promise<{aborted: boolean, branchHasError: boolean}>}
 */
export async function runCherryPickLoop(params) {
  const {
    commitsToCherryPick,
    targetBranch,
    mergeBranchName,
    setProgress,
    handleAutoMergeLanguageFiles,
    throwOnError = false,
    sourceVersion,
    targetVersion,
    beforePickSha,
    onBranchSuccess,
    onNoNewCommitsCleanup,
    conflictResolveRef,
    setConflictModal,
    setLoading,
    results,
    logPrefix = 'runCherryPickLoop',
    invalidAuthorMap = null,
    replacementEmail = null,
  } = params;

  const opTimestamp = new Date().toISOString();

  // Helper: 提交遴选成功后，若该提交 author 邮箱不合规则重写为替换邮箱（保留原作者名）
  const amendAuthorIfNeeded = async (sha) => {
    if (!invalidAuthorMap?.has(sha) || !replacementEmail) return;
    const amendResult = await window.electronAPI.git.amendAuthor(invalidAuthorMap.get(sha), replacementEmail);
    if (amendResult.success) {
      console.log(`[${opTimestamp}] [${logPrefix}] commit ${sha.substring(0, 8)} author 邮箱已替换为 <${replacementEmail}>`);
    } else {
      console.error(`[${opTimestamp}] [${logPrefix}] commit ${sha.substring(0, 8)} author 邮箱重写失败: ${amendResult.error}`);
      message.warning(`Commit ${sha.substring(0, 8)} 作者邮箱重写失败: ${amendResult.error}`);
    }
  };

  // Helper: 构建错误结果对象
  const buildErrorResult = (error) => {
    const result = { success: false, targetBranch, error, skipped: true };
    if (mergeBranchName) result.mergeBranch = mergeBranchName;
    return result;
  };

  // Helper: 处理用户终止操作
  const handleAbort = () => {
    if (throwOnError) {
      // handleCreateMergeBranch: 不设置 visible: false（由 catch 块处理），直接 throw
      setProgress(prev => ({ ...prev, status: '操作已终止' }));
      message.error('操作已终止');
      throw new Error('用户终止操作');
    } else {
      // handleCherryPickAndPush: 设置 visible: false + setLoading(false) + return
      setProgress(prev => ({ ...prev, visible: false, status: '操作已终止' }));
      setLoading(false);
      message.error('操作已终止');
    }
  };

  setProgress(prev => ({
    ...prev,
    status: `Cherry-pick 提交到: ${targetBranch}`
  }));

  console.log(`[${opTimestamp}] [${logPrefix}] 开始逐 commit cherry-pick: ${commitsToCherryPick.length} 个提交`);

  let branchHasError = false;

  for (const sha of commitsToCherryPick) {
    if (branchHasError) break;

    const singleResult = await window.electronAPI.git.cherryPickSingle(sha);

    if (singleResult.status === 'success') {
      console.log(`[${opTimestamp}] [${logPrefix}] commit ${sha.substring(0, 8)} cherry-pick 成功`);
      await amendAuthorIfNeeded(sha);
    } else if (singleResult.status === 'skipped') {
      console.log(`[${opTimestamp}] [${logPrefix}] commit ${sha.substring(0, 8)} 已存在，跳过`);
    } else if (singleResult.status === 'conflict') {
      console.log(`[${opTimestamp}] [${logPrefix}] commit ${sha.substring(0, 8)} 发生冲突`);
      const conflictedFiles = singleResult.conflictedFiles || [];

      // 多语言文件自动合并检测
      if (isMultiLanguageConflict(conflictedFiles)) {
        console.log(`[${opTimestamp}] [${logPrefix}] 检测到纯多语言文件冲突，尝试自动合并`);
        const autoResult = await handleAutoMergeLanguageFiles(targetBranch, sha, conflictedFiles);
        if (autoResult === 'auto-success') {
          const continueResult = await window.electronAPI.git.cherryPickContinue();
          if (continueResult.success) {
            await amendAuthorIfNeeded(sha);
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
            handleAbort();
            return { aborted: true, branchHasError: false };
          } else {
            branchHasError = true;
            results.push(buildErrorResult(continueResult.error));
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

      if (userAction === 'confirm') {
        // 用户确认已解决冲突 → 继续 cherry-pick
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
            handleAbort();
            return { aborted: true, branchHasError: false };
          } else {
            branchHasError = true;
            results.push(buildErrorResult(continueResult.error));
          }
        } else {
          await amendAuthorIfNeeded(sha);
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
          handleAbort();
          return { aborted: true, branchHasError: false };
        } else {
          branchHasError = true;
          results.push(buildErrorResult('用户放弃冲突解决'));
        }
      }
    } else if (singleResult.status === 'error') {
      // 其他错误
      console.error(`[${opTimestamp}] [${logPrefix}] commit ${sha.substring(0, 8)} 出错: ${singleResult.error}`);

      const choice = await showSkipAbortDialog(
        `Commit ${sha.substring(0, 8)} cherry-pick 失败`,
        <div>
          <p>错误信息：{singleResult.error}</p>
          <p>请选择操作：</p>
        </div>
      );

      if (choice === 'abort') {
        handleAbort();
        return { aborted: true, branchHasError: false };
      } else {
        branchHasError = true;
        results.push(buildErrorResult(singleResult.error));
      }
    }
  }

  // ========== Cherry-pick 循环结束后：检查新提交 + 基线替换 ==========
  if (!branchHasError) {
    // 通过 git 实际检查遴选后是否有新的提交
    const newCommitCheck = await window.electronAPI.git.checkHasNewCommits(targetBranch);
    if (newCommitCheck.hasNewCommits) {
      // 跨版本基线替换 + squash（跳过条件均不阻断主流程）
      await applyBaselineReplacementAndSquash({
        beforePickSha,
        targetBranch,
        currentV: sourceVersion,
        targetV: targetVersion,
        setProgress: (status) => setProgress(prev => ({ ...prev, status }))
      });
      // 回调通知调用方：分支成功
      await onBranchSuccess();
      console.log(`[${opTimestamp}] [${logPrefix}] ${targetBranch} cherry-pick 成功`);
    } else {
      // 无新的提交，先执行清理（如有），再提示用户
      console.log(`[${opTimestamp}] [${logPrefix}] ${targetBranch} 无需要合并的内容`);
      if (onNoNewCommitsCleanup) {
        await onNoNewCommitsCleanup();
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
        if (throwOnError) {
          setProgress(prev => ({ ...prev, visible: false }));
          message.error('操作已终止');
          throw new Error('用户终止操作');
        } else {
          setProgress(prev => ({ ...prev, visible: false }));
          message.error('操作已终止');
          setLoading(false);
          return { aborted: true, branchHasError: false };
        }
      }
    }
  }

  return { aborted: false, branchHasError };
}

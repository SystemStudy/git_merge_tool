/**
 * 遴选后跨版本基线替换 + squash into parent（归并）。
 * 从 MainWorkspace.js 中抽取
 */
import { decideDirection } from './versionBaseline';
import { message } from 'antd';

/**
 * cherry-pick 后版本基线替换 + squash into parent（归并）。
 * 在 cherry-pick 全部成功、推送前调用。任意跳过条件均 return 不抛错，不阻断主流程。
 * @param {Object} args
 * @param {string} args.beforePickSha 遴选前 HEAD sha（forceSync/createBranch 后取）
 * @param {string} args.targetBranch 目标分支名（用于匹配全局配置中的版本）
 * @param {Function} [args.setProgress] 进度文案更新回调 (statusText) => void
 * @param {string|null} args.currentV 源项目根 pom 归一化版本（遴选前读取，由调用方提供）
 * @param {string|null} args.targetV 目标分支 pom 归一化版本（从目标分支 pom 读取，优先于全局配置匹配）
 */
export async function applyBaselineReplacementAndSquash({ beforePickSha, targetBranch, setProgress, currentV, targetV: inputTargetV }) {
  const logTag = `[applyBaselineReplacementAndSquash:${targetBranch}]`;
  try {
    // 1. 当前版本（由调用方在遴选前读源 pom 提供）
    if (!currentV) {
      console.warn(`${logTag} 未提供当前版本(源 pom 读取失败或无法归一化)，跳过`);
      return { skipped: 'no-current-version' };
    }

    // 2. 目标版本（由调用方从目标分支 pom 读取）
    if (!inputTargetV) {
      console.warn(`${logTag} 未提供目标版本(目标分支 pom 读取失败或无法归一化)，跳过`);
      return { skipped: 'no-target-version' };
    }
    const targetV = inputTargetV;
    console.log(`${logTag} 使用目标分支 pom 版本: ${targetV}`);

    // 3. 方向
    const direction = decideDirection(currentV, targetV);
    if (direction === 'skip') {
      if (currentV === targetV) {
        console.log(`${logTag} 版本一致(${currentV})，跳过`);
        return { skipped: 'version-same' };
      }
      console.warn(`${logTag} 版本组合 ${currentV}→${targetV} 非两档替换，跳过`);
      return { skipped: 'version-mismatch' };
    }

    // 4. 列出本次遴选改动的 .java 文件
    const listRes = await window.electronAPI.git.listChangedJavaFiles(beforePickSha);
    if (!listRes.success || !listRes.files || listRes.files.length === 0) {
      console.log(`${logTag} 无 .java 改动文件，跳过`);
      return { skipped: 'no-java-files' };
    }

    // 5. 进度提示 + 应用替换
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

    // 6. squash into parent（合并进最后一个遴选 commit）
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

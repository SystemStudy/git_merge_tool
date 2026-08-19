import React from 'react';
import { Modal, Button, Input, message } from 'antd';

// 提交信息中昆仑单号的匹配格式：fix(feat): #MKR-XXXX ...
const ISSUE_PATTERN = /#([A-Za-z]+-\d+)/;
// 昆仑单号 + 操作名 + 说明内容的匹配格式：#MKR-XXXX 修复 说明内容
// 单号与说明之间有一个操作名（如 修复、新增），说明内容取操作名之后的部分
const ISSUE_DESC_PATTERN = /#[A-Za-z]+-\d+\s+\S+\s+(.*)$/;

/**
 * 从选中的提交记录中提取昆仑单号和说明内容，作为 version.json 弹窗的默认值。
 * - 昆仑单号：所有提交提取到的单号一致时返回该单号，不一致或未提取到时返回空字符串
 * - 说明内容：所有提交中操作名后面的文案去重后用逗号拼接
 * @param {Array} commits 选中的提交对象列表
 * @returns {{ issue: string, desc: string }}
 */
export const extractIssueAndDesc = (commits) => {
  const issues = new Set();
  const descs = [];

  for (const commit of commits || []) {
    const commitMessage = commit?.message || '';

    const issueMatch = commitMessage.match(ISSUE_PATTERN);
    if (issueMatch) {
      issues.add(issueMatch[1]);
    }

    // 说明内容单独匹配：提交信息只有单号没有说明时，不影响上面的单号提取
    const descMatch = commitMessage.match(ISSUE_DESC_PATTERN);
    const desc = descMatch?.[1]?.trim();
    if (desc && !descs.includes(desc)) {
      descs.push(desc);
    }
  }

  const issue = issues.size === 1 ? Array.from(issues)[0] : '';
  console.log(`[extractIssueAndDesc] 提取到单号: ${issue || '（不一致或无）'}，说明 ${descs.length} 条`);
  return { issue, desc: descs.join('，') };
};

/**
 * 生成 relations 记录的 date 字段（当前系统日期，格式 YYYY-MM-DD）
 */
export const formatRelationDate = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

/**
 * 缺少 version.json 且无法从 deploy.xml / package.json 自动获取模块名时，
 * 弹窗让用户手动输入模块名。取消返回 null。
 * @param {string} branchName 当前正在处理的合并分支名（用于文案提示）
 * @returns {Promise<string|null>}
 */
export const showModuleNameDialog = async (branchName) => {
  return await new Promise((resolve) => {
    let inputValue = '';

    const { destroy } = Modal.confirm({
      title: '缺少 version.json',
      width: 560,
      bodyStyle: { padding: '20px 24px' },
      content: (
        <div>
          <p>
            分支 <strong style={{ color: '#4F46E5' }}>{branchName}</strong> 的根目录下没有 version.json，
            且无法从 deploy.xml 或 package.json 中读取到模块名。
          </p>
          <p>请手动输入模块名（将写入新建 version.json 的 moduleName 字段）：</p>
          <Input
            placeholder="例如: AI应用对接基座"
            onChange={(e) => { inputValue = e.target.value; }}
          />
        </div>
      ),
      footer: (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Button onClick={() => { destroy(); resolve(null); }}>
            跳过写入
          </Button>
          <Button type="primary" onClick={() => {
            const name = inputValue.trim();
            if (!name) {
              message.error('请输入模块名');
              return;
            }
            destroy();
            resolve(name);
          }}>
            确认
          </Button>
        </div>
      ),
      closable: false,
      maskClosable: false
    });
  });
};

/**
 * 在当前合并分支上写入 version.json 的 relations 记录，并 squash 进最后一个遴选提交。
 * 任意失败均不阻断主流程，仅提示。
 * @param {Object} args
 * @param {Object} args.versionJsonData 弹窗收集的数据 { issue, desc, modules }
 * @param {string} args.branchName 当前合并分支名
 * @param {string} args.beforePickSha 遴选前 HEAD sha（squash 基点）
 * @param {Function} [args.setProgress] 进度文案更新回调 (statusText) => void
 * @returns {Promise<{ success: boolean, skipped?: string, error?: string }>}
 */
export const applyVersionJsonAndSquash = async ({ versionJsonData, branchName, beforePickSha, setProgress }) => {
  const logTag = `[applyVersionJsonAndSquash:${branchName}]`;
  try {
    if (setProgress) setProgress(`更新 version.json: ${branchName}`);

    const payload = {
      issue: versionJsonData.issue,
      date: formatRelationDate(),
      relationModules: versionJsonData.modules,
      desc: versionJsonData.desc
    };

    let result = await window.electronAPI.versionJson.appendRelation(payload);

    // version.json 不存在且无法自动获取模块名 → 询问用户后重试一次
    if (!result.success && result.needModuleName) {
      const moduleName = await showModuleNameDialog(branchName);
      if (!moduleName) {
        console.warn(`${logTag} 用户跳过 version.json 写入`);
        message.warning(`${branchName}: 已跳过 version.json 写入`);
        return { success: false, skipped: 'user-skipped' };
      }
      result = await window.electronAPI.versionJson.appendRelation({ ...payload, moduleName });
    }

    if (!result.success) {
      console.error(`${logTag} 写入失败: ${result.error}`);
      message.warning(`${branchName}: version.json 写入失败，将推送不含 version.json 的内容（${result.error}）`);
      return { success: false, error: result.error };
    }

    console.log(`${logTag} version.json 写入成功${result.created ? '（新建文件）' : ''}`);

    // 合并进最后一个遴选提交，不产生额外提交
    const sq = await window.electronAPI.git.squashIntoParent({ beforePickSha });
    if (!sq.success) {
      console.warn(`${logTag} squash 失败: ${sq.error}`);
      message.warning(`${branchName}: version.json 已更新，但合并进遴选提交失败（已回退）: ${sq.error}`);
      return { success: false, error: sq.error };
    }

    console.log(`${logTag} version.json 已合并进最后一个遴选提交`);
    return { success: true };
  } catch (error) {
    console.error(`${logTag} 异常: ${error.message}`);
    message.warning(`${branchName}: version.json 处理异常: ${error.message}`);
    return { success: false, error: error.message };
  }
};

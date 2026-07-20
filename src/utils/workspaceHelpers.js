import React from 'react';
import { Modal, Button, Input, message } from 'antd';
import { CodeOutlined, BranchesOutlined } from '@ant-design/icons';

// 生成随机分支名后缀（a-z, 0-9）
export const generateRandomBranchSuffix = (length = 8) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
};

// 跳过/终止对话框（cherry-pick 失败时使用）
export const showSkipAbortDialog = async (title, content) => {
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
};

// 远程分支冲突时的五选项对话框
export const showMergeBranchConflictDialog = async (branchName, conflictInfo) => {
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
};

// 合规邮箱域名
const COMPLIANT_EMAIL_DOMAIN = '@landray.com.cn';

// 校验提交的 author 邮箱是否合规，返回 { valid: commit[], invalid: commit[] }
export const validateAuthorEmails = (commits) => {
  const valid = [];
  const invalid = [];
  for (const commit of commits) {
    if (commit.author_email?.endsWith(COMPLIANT_EMAIL_DOMAIN)) {
      valid.push(commit);
    } else {
      invalid.push(commit);
    }
  }
  return { valid, invalid };
};

// author 邮箱不合规弹窗：展示不合规提交清单，让用户输入统一替换邮箱
// 返回用户确认的邮箱字符串，取消返回 null
export const showAuthorEmailDialog = async (invalidCommits, defaultEmail = '') => {
  return await new Promise((resolve) => {
    let inputValue = defaultEmail;

    const { destroy } = Modal.confirm({
      title: '检测到不合规的提交作者邮箱',
      width: 700,
      bodyStyle: { padding: '20px 24px' },
      content: (
        <div>
          <p>以下 {invalidCommits.length} 个提交的 author 邮箱不属于 {COMPLIANT_EMAIL_DOMAIN} 域，遴选后将替换为下方输入的邮箱（作者姓名保留不变）：</p>
          <div style={{
            maxHeight: 200,
            overflowY: 'auto',
            border: '1px solid #d9d9d9',
            borderRadius: 4,
            padding: 8,
            backgroundColor: '#fafafa',
            marginBottom: 16
          }}>
            {invalidCommits.slice(0, 10).map((commit) => (
              <div key={commit.hash} style={{ fontSize: 12, marginBottom: 6 }}>
                <strong>{commit.author_name}</strong> &lt;{commit.author_email || '无邮箱'}&gt;
                <span style={{ color: '#999', marginLeft: 8 }}>{commit.hash.substring(0, 8)}</span>
                <div style={{ color: '#666' }}>{commit.message?.substring(0, 50)}</div>
              </div>
            ))}
            {invalidCommits.length > 10 && (
              <div style={{ fontSize: 12, color: '#666' }}>
                ... 还有 {invalidCommits.length - 10} 个提交
              </div>
            )}
          </div>
          <div style={{ marginBottom: 8 }}>请输入替换邮箱（须以 {COMPLIANT_EMAIL_DOMAIN} 结尾）：</div>
          <Input
            placeholder={`例如: zhangsan${COMPLIANT_EMAIL_DOMAIN}`}
            defaultValue={defaultEmail}
            onChange={(e) => { inputValue = e.target.value; }}
          />
        </div>
      ),
      footer: (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Button onClick={() => { destroy(); resolve(null); }}>
            取消操作
          </Button>
          <Button type="primary" onClick={() => {
            const email = inputValue.trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !email.endsWith(COMPLIANT_EMAIL_DOMAIN)) {
              message.error(`请输入合法的 ${COMPLIANT_EMAIL_DOMAIN} 邮箱`);
              return;
            }
            destroy();
            resolve(email);
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

// 校验选中提交的 author 邮箱合规性，不合规时弹窗获取替换邮箱并处理默认值保存
// 返回 { proceed, invalidAuthorMap, replacementEmail }：
//   proceed=false 表示用户取消，应终止整个操作
//   invalidAuthorMap 为 hash -> 原作者名 的 Map（全部合规时为 null）
export const ensureAuthorEmailCompliance = async ({ commits, settings, setSettings }) => {
  const { invalid } = validateAuthorEmails(commits);
  if (invalid.length === 0) {
    return { proceed: true, invalidAuthorMap: null, replacementEmail: null };
  }

  const savedDefault = settings.authorReplaceEmail || '';
  const replacementEmail = await showAuthorEmailDialog(invalid, savedDefault);
  if (replacementEmail === null) {
    return { proceed: false, invalidAuthorMap: null, replacementEmail: null };
  }

  // 与配置默认值不一致时，询问是否保存为默认值
  if (replacementEmail !== savedDefault) {
    const shouldSave = await new Promise((resolve) => {
      Modal.confirm({
        title: '保存默认替换邮箱',
        content: `是否将 ${replacementEmail} 保存为默认替换邮箱？下次校验时将作为输入框默认值。`,
        okText: '保存',
        cancelText: '不保存',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (shouldSave) {
      const newSettings = { ...settings, authorReplaceEmail: replacementEmail };
      await window.electronAPI.settings.save(newSettings);
      setSettings?.(newSettings);
      message.success('默认替换邮箱已保存');
    }
  }

  const invalidAuthorMap = new Map(invalid.map(c => [c.hash, c.author_name]));
  return { proceed: true, invalidAuthorMap, replacementEmail };
};

// 根据合并类型获取目标分支列表
export const getTargetBranches = (mergeType, settings, customBranchInputs) => {
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
export const validateCustomBranches = async (branchNames) => {
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

// 从提交记录中提取问题单号
export const extractIssueNumber = (commits) => {
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
export const generateBranchName = (targetBranch, issueNumber, username) => {
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

// 根据合并类型获取操作按钮
export const getActionButtons = ({ mergeType, loading, handleCherryPickAndPush, handleCreateMergeBranch }) => {
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

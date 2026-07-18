import React from 'react';
import { Modal, Button } from 'antd';
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

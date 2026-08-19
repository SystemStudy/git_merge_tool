/**
 * 提交列表相关组件
 * 从 MainWorkspace.js 中抽取
 */
import React, { memo, useCallback } from 'react';
import { Checkbox, Tooltip } from 'antd';
import { formatCommitDate } from '../utils/mergeUtils';

// 合并类型配置
export const MERGE_TYPES = [
  { value: 'bug', label: 'bugfix' },
  { value: 'test', label: '需求提测' },
  { value: 'release', label: '入库' },
  { value: 'custom', label: '指定分支合并' },
  { value: 'crossRepo', label: '跨仓库合并' }
];

// 优化版提交项 - 使用 memo 避免直接导致重新渲染
export const CommitItem = memo(({ commit, isSelected, onToggle }) => {
  // 直接绑定 onClick，确保每次都能响应
  const handleClick = useCallback(() => {
    if (onToggle && commit.hash) {
      onToggle(commit.hash);
    }
  }, [commit.hash, onToggle]);

  const backgroundColor = isSelected ? '#eef2ff' : 'transparent';

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
          color: isSelected ? '#4F46E5' : '#666'
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

// 虚拟列表渲染行
export const CommitRow = ({ index, style, data }) => {
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
        backgroundColor: isSelected ? '#eef2ff' : 'transparent'
      }}
      onClick={handleClick}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = '#f5f5f5';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = isSelected ? '#eef2ff' : 'transparent';
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

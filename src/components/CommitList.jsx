/**
 * 提交列表相关组件
 * 从 MainWorkspace.js 中抽取
 */
import React, { memo, useCallback } from 'react';
import { Checkbox, Tooltip } from 'antd';
import { formatCommitDate } from '../utils/mergeUtils';

// 合并类型配置
export const MERGE_TYPES = [
  { value: 'bug', label: 'Bug提测' },
  { value: 'test', label: '提测' },
  { value: 'release', label: '入库' },
  { value: 'custom', label: '指定分支合并' }
];

// 根据 commit message 前缀返回类型色点
const getCommitTypeColor = (message) => {
  if (!message) return '#9CA3AF';
  const prefix = message.split(':')[0].trim().toLowerCase();
  if (prefix.startsWith('feat')) return '#4F6EF7';
  if (prefix.startsWith('fix')) return '#FF3B30';
  if (prefix.startsWith('refactor')) return '#FF9F0A';
  if (prefix.startsWith('docs')) return '#34C759';
  if (prefix.startsWith('test')) return '#AF52DE';
  if (prefix.startsWith('chore') || prefix.startsWith('build') || prefix.startsWith('ci')) return '#9CA3AF';
  return '#9CA3AF';
};

// 优化版提交项 - 使用 memo 避免直接导致重新渲染
export const CommitItem = memo(({ commit, isSelected, onToggle }) => {
  const handleClick = useCallback(() => {
    if (onToggle && commit.hash) {
      onToggle(commit.hash);
    }
  }, [commit.hash, onToggle]);

  const typeColor = getCommitTypeColor(commit.message);

  return (
    <div
      className={`commit-item ${isSelected ? 'selected' : ''}`}
      onClick={handleClick}
    >
      <Checkbox
        checked={isSelected}
        style={{ marginRight: '12px' }}
        onChange={handleClick}
      />
      {/* 类型色点 */}
      <span style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: typeColor,
        marginRight: 12,
        flexShrink: 0,
      }} />
      <Tooltip title={commit.hash}>
        <code className="commit-hash" style={{ marginRight: '20px' }}>
          {commit.hash?.substring(0, 8)}
        </code>
      </Tooltip>
      <span style={{
        width: '110px',
        marginRight: '16px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontWeight: isSelected ? '600' : '400',
        color: isSelected ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        fontSize: '13px',
      }}>
        {commit.author_name || '-'}
      </span>
      <span style={{
        width: '130px',
        marginRight: '16px',
        color: 'var(--color-text-tertiary)',
        fontSize: '12px',
        fontFamily: 'var(--font-mono)',
      }}>
        {formatCommitDate(commit.date)}
      </span>
      <span style={{
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: isSelected ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        fontSize: '13px',
        fontWeight: isSelected ? 500 : 400,
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

  const typeColor = getCommitTypeColor(commit.message);

  return (
    <div
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        padding: '10px 16px',
        borderBottom: '1px solid var(--color-border-light)',
        cursor: 'pointer',
        userSelect: 'none',
        backgroundColor: isSelected ? 'var(--color-bg-selected)' : 'transparent',
        position: 'relative',
      }}
      onClick={handleClick}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = isSelected ? 'var(--color-bg-selected)' : 'transparent';
      }}
    >
      <Checkbox
        checked={isSelected}
        style={{ marginRight: '12px', pointerEvents: 'none' }}
      />
      <span style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: typeColor,
        marginRight: 12,
        flexShrink: 0,
      }} />
      <Tooltip title={commit.hash}>
        <code style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          backgroundColor: 'var(--color-bg-app)',
          padding: '2px 8px',
          borderRadius: '4px',
          color: 'var(--color-text-secondary)',
          letterSpacing: '0.5px',
          marginRight: 20,
        }}>
          {commit.hash?.substring(0, 8) || '-'}
        </code>
      </Tooltip>
      <span style={{
        width: '110px',
        marginRight: '16px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: 'var(--color-text-secondary)',
        fontSize: '13px',
      }}>
        {commit.author_name || '-'}
      </span>
      <span style={{
        width: '130px',
        marginRight: '16px',
        color: 'var(--color-text-tertiary)',
        fontSize: '12px',
        fontFamily: 'var(--font-mono)',
      }}>
        {formatCommitDate(commit.date)}
      </span>
      <span style={{
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: 'var(--color-text-secondary)',
        fontSize: '13px',
      }}>
        {commit.message || '-'}
      </span>
    </div>
  );
};

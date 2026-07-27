/**
 * 提交列表面板组件 - 从 MainWorkspace.js 中抽取
 * 包含搜索栏、过滤按钮、虚拟列表渲染、加载更多
 */
import React from 'react';
import {
  Input,
  Button,
  Space,
  Spin,
} from 'antd';
import {
  SearchOutlined,
  UserOutlined,
  ClearOutlined,
  ReloadOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { CommitItem } from './CommitList';

const { Search } = Input;

const CommitListPanel = ({
  searchText,
  setSearchText,
  showMyCommits,
  setShowMyCommits,
  loading,
  loadingMore,
  hasMoreCommits,
  filteredCommits,
  selectedCommitsSet,
  toggleCommitSelection,
  handleRefresh,
  loadMoreCommits,
  commitsListRef,
  onClearSelection,
}) => {
  return (
    <div className="commits-section">
      <div className="commits-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Search
            placeholder="搜索提交..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 300 }}
            prefix={<SearchOutlined />}
          />
          {selectedCommitsSet.size > 0 && (
            <span style={{ fontSize: '13px', color: '#4F46E5', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              已选中 {selectedCommitsSet.size} 条记录
              <CloseCircleOutlined
                style={{ cursor: 'pointer', fontSize: '14px', color: '#999' }}
                onClick={() => onClearSelection?.()}
                title="取消全部选中"
              />
            </span>
          )}
        </div>
        <Space>
          <Button 
            icon={<UserOutlined />}
            type={showMyCommits ? 'primary' : 'default'}
            onClick={() => setShowMyCommits(!showMyCommits)}
          >
            我的提交
          </Button>
          <Button
            icon={<ClearOutlined />}
            onClick={() => {
              setSearchText('');
              setShowMyCommits(false);
            }}
          >
            清空
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleRefresh}
          >
            刷新
          </Button>
        </Space>
      </div>

      <div 
        ref={commitsListRef}
        className="commits-list"
        style={{ 
          height: 'calc(100vh - 320px)', 
          overflowY: 'auto',
          overflowX: 'hidden'
        }}
        onScroll={(e) => {
          const { scrollTop, scrollHeight, clientHeight } = e.target;
          
          // 优化：滚动到距离底部200px时加载更多
          if (scrollTop + clientHeight >= scrollHeight - 200 && !loadingMore && hasMoreCommits) {
            loadMoreCommits();
          }
        }}
      >
        {loading && filteredCommits.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <Spin tip="正在加载提交记录..." />
          </div>
        )}
        
        {filteredCommits.length === 0 && !loading && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
            暂无提交记录
          </div>
        )}
        
        {filteredCommits.length > 0 && (
          filteredCommits.map((commit) => (
            <CommitItem
              key={commit.hash}
              commit={commit}
              isSelected={selectedCommitsSet.has(commit.hash)}
              onToggle={toggleCommitSelection}
            />
          ))
        )}
        
        {loadingMore && (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <Spin size="small" tip="加载更多..." />
          </div>
        )}
        
        {!hasMoreCommits && filteredCommits.length > 0 && (
          <div style={{ textAlign: 'center', padding: '20px', color: '#999', fontSize: '12px' }}>
            已加载全部提交记录
          </div>
        )}
      </div>
    </div>
  );
};

export default CommitListPanel;

import React, { useState, useEffect } from 'react';
import { BranchesOutlined } from '@ant-design/icons';
import './CustomTitleBar.css';

/**
 * 自定义标题栏组件
 * 配合 Electron 的 frame: false 使用，
 * 完全自建的最小化/最大化/关闭按钮，颜色与页面风格统一。
 */
function CustomTitleBar({ projectName }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    // 初始获取最大化状态
    const checkMaximized = async () => {
      if (window.electronAPI?.window) {
        const isMax = await window.electronAPI.window.isMaximized();
        setMaximized(isMax);
      }
    };
    checkMaximized();

    // 窗口大小变化时更新状态
    const handleResize = () => checkMaximized();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleMinimize = () => {
    window.electronAPI?.window?.minimize();
  };

  const handleToggleMaximize = () => {
    window.electronAPI?.window?.toggleMaximize();
    setMaximized(prev => !prev);
  };

  const handleClose = () => {
    window.electronAPI?.window?.close();
  };

  return (
    <div className="custom-titlebar">
      <div className="titlebar-title">
        <BranchesOutlined />
        <span>Git合并辅助</span>
      </div>
      {projectName && (
        <div className="titlebar-project">{projectName}</div>
      )}
      <div className="titlebar-spacer" />
      <div className="titlebar-controls">
        <button className="titlebar-btn" onClick={handleMinimize} title="最小化">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect y="5.5" width="12" height="1" fill="currentColor" />
          </svg>
        </button>
        <button className="titlebar-btn" onClick={handleToggleMaximize} title={maximized ? '还原' : '最大化'}>
          {maximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="2" y="0" width="9" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
              <rect x="0" y="3" width="9" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="0.5" y="0.5" width="11" height="11" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>
        <button className="titlebar-btn titlebar-btn-close" onClick={handleClose} title="关闭">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" strokeWidth="1.2" />
            <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default CustomTitleBar;

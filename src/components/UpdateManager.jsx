/**
 * 应用自动更新管理组件（挂载于 App 顶层，全局生效）
 *
 * 监听主进程推送的 update:status 事件，按状态机驱动弹窗：
 * - available   → 提示发现新版本，用户确认后开始下载
 * - downloading → 显示下载进度
 * - downloaded  → 提示立即重启安装
 * - not-available / error → 仅手动检查来源需要提示（主进程已过滤静默检查的结果）
 */
import React, { useState, useEffect } from 'react';
import { Button, Modal, Progress, Spin, message } from 'antd';
import { CloudDownloadOutlined, ReloadOutlined } from '@ant-design/icons';

const UpdateManager = () => {
  // visible: 弹窗是否显示; mode: checking | available | downloading | downloaded
  const [visible, setVisible] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [mode, setMode] = useState('idle');
  const [versionInfo, setVersionInfo] = useState(null);
  const [progress, setProgress] = useState({ percent: 0, transferred: 0, total: 0 });

  useEffect(() => {
    if (!window.electronAPI) return undefined;

    const handleUpdateStatus = (payload) => {
      if (!payload || !payload.status) return;
      switch (payload.status) {
        case 'checking':
          // 静默检查不展示“正在检查更新”弹窗，只有手动检查才展示
          if (payload.silent) break;
          setMinimized(false);
          setMode('checking');
          setVisible(true);
          break;
        case 'available':
          setVersionInfo(payload);
          setMinimized(false);
          setMode('available');
          setVisible(true);
          break;
        case 'downloading':
          setMode('downloading');
          setProgress({
            percent: payload.percent || 0,
            transferred: payload.transferred || 0,
            total: payload.total || 0,
          });
          break;
        case 'downloaded':
          setMinimized(false);
          setMode('downloaded');
          setVisible(true);
          break;
        case 'cancelled':
          setVisible(false);
          setMinimized(false);
          setMode('idle');
          message.info('已取消更新');
          break;
        case 'not-available':
          // 仅手动检查会推送该状态（静默检查无更新时主进程不推送）
          setVisible(false);
          setMinimized(false);
          setMode('idle');
          message.success('当前已是最新版本');
          break;
        case 'error':
          // 仅手动检查会推送错误（静默检查网络不可达时不打扰用户）
          setVisible(false);
          setMinimized(false);
          setMode('idle');
          message.error('无法访问更新服务器，请检查网络后重试');
          break;
        default:
          break;
      }
    };

    window.electronAPI.on('update:status', handleUpdateStatus);
    return () => window.electronAPI.removeAllListeners('update:status');
  }, []);

  const handleDownload = async () => {
    setMinimized(false);
    setMode('downloading');
    setVisible(true);
    try {
      const result = await window.electronAPI.update.download();
      if (result && result.cancelled) {
        return;
      }
      if (result && result.success === false) {
        message.error('下载更新失败: ' + (result.error || '未知错误'));
        setVisible(false);
        setMinimized(false);
        setMode('idle');
      }
    } catch (error) {
      message.error('下载更新失败: ' + (error.message || error));
      setVisible(false);
      setMinimized(false);
      setMode('idle');
    }
  };

  const handleCancelDownload = async () => {
    try {
      await window.electronAPI.update.cancelDownload();
    } catch (error) {
      message.error('取消下载失败: ' + (error.message || error));
    } finally {
      setVisible(false);
      setMinimized(false);
      setMode('idle');
    }
  };

  const handleMinimizeDownload = () => {
    setMinimized(true);
    setVisible(false);
  };

  const handleRestoreDownload = () => {
    setMinimized(false);
    setVisible(true);
  };

  const handleInstall = () => {
    window.electronAPI.update.install();
  };

  // 格式化下载字节数（MB）
  const formatMB = (bytes) => (bytes / 1024 / 1024).toFixed(1) + ' MB';

  // checking：正在检查更新
  if (mode === 'checking') {
    return (
      <Modal
        title="正在检查更新"
        open={visible}
        footer={null}
        closable={false}
        maskClosable={false}
        width={440}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Spin />
          <span>正在检查更新，请稍候...</span>
        </div>
      </Modal>
    );
  }

  // available：确认下载
  if (mode === 'available') {
    return (
      <Modal
        title="发现新版本"
        open={visible}
        onOk={handleDownload}
        onCancel={() => setVisible(false)}
        okText="立即下载"
        cancelText="忽略"
        width={440}
        icon={null}
        maskClosable={false}
      >
        <p>
          发现新版本 <b>v{versionInfo?.version}</b>
          {versionInfo?.channel === 'beta' ? '（测试版通道）' : '（正式版通道）'}
          ，当前版本 v{versionInfo?.currentVersion}。
        </p>
        {versionInfo?.releaseNotes && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 4, fontWeight: 600 }}>更新说明</div>
            <div
              style={{
                padding: 12,
                background: '#f5f5f5',
                borderRadius: 6,
                maxHeight: 200,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                fontSize: 13,
                color: '#555',
              }}
            >
              {versionInfo.releaseNotes}
            </div>
          </div>
        )}
        <p>是否立即下载更新？</p>
      </Modal>
    );
  }

  // downloaded：重启安装
  if (mode === 'downloaded') {
    return (
      <Modal
        title="更新已就绪"
        open={visible}
        onOk={handleInstall}
        onCancel={() => setVisible(false)}
        okText="立即重启安装"
        cancelText="稍后"
        width={440}
        icon={null}
        maskClosable={false}
      >
        <p>
          新版本 <b>v{versionInfo?.version}</b> 已下载完成，重启应用后将自动完成安装。
        </p>
      </Modal>
    );
  }

  // downloading 且已最小化：右上角悬浮进度条
  if (mode === 'downloading' && minimized) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 1000,
          width: 250,
          background: '#fff',
          borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          padding: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>正在下载更新</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <Button size="small" type="text" onClick={handleRestoreDownload}>展开</Button>
            <Button size="small" type="text" danger onClick={handleCancelDownload}>取消</Button>
          </div>
        </div>
        <Progress
          percent={Math.round(progress.percent)}
          status="active"
          icon={<CloudDownloadOutlined />}
        />
        <div style={{ marginTop: 6, fontSize: 12, color: '#666' }}>
          已下载 {formatMB(progress.transferred)} / {formatMB(progress.total)}
        </div>
      </div>
    );
  }

  // downloading：下载进度
  return (
    <Modal
      title="正在下载更新"
      open={visible}
      onCancel={handleMinimizeDownload}
      footer={[
        <Button key="cancel" danger onClick={handleCancelDownload}>
          取消下载
        </Button>,
        <Button key="minimize" type="primary" onClick={handleMinimizeDownload}>
          最小化
        </Button>,
      ]}
      closable={false}
      maskClosable={true}
      width={440}
    >
      <Progress
        percent={Math.round(progress.percent)}
        status="active"
        icon={<CloudDownloadOutlined />}
      />
      <p style={{ marginTop: 12, color: '#666', fontSize: 13 }}>
        已下载 {formatMB(progress.transferred)} / {formatMB(progress.total)}
      </p>
      <p style={{ marginBottom: 0, color: '#999', fontSize: 12 }}>
        点击弹窗外区域可最小化到右上角，下载完成后请勿关闭应用 <ReloadOutlined />
      </p>
    </Modal>
  );
};

export default UpdateManager;

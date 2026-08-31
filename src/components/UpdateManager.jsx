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
import { Modal, Progress, message } from 'antd';
import { CloudDownloadOutlined, ReloadOutlined } from '@ant-design/icons';

const UpdateManager = () => {
  // visible: 弹窗是否显示; mode: available | downloading | downloaded
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState('available');
  const [versionInfo, setVersionInfo] = useState(null);
  const [progress, setProgress] = useState({ percent: 0, transferred: 0, total: 0 });

  useEffect(() => {
    if (!window.electronAPI) return undefined;

    const handleUpdateStatus = (payload) => {
      if (!payload || !payload.status) return;
      switch (payload.status) {
        case 'available':
          setVersionInfo(payload);
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
          setMode('downloaded');
          break;
        case 'not-available':
          // 仅手动检查会推送该状态（静默检查无更新时主进程不推送）
          message.success('当前已是最新版本');
          break;
        case 'error':
          // 仅手动检查会推送错误（静默检查网络不可达时不打扰用户）
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
    try {
      await window.electronAPI.update.download();
    } catch (error) {
      message.error('下载更新失败: ' + (error.message || error));
      setVisible(false);
    }
  };

  const handleInstall = () => {
    window.electronAPI.update.install();
  };

  // 格式化下载字节数（MB）
  const formatMB = (bytes) => (bytes / 1024 / 1024).toFixed(1) + ' MB';

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

  // downloading：下载进度
  return (
    <Modal
      title="正在下载更新"
      open={visible}
      footer={null}
      closable={false}
      maskClosable={false}
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
        下载完成后请勿关闭应用，将提示重启安装 <ReloadOutlined />
      </p>
    </Modal>
  );
};

export default UpdateManager;

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Input, Space, Popconfirm, message, Empty } from 'antd';
import { PlusOutlined, DeleteOutlined, ApiOutlined, ClearOutlined, EditOutlined } from '@ant-design/icons';

const RemoteReposManager = () => {
  const [repos, setRepos] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newRepo, setNewRepo] = useState({ name: '', url: '' });
  const [testingId, setTestingId] = useState(null);
  const [clearing, setClearing] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', url: '' });

  const loadRepos = useCallback(async () => {
    try {
      const list = await window.electronAPI.remoteRepos.list();
      setRepos(list);
    } catch (error) {
      console.error('加载远程仓库列表失败:', error);
    }
  }, []);

  useEffect(() => {
    loadRepos();
  }, [loadRepos]);

  const saveRepos = async (newList) => {
    setRepos(newList);
    await window.electronAPI.remoteRepos.save(newList);
  };

  const handleAdd = async () => {
    if (!newRepo.name.trim() || !newRepo.url.trim()) {
      message.warning('请填写仓库名称和地址');
      return;
    }
    const repo = {
      id: `repo-${Date.now()}`,
      name: newRepo.name.trim(),
      url: newRepo.url.trim()
    };
    await saveRepos([...repos, repo]);
    setNewRepo({ name: '', url: '' });
    setAdding(false);
    message.success('仓库已添加');
  };

  const handleRemove = async (id) => {
    await saveRepos(repos.filter(r => r.id !== id));
    message.success('仓库已删除');
  };

  const handleEdit = (repo) => {
    setEditingId(repo.id);
    setEditForm({ name: repo.name, url: repo.url });
  };

  const handleEditSave = async (id) => {
    if (!editForm.name.trim() || !editForm.url.trim()) {
      message.warning('请填写仓库名称和地址');
      return;
    }
    const updated = repos.map(r =>
      r.id === id ? { ...r, name: editForm.name.trim(), url: editForm.url.trim() } : r
    );
    await saveRepos(updated);
    setEditingId(null);
    setEditForm({ name: '', url: '' });
    message.success('仓库已更新');
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditForm({ name: '', url: '' });
  };

  const handleTest = async (repo) => {
    setTestingId(repo.id);
    try {
      const result = await window.electronAPI.remoteRepos.testConnection({ url: repo.url });
      if (result.success) {
        message.success(`${repo.name}: 连接成功，发现 ${result.branchCount} 个远程分支`);
      } else {
        message.error(`${repo.name}: 连接失败 - ${result.error}`);
      }
    } catch (error) {
      message.error(`测试失败: ${error.message}`);
    } finally {
      setTestingId(null);
    }
  };

  const handleClearCache = async () => {
    setClearing(true);
    try {
      const result = await window.electronAPI.remoteRepos.clearCache();
      if (result.success) {
        message.success('缓存已清理');
      } else {
        message.error(`清理失败: ${result.error}`);
      }
    } catch (error) {
      message.error(`清理失败: ${error.message}`);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div>
      <div className="repos-manager-header">
        <span className="repos-manager-header-label">外部仓库列表</span>
        <Space>
          <Popconfirm title="确定清理所有仓库缓存？" onConfirm={handleClearCache} okText="确定" cancelText="取消">
            <Button size="small" icon={<ClearOutlined />} loading={clearing}>清理缓存</Button>
          </Popconfirm>
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>添加仓库</Button>
        </Space>
      </div>

      {repos.length === 0 && !adding && (
        <Empty description={'暂无外部仓库，点击"添加仓库"按钮配置'} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}

      <div className="repo-list">
        {repos.map((repo) => (
          <div
            key={repo.id}
            className="repo-item"
          >
            {editingId === repo.id ? (
              <>
                <Input
                  size="small"
                  style={{ width: 120, flexShrink: 0 }}
                  value={editForm.name}
                  onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="仓库名称"
                />
                <Input
                  size="small"
                  style={{ flex: 1, minWidth: 0 }}
                  value={editForm.url}
                  onChange={e => setEditForm(prev => ({ ...prev, url: e.target.value }))}
                  placeholder="远程地址"
                />
                <Button size="small" type="primary" onClick={() => handleEditSave(repo.id)}>保存</Button>
                <Button size="small" onClick={handleEditCancel}>取消</Button>
              </>
            ) : (
              <>
                <div className="repo-item-dot" />
                <span className="repo-item-name">{repo.name}</span>
                <span className="repo-item-url">{repo.url}</span>
                <div className="repo-item-actions">
                  <Button size="small" icon={<ApiOutlined />} loading={testingId === repo.id} onClick={() => handleTest(repo)}>测试</Button>
                  <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(repo)}>编辑</Button>
                  <Popconfirm title="确定删除此仓库？" onConfirm={() => handleRemove(repo.id)} okText="确定" cancelText="取消">
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {adding && (
        <div className="repo-add-form">
          <div style={{ marginBottom: 12 }}>
            <Input
              placeholder="仓库别名（如：前端模块A）"
              value={newRepo.name}
              onChange={e => setNewRepo(prev => ({ ...prev, name: e.target.value }))}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <Input
              placeholder="远程地址（如：git@gitlab.com:group/repo.git）"
              value={newRepo.url}
              onChange={e => setNewRepo(prev => ({ ...prev, url: e.target.value }))}
            />
          </div>
          <Space>
            <Button type="primary" size="small" onClick={handleAdd}>确认添加</Button>
            <Button size="small" onClick={() => { setAdding(false); setNewRepo({ name: '', url: '' }); }}>取消</Button>
          </Space>
        </div>
      )}
    </div>
  );
};

export default RemoteReposManager;

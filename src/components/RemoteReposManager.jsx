import React, { useState, useEffect, useCallback } from 'react';
import { Button, Input, Space, Popconfirm, message, Empty } from 'antd';
import { PlusOutlined, DeleteOutlined, ApiOutlined, EditOutlined } from '@ant-design/icons';

const RemoteReposManager = () => {
  const [repos, setRepos] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newRepo, setNewRepo] = useState({ name: '', url: '' });
  const [testingId, setTestingId] = useState(null);
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

  const handleAdd = async () => {
    if (!newRepo.name.trim() || !newRepo.url.trim()) {
      message.warning('请填写仓库名称和地址');
      return;
    }
    const result = await window.electronAPI.remoteRepos.add({
      name: newRepo.name.trim(),
      url: newRepo.url.trim()
    });
    if (!result.success) {
      message.error('添加失败: ' + (result.error || '未知错误'));
      return;
    }
    await loadRepos();
    setNewRepo({ name: '', url: '' });
    setAdding(false);
    message.success('仓库已添加');
  };

  const handleRemove = async (id) => {
    const result = await window.electronAPI.remoteRepos.remove({ name: id });
    if (!result.success) {
      message.error('删除失败: ' + (result.error || '未知错误'));
      return;
    }
    await loadRepos();
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
    const result = await window.electronAPI.remoteRepos.update({
      oldName: id,
      name: editForm.name.trim(),
      url: editForm.url.trim()
    });
    if (!result.success) {
      message.error('更新失败: ' + (result.error || '未知错误'));
      return;
    }
    await loadRepos();
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

  return (
    <div>
      <div className="repos-manager-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Space>
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>添加仓库</Button>
        </Space>
      </div>

      {repos.length === 0 && !adding && (
        <Empty description={'暂无外部仓库，点击"添加仓库"按钮配置'} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}

      <div className="repo-list" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {repos.map((repo) => (
          <div
            key={repo.id}
            className="repo-item"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              background: '#fafafa',
              border: '1px solid #e8e8e8',
              borderRadius: '8px',
              transition: 'all 0.3s ease',
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = '#d9d9d9';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = '#e8e8e8';
              e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.03)';
            }}
          >
            {editingId === repo.id ? (
              <div style={{ width: '100%' }}>
                <div style={{ marginBottom: 12 }}>
                  <Input
                    placeholder="仓库名称"
                    value={editForm.name}
                    onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                    style={{ borderRadius: '6px' }}
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <Input
                    placeholder="远程地址"
                    value={editForm.url}
                    onChange={e => setEditForm(prev => ({ ...prev, url: e.target.value }))}
                    style={{ borderRadius: '6px' }}
                  />
                </div>
                <Space>
                  <Button type="primary" size="small" onClick={() => handleEditSave(repo.id)} style={{ borderRadius: '6px' }}>保存</Button>
                  <Button size="small" onClick={handleEditCancel} style={{ borderRadius: '6px' }}>取消</Button>
                </Space>
              </div>
            ) : (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span
                    className="repo-item-name"
                    style={{
                      fontWeight: 600,
                      fontSize: '14px',
                      color: '#1890ff'
                    }}
                  >
                    {repo.name}
                  </span>
                  <div className="repo-item-actions" style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <Button size="small" icon={<ApiOutlined />} loading={testingId === repo.id} onClick={() => handleTest(repo)}>测试</Button>
                    <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(repo)}>编辑</Button>
                    <Popconfirm title="确定删除此仓库？" onConfirm={() => handleRemove(repo.id)} okText="确定" cancelText="取消">
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </div>
                </div>
                <span
                  className="repo-item-url"
                  style={{
                    color: '#8c8c8c',
                    fontSize: '13px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={repo.url}
                >
                  {repo.url}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {adding && (
        <div
          className="repo-add-form"
          style={{
            marginTop: 12,
            padding: '16px',
            background: '#f5f5f5',
            border: '1px dashed #d9d9d9',
            borderRadius: '8px'
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <Input
              placeholder="仓库别名（如：前端模块A）"
              value={newRepo.name}
              onChange={e => setNewRepo(prev => ({ ...prev, name: e.target.value }))}
              style={{ borderRadius: '6px' }}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <Input
              placeholder="远程地址（如：git@gitlab.com:group/repo.git）"
              value={newRepo.url}
              onChange={e => setNewRepo(prev => ({ ...prev, url: e.target.value }))}
              style={{ borderRadius: '6px' }}
            />
          </div>
          <Space>
            <Button type="primary" size="small" onClick={handleAdd} style={{ borderRadius: '6px' }}>确认添加</Button>
            <Button size="small" onClick={() => { setAdding(false); setNewRepo({ name: '', url: '' }); }} style={{ borderRadius: '6px' }}>取消</Button>
          </Space>
        </div>
      )}
    </div>
  );
};

export default RemoteReposManager;

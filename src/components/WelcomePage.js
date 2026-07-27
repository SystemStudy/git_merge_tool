import React, { useState, useEffect } from 'react';
import {
  Button,
  Typography,
  Space,
  Empty,
  Popconfirm,
  Tag,
  Spin,
  Drawer,
  Input,
  message
} from 'antd';
import {
  FolderOpenOutlined,
  HistoryOutlined,
  DeleteOutlined,
  SettingOutlined,
  BranchesOutlined,
  SearchOutlined
} from '@ant-design/icons';
import SettingsForm from './SettingsForm';
import './WelcomePage.css';

const { Title, Text } = Typography;

const WelcomePage = ({ onProjectSelect, loading, onThemeColorChange }) => {
  const [recentProjects, setRecentProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [settings, setSettings] = useState({});
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    loadRecentProjects();
    loadSettings();
  }, []);

  const loadRecentProjects = async () => {
    try {
      setProjectsLoading(true);
      const projects = await window.electronAPI.projects.getRecent();
      setRecentProjects(projects);
    } catch (error) {
      console.error('加载最近项目失败:', error);
    } finally {
      setProjectsLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const settings = await window.electronAPI.settings.get();
      setSettings(settings);
    } catch (error) {
      console.error('加载设置失败:', error);
    }
  };

  const handleSelectDirectory = async () => {
    try {
      const projectPath = await window.electronAPI.projects.selectDirectory();
      if (projectPath) {
        onProjectSelect(projectPath);
      }
    } catch (error) {
      console.error('选择目录失败:', error);
    }
  };

  const handleOpenProject = (projectPath) => {
    onProjectSelect(projectPath);
  };

  const handleRemoveProject = async (projectPath, e) => {
    e.stopPropagation();
    try {
      await window.electronAPI.projects.remove(projectPath);
      loadRecentProjects();
    } catch (error) {
      console.error('删除项目记录失败:', error);
    }
  };

  const handleSaveSettings = async (newSettings) => {
    try {
      await window.electronAPI.settings.save(newSettings);
      setSettings(newSettings);
      message.success('设置已保存');
      setSettingsVisible(false);
    } catch (error) {
      message.error('保存设置失败: ' + error.message);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN') + ' ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  const getParentPath = (fullPath) => {
    if (!fullPath) return '';
    const parts = fullPath.replace(/\\/g, '/').replace(/\/$/, '').split('/');
    if (parts.length <= 1) return fullPath;
    return parts[parts.length - 2];
  };

  const filteredProjects = recentProjects.filter((project) => {
    if (!searchText.trim()) return true;
    const keyword = searchText.trim().toLowerCase();
    return (
      project.name?.toLowerCase().includes(keyword) ||
      project.path?.toLowerCase().includes(keyword)
    );
  });

  return (
    <div className="welcome-page">
      <div className="welcome-content">
        <div className="welcome-header">
          <Title level={2} className="welcome-title">
            <BranchesOutlined /> Git合并辅助
          </Title>
          <Text type="secondary" className="welcome-subtitle">
            强大的Git分支合并辅助工具，简化您的Git操作流程
          </Text>
        </div>

        <div className="welcome-projects-section">
          <div className="welcome-projects-header">
            <Space>
              <HistoryOutlined />
              <span className="welcome-projects-title">最近打开的项目</span>
            </Space>
            <Input
              prefix={<SearchOutlined />}
              placeholder="搜索项目..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              allowClear
              style={{ width: 260 }}
            />
          </div>
          <Spin spinning={projectsLoading}>
            {filteredProjects.length > 0 ? (
              <div className="recent-projects-grid">
                {filteredProjects.map((project) => (
                  <div
                    key={project.path}
                    className="project-card"
                    onClick={() => handleOpenProject(project.path)}
                  >
                    <div className="project-card-header">
                      <span className="project-card-name">{project.name}</span>
                      <Tag color="blue">Git</Tag>
                    </div>
                    <Text type="secondary" className="project-card-path">
                      {getParentPath(project.path)}
                    </Text>
                    <div className="project-card-footer">
                      <Text type="secondary" className="project-card-time">
                        {formatDate(project.lastOpened)}
                      </Text>
                      <Popconfirm
                        title="删除记录"
                        description="确定要从记录中移除此项目吗？"
                        onConfirm={(e) => handleRemoveProject(project.path, e)}
                        okText="确定"
                        cancelText="取消"
                      >
                        <Button
                          type="text"
                          danger
                          size="small"
                          icon={<DeleteOutlined />}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </Popconfirm>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={searchText ? '未找到匹配的项目' : '暂无最近打开的项目'}
              />
            )}
          </Spin>
        </div>

        <div className="welcome-actions">
          <Button
            type="primary"
            size="large"
            icon={<FolderOpenOutlined />}
            onClick={handleSelectDirectory}
            loading={loading}
          >
            选择项目目录
          </Button>
          <Button
            size="large"
            icon={<SettingOutlined />}
            onClick={() => setSettingsVisible(true)}
          >
            应用设置
          </Button>
        </div>
      </div>

      {/* 设置抽屉 */}
      <Drawer
        title="应用设置"
        placement="right"
        width={600}
        open={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        rootStyle={{ top: 40 }}
      >
        <SettingsForm
          settings={settings}
          onSave={handleSaveSettings}
          onThemeColorChange={onThemeColorChange}
          onSettingsChange={setSettings}
        />
      </Drawer>
    </div>
  );
};

export default WelcomePage;

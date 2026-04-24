import React, { useState, useEffect } from 'react';
import {
  Card,
  Button,
  List,
  Typography,
  Space,
  Empty,
  Popconfirm,
  Tag,
  Spin,
  Drawer,
  Form,
  Input,
  Tabs,
  Alert,
  message
} from 'antd';
import {
  FolderOpenOutlined,
  HistoryOutlined,
  DeleteOutlined,
  SettingOutlined,
  BranchesOutlined,
  PullRequestOutlined,
  MergeOutlined,
  GithubOutlined
} from '@ant-design/icons';
import './WelcomePage.css';

const { Title, Text } = Typography;

const WelcomePage = ({ onProjectSelect, loading }) => {
  const [recentProjects, setRecentProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [settings, setSettings] = useState({});
  const [testResult, setTestResult] = useState(null);
  const [form] = Form.useForm();

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

  const handleTestToken = async () => {
    const values = form.getFieldsValue();
    if (!values.gitlabServerUrl || !values.gitlabAccessToken) {
      message.warning('请先填写GitLab地址和令牌');
      return;
    }

    try {
      const result = await window.electronAPI.gitlab.testToken(
        values.gitlabServerUrl,
        values.gitlabAccessToken
      );
      setTestResult(result);
      if (result.success) {
        message.success('令牌验证成功');
      } else {
        message.error(result.error);
      }
    } catch (error) {
      message.error('测试失败: ' + error.message);
    }
  };

  const handleSaveSettings = async (values) => {
    try {
      await window.electronAPI.settings.save(values);
      setSettings(values);
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

  const features = [
    {
      icon: <BranchesOutlined />,
      title: '可视化分支管理',
      description: '直观查看和管理Git分支'
    },
    {
      icon: <PullRequestOutlined />,
      title: 'Cherry-pick操作',
      description: '精确选择提交进行合并'
    },
    {
      icon: <MergeOutlined />,
      title: '自动创建合并请求',
      description: '集成GitLab自动创建MR'
    },
    {
      icon: <GithubOutlined />,
      title: '智能冲突检测',
      description: '提前检测合并冲突'
    }
  ];

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

        <div className="welcome-main">
          <div className="welcome-left">
            <Card className="action-card">
              <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Button
                  type="primary"
                  size="large"
                  icon={<FolderOpenOutlined />}
                  onClick={handleSelectDirectory}
                  loading={loading}
                  block
                >
                  选择项目目录
                </Button>

                <Button
                  size="large"
                  icon={<SettingOutlined />}
                  onClick={() => setSettingsVisible(true)}
                  block
                >
                  应用设置
                </Button>

                <Text type="secondary" style={{ textAlign: 'center', display: 'block' }}>
                  从本地文件系统选择Git项目目录或配置应用设置
                </Text>
              </Space>
            </Card>
          </div>

          <div className="welcome-right">
            <Card
              className="recent-projects-card"
              title={
                <Space>
                  <HistoryOutlined />
                  <span>最近打开的项目</span>
                </Space>
              }
            >
              <Spin spinning={projectsLoading}>
                {recentProjects.length > 0 ? (
                  <List
                    className="recent-projects-list"
                    dataSource={recentProjects}
                    renderItem={(project) => (
                      <List.Item
                        className="project-item"
                        onClick={() => handleOpenProject(project.path)}
                        actions={[
                          <Popconfirm
                            title="删除记录"
                            description="确定要从记录中移除此项目吗？（不会删除本地文件）"
                            onConfirm={(e) => handleRemoveProject(project.path, e)}
                            okText="确定"
                            cancelText="取消"
                          >
                            <Button
                              type="text"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={(e) => e.stopPropagation()}
                            >
                              删除
                            </Button>
                          </Popconfirm>
                        ]}
                      >
                        <List.Item.Meta
                          title={
                            <Space>
                              <span className="project-name">{project.name}</span>
                              <Tag color="blue">Git</Tag>
                            </Space>
                          }
                          description={
                            <div className="project-info">
                              <Text type="secondary" ellipsis style={{ maxWidth: 300 }}>
                                {project.path}
                              </Text>
                              <Text type="secondary" className="project-time">
                                {formatDate(project.lastOpened)}
                              </Text>
                            </div>
                          }
                        />
                      </List.Item>
                    )}
                  />
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="暂无最近打开的项目"
                  />
                )}
              </Spin>
            </Card>
          </div>
        </div>
      </div>

      {/* 设置抽屉 */}
      <Drawer
        title="应用设置"
        placement="right"
        width={600}
        open={settingsVisible}
        onClose={() => setSettingsVisible(false)}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={settings}
          onFinish={handleSaveSettings}
        >
          <Tabs items={[
            {
              key: 'gitlab',
              label: 'GitLab设置',
              children: (
                <>
                  <Form.Item
                    label="GitLab服务器地址"
                    name="gitlabServerUrl"
                    rules={[{ required: true, message: '请输入GitLab地址' }]}
                  >
                    <Input placeholder="https://git.landray.com.cn/" />
                  </Form.Item>
                  <Form.Item
                    label="GitLab访问令牌"
                    name="gitlabAccessToken"
                  >
                    <Input.Password placeholder="输入您的Personal Access Token" />
                  </Form.Item>
                  <Button onClick={handleTestToken}>测试令牌</Button>
                  {testResult && (
                    <Alert
                      style={{ marginTop: 16 }}
                      type={testResult.success ? 'success' : 'error'}
                      message={testResult.success ? '验证成功' : '验证失败'}
                      description={testResult.success ? `用户: ${testResult.user?.name}` : testResult.error}
                    />
                  )}
                </>
              )
            },
            {
              key: 'branches',
              label: '分支配置',
              children: (
                <>
                  <Form.Item
                    label="提测目标分支 (每行一个)"
                    name="testBranches"
                  >
                    <Input.TextArea rows={4} />
                  </Form.Item>
                  <Form.Item
                    label="入库目标分支 (每行一个)"
                    name="releaseBranches"
                  >
                    <Input.TextArea rows={4} />
                  </Form.Item>
                  <Form.Item
                    label="Bug提测目标分支 (每行一个)"
                    name="bugTestBranches"
                  >
                    <Input.TextArea rows={4} />
                  </Form.Item>
                </>
              )
            },
            {
              key: 'general',
              label: '常规设置',
              children: (
                <>
                  <Button
                    type="default"
                    onClick={async () => {
                      try {
                        const result = await window.electronAPI.system.exportLogZip();
                        if (result.success) {
                          message.success(`日志已导出至: ${result.path}`);
                        } else if (result.canceled) {
                          // 用户取消，不做提示
                        } else {
                          message.error(result.error || '导出失败');
                        }
                      } catch (error) {
                        message.error('导出日志失败: ' + error.message);
                      }
                    }}
                    block
                  >
                    导出当前日志
                  </Button>
                </>
              )
            }
          ]} />

          <Form.Item>
            <Button type="primary" htmlType="submit" block>
              保存设置
            </Button>
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
};

export default WelcomePage;

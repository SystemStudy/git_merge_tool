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
  Form,
  Input,
  Tabs,
  Alert,
  message,
  Switch,
  Select,
  AutoComplete,
  Checkbox
} from 'antd';
import {
  FolderOpenOutlined,
  HistoryOutlined,
  DeleteOutlined,
  SettingOutlined,
  BranchesOutlined,
  SearchOutlined,
  LockOutlined,
  DownloadOutlined
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
  // 监听当前选中的模型，确保其始终出现在下拉选项中（避免选中值不在列表时显示为空）
  const claudeModelValue = Form.useWatch('claudeModel', form);
  const [searchText, setSearchText] = useState('');
  // Claude 设置相关状态
  const [claudeUseLocal, setClaudeUseLocal] = useState(settings.claudeUseLocalConfig ?? true);
  const [claudeLoading, setClaudeLoading] = useState(false);
  const [claudeLocalApiUrl, setClaudeLocalApiUrl] = useState('');
  const [claudeLocalApiKey, setClaudeLocalApiKey] = useState('');
  const [claudeLocalModels, setClaudeLocalModels] = useState([]);
  const [claudeTestResult, setClaudeTestResult] = useState(null);
  const [claudeFetchedModels, setClaudeFetchedModels] = useState([]);
  const [claudeFetchingModels, setClaudeFetchingModels] = useState(false);
  const [claudeTesting, setClaudeTesting] = useState(false);
  const [claudeSupports1M, setClaudeSupports1M] = useState(settings.claudeModelSupports1M ?? false);
  const [claudeModelsMeta, setClaudeModelsMeta] = useState({});

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

  // 初始化 Claude 本地配置状态（settings 加载后）
  useEffect(() => {
    if (settings.claudeUseLocalConfig) {
      setClaudeUseLocal(true);
      // 开关 ON 时回填本地配置的 apiUrl/apiKey/模型，避免重启后地址与密钥为空
      loadLocalClaudeConfig();
    } else {
      setClaudeUseLocal(false);
    }
  }, [settings.claudeUseLocalConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadLocalClaudeConfig = async () => {
    setClaudeLoading(true);
    try {
      const result = await window.electronAPI.claude.readLocalConfig();
      if (result.success && result.config.exists) {
        setClaudeLocalApiUrl(result.config.apiUrl);
        setClaudeLocalApiKey(result.config.apiKey);
        setClaudeLocalModels(result.config.models);
        setClaudeModelsMeta(result.config.modelsMeta || {});
        if (!form.getFieldValue('claudeModel')) {
          // 优先回填配置文件中已保存的模型；否则退回本地默认模型。
          // 注意：此处可能在 <Form> 挂载前调用，antd 挂载时已存在的 store 值会覆盖
          // initialValues，因此必须写入与 settings 一致的值，避免空串覆盖已保存的选中值。
          const savedModel = settings.claudeModel;
          if (savedModel) {
            form.setFieldsValue({ claudeModel: savedModel });
            setClaudeSupports1M(settings.claudeModelSupports1M ?? false);
          } else if (result.config.model) {
            form.setFieldsValue({ claudeModel: result.config.model });
            setClaudeSupports1M(result.config.modelSupports1M ?? false);
          }
        }
        setClaudeUseLocal(true);
      } else {
        message.warning('当前系统未检测到 Claude 配置，请手动填写');
        setClaudeUseLocal(false);
      }
    } catch (e) {
      message.error('读取本地配置失败: ' + e.message);
      setClaudeUseLocal(false);
    } finally {
      setClaudeLoading(false);
    }
  };

  const getCurrentApiParams = () => {
    if (claudeUseLocal) {
      return {
        apiUrl: claudeLocalApiUrl,
        apiKey: claudeLocalApiKey,
        model: form.getFieldValue('claudeModel')
      };
    }
    return {
      apiUrl: form.getFieldValue('claudeApiUrl'),
      apiKey: form.getFieldValue('claudeApiKey'),
      model: form.getFieldValue('claudeModel')
    };
  };

  const handleClaudeTestConnection = async () => {
    const { apiUrl, apiKey, model } = getCurrentApiParams();
    if (!apiUrl || !apiKey) {
      message.warning('请先配置 API 地址和 Key');
      return;
    }
    setClaudeTesting(true);
    try {
      const result = await window.electronAPI.claude.testConnection(apiUrl, apiKey, model);
      setClaudeTestResult(result);
      if (result.success) {
        message.success('Claude 连接测试成功');
      } else {
        message.error(result.error);
      }
    } catch (e) {
      setClaudeTestResult({ success: false, error: e.message });
      message.error('测试连接失败: ' + e.message);
    } finally {
      setClaudeTesting(false);
    }
  };

  const handleClaudeFetchModels = async () => {
    const { apiUrl, apiKey } = getCurrentApiParams();
    if (!apiUrl || !apiKey) {
      message.warning('请先配置 API 地址和 Key');
      return;
    }
    setClaudeFetchingModels(true);
    try {
      const result = await window.electronAPI.claude.fetchModels(apiUrl, apiKey);
      if (result.success) {
        setClaudeFetchedModels(result.models);
        if (result.modelsMeta) setClaudeModelsMeta(prev => ({ ...prev, ...result.modelsMeta }));
        message.success(`获取到 ${result.models.length} 个模型`);
      } else if (result.notSupported) {
        message.info('当前 API 服务不支持获取模型列表，请手动输入模型名称');
      } else {
        message.error(result.error);
      }
    } catch (e) {
      message.error('获取模型列表失败: ' + e.message);
    } finally {
      setClaudeFetchingModels(false);
    }
  };

  const handleSaveSettings = async (values) => {
    try {
      // 以现有 settings 为底合并表单值，避免未在表单中出现的字段（如分支预设）被清空
      const newSettings = { ...settings, ...values };

      if (claudeUseLocal) {
        newSettings.claudeUseLocalConfig = true;
        delete newSettings.claudeApiUrl;
        delete newSettings.claudeApiKey;
      } else {
        newSettings.claudeUseLocalConfig = false;
      }

      newSettings.claudeModelSupports1M = claudeSupports1M;

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
            },
            {
              key: 'claude',
              label: 'Claude设置',
              children: (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <Space align="center">
                      <span style={{ fontWeight: 500 }}>读取本地Claude配置</span>
                      <Switch
                        checked={claudeUseLocal}
                        loading={claudeLoading}
                        onChange={async (checked) => {
                          if (checked) {
                            await loadLocalClaudeConfig();
                          } else {
                            setClaudeUseLocal(false);
                          }
                        }}
                      />
                    </Space>
                    <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
                      开启后自动读取 ~/.claude/settings.json 和环境变量，API地址和Key不存储到本地
                    </div>
                  </div>

                  <Form.Item
                    label="Claude API 地址"
                    name={claudeUseLocal ? undefined : 'claudeApiUrl'}
                  >
                    <Input
                      value={claudeUseLocal ? claudeLocalApiUrl : undefined}
                      placeholder="https://api.anthropic.com"
                      disabled={claudeUseLocal}
                      suffix={claudeUseLocal ? <LockOutlined style={{ color: '#999' }} /> : null}
                      onChange={!claudeUseLocal ? (e) => form.setFieldsValue({ claudeApiUrl: e.target.value }) : undefined}
                    />
                  </Form.Item>

                  <Form.Item
                    label="Claude API Key"
                    name={claudeUseLocal ? undefined : 'claudeApiKey'}
                  >
                    <Input.Password
                      value={claudeUseLocal ? claudeLocalApiKey : undefined}
                      placeholder="输入 API Key"
                      disabled={claudeUseLocal}
                      suffix={claudeUseLocal ? <LockOutlined style={{ color: '#999' }} /> : null}
                      onChange={!claudeUseLocal ? (e) => form.setFieldsValue({ claudeApiKey: e.target.value }) : undefined}
                    />
                  </Form.Item>

                  {/* 模型名称 + 1M 复选框 */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <Form.Item label="模型名称" name="claudeModel" style={{ flex: 1, marginBottom: 0 }}>
                      {claudeUseLocal ? (
                        <Select
                          placeholder="选择模型"
                          options={[...new Set([...claudeLocalModels, ...claudeFetchedModels, claudeModelValue].filter(Boolean))].map(m => ({ label: m, value: m }))}
                          onChange={(value) => {
                            if (claudeModelsMeta[value]) {
                              setClaudeSupports1M(true);
                            }
                          }}
                        />
                      ) : (
                        <AutoComplete
                          placeholder="输入或选择模型"
                          options={[...new Set([...claudeLocalModels, ...claudeFetchedModels, claudeModelValue].filter(Boolean))].map(m => ({ label: m, value: m }))}
                          filterOption={(inputValue, option) =>
                            option.label.toLowerCase().includes(inputValue.toLowerCase())
                          }
                        />
                      )}
                    </Form.Item>
                    <div>
                      <div style={{ height: 22, marginBottom: 8, lineHeight: '22px', fontSize: 14, color: 'rgba(0,0,0,0.88)' }}>
                        声明支持 1M
                      </div>
                      <div style={{ height: 32, display: 'flex', alignItems: 'center' }}>
                        <Checkbox
                          checked={claudeSupports1M}
                          onChange={(e) => setClaudeSupports1M(e.target.checked)}
                        >
                          1M
                        </Checkbox>
                      </div>
                    </div>
                  </div>

                  <Form.Item style={{ marginTop: 16 }}>
                    <Space>
                      <Button onClick={handleClaudeTestConnection} loading={claudeTesting}>测试连接</Button>
                      <Button
                        onClick={handleClaudeFetchModels}
                        loading={claudeFetchingModels}
                        icon={<DownloadOutlined />}
                      >
                        获取模型列表
                      </Button>
                    </Space>
                  </Form.Item>

                  {claudeTestResult && (
                    <Alert
                      style={{ marginBottom: 12 }}
                      type={claudeTestResult.success ? 'success' : 'error'}
                      message={claudeTestResult.success ? '连接成功' : '连接失败'}
                      description={claudeTestResult.success
                        ? `模型: ${claudeTestResult.model}`
                        : claudeTestResult.error}
                    />
                  )}

                  <Alert
                    type="info"
                    message="支持 Anthropic 官方 API 及兼容服务（如 DeepSeek API），只需配置对应的 API 地址和 Key 即可。"
                    style={{ fontSize: 12 }}
                  />
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

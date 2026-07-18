import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Alert, Tabs, Select, AutoComplete, Switch, Checkbox, Space, message } from 'antd';
import { DownloadOutlined, LockOutlined } from '@ant-design/icons';

const SettingsForm = ({ settings, onSave }) => {
  const [form] = Form.useForm();
  // 监听当前选中的模型，确保其始终出现在下拉选项中（避免选中值不在列表时显示为空）
  const claudeModelValue = Form.useWatch('claudeModel', form);
  const [testResult, setTestResult] = useState(null);
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
  const [claudeModelsMeta, setClaudeModelsMeta] = useState({}); // { modelName: true } 表示支持1M

  // 初始化：如果开关ON，读取本地配置
  useEffect(() => {
    if (settings.claudeUseLocalConfig) {
      loadLocalClaudeConfig();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadLocalClaudeConfig = async () => {
    setClaudeLoading(true);
    try {
      const result = await window.electronAPI.claude.readLocalConfig();
      if (result.success && result.config.exists) {
        setClaudeLocalApiUrl(result.config.apiUrl);
        setClaudeLocalApiKey(result.config.apiKey);
        setClaudeLocalModels(result.config.models);
        setClaudeModelsMeta(result.config.modelsMeta || {});
        // 如果表单中没有已选模型，优先用配置文件已保存的模型，否则用本地配置的默认值
        if (!form.getFieldValue('claudeModel')) {
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
        message.success('已读取本地 Claude 配置');
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

  // 获取当前有效的 API 参数（开关ON用本地配置，OFF用表单值）
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

  // 保存时：开关ON不存储apiUrl/apiKey
  const handleFinish = (values) => {
    // 以现有 settings 为底合并表单值，避免未在表单中出现的字段（如分支预设）被清空
    const newSettings = { ...settings, ...values };

    if (claudeUseLocal) {
      newSettings.claudeUseLocalConfig = true;
      delete newSettings.claudeApiUrl;
      delete newSettings.claudeApiKey;
    } else {
      newSettings.claudeUseLocalConfig = false;
    }

    // 保存 1M 标记
    newSettings.claudeModelSupports1M = claudeSupports1M;

    onSave(newSettings);
  };

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={settings}
      onFinish={handleFinish}
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
                        // 如果选中的模型在本地配置中标记了 [1m]，自动勾选
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
                <div style={{ paddingTop: 0 }}>
                  <div style={{ height: 22, display: 'flex', alignItems: 'flex-end', paddingBottom: 8, fontSize: 14, color: 'rgba(0,0,0,0.88)' }}>
                    声明支持 1M
                  </div>
                  <Checkbox
                    checked={claudeSupports1M}
                    onChange={(e) => setClaudeSupports1M(e.target.checked)}
                  >
                    1M
                  </Checkbox>
                </div>
              </div>

              <Form.Item>
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
  );
};

export default SettingsForm;

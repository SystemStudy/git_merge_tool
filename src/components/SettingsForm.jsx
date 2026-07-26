import React, { useState } from 'react';
import { Form, Input, Button, Alert, Tabs, message, Space } from 'antd';
import {
  GitlabOutlined,
  BranchesOutlined,
  DatabaseOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import RemoteReposManager from './RemoteReposManager';
import './SettingsForm.css';

const SettingsForm = ({ settings, onSave, showRemoteRepos = true }) => {
  const [form] = Form.useForm();
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const handleTestToken = async () => {
    const values = form.getFieldsValue();
    if (!values.gitlabServerUrl || !values.gitlabAccessToken) {
      message.warning('请先填写GitLab地址和令牌');
      return;
    }

    setTesting(true);
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
    } finally {
      setTesting(false);
    }
  };

  const handleFinish = (values) => {
    const newSettings = { ...settings, ...values };
    onSave(newSettings);
  };

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={settings}
      onFinish={handleFinish}
      className="settings-form"
    >
      <Tabs
        className="settings-tabs"
        items={[
          {
            key: 'gitlab',
            label: (
              <span>
                <GitlabOutlined style={{ marginRight: 6 }} />
                GitLab设置
              </span>
            ),
            children: (
              <div className="settings-tab-content">
                <Form.Item
                  label="服务器地址"
                  name="gitlabServerUrl"
                  rules={[{ required: true, message: '请输入GitLab地址' }]}
                >
                  <Input placeholder="https://git.landray.com.cn/" />
                </Form.Item>
                <Form.Item
                  label="访问令牌"
                  name="gitlabAccessToken"
                >
                  <Input.Password placeholder="输入您的 Personal Access Token" />
                </Form.Item>

                <Space>
                  <Button
                    className="test-token-btn"
                    onClick={handleTestToken}
                    loading={testing}
                  >
                    测试连接
                  </Button>
                </Space>

                {testResult && (
                  <Alert
                    style={{ marginTop: 16, borderRadius: 'var(--radius-sm)' }}
                    type={testResult.success ? 'success' : 'error'}
                    message={
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {testResult.success ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                        {testResult.success ? '验证成功' : '验证失败'}
                      </span>
                    }
                    description={testResult.success ? `用户: ${testResult.user?.name}` : testResult.error}
                  />
                )}
              </div>
            )
          },
          {
            key: 'branches',
            label: (
              <span>
                <BranchesOutlined style={{ marginRight: 6 }} />
                分支配置
              </span>
            ),
            children: (
              <div className="settings-tab-content">
                <Form.Item
                  label="提测目标分支"
                  name="testBranches"
                >
                  <Input.TextArea rows={5} placeholder="smoke&#10;stable/sp5/test" />
                </Form.Item>
                <Form.Item
                  label="入库目标分支"
                  name="releaseBranches"
                >
                  <Input.TextArea rows={5} placeholder="main&#10;release" />
                </Form.Item>
                <Form.Item
                  label="Bug提测目标分支"
                  name="bugTestBranches"
                >
                  <Input.TextArea rows={5} placeholder="smoke&#10;stable/sp5/bugfix" />
                </Form.Item>
              </div>
            )
          },
          ...(showRemoteRepos ? [{
            key: 'remoteRepos',
            label: (
              <span>
                <DatabaseOutlined style={{ marginRight: 6 }} />
                仓库管理
              </span>
            ),
            children: (
              <div className="settings-tab-content">
                <RemoteReposManager />
              </div>
            )
          }] : [])
        ]}
      />

      <Form.Item style={{ marginTop: 24 }}>
        <Button
          type="primary"
          htmlType="submit"
          block
          className="settings-save-btn"
        >
          保存设置
        </Button>
      </Form.Item>
    </Form>
  );
};

export default SettingsForm;

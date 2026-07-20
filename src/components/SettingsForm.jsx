import React, { useState } from 'react';
import { Form, Input, Button, Alert, Tabs, message } from 'antd';

const SettingsForm = ({ settings, onSave }) => {
  const [form] = Form.useForm();
  const [testResult, setTestResult] = useState(null);

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

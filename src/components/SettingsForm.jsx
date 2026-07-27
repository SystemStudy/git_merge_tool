import React, { useState } from 'react';
import { Form, Input, Button, Alert, Tabs, message, Divider } from 'antd';
import { ExportOutlined } from '@ant-design/icons';

const THEME_COLORS = [
  { name: '靛蓝', value: '#4F46E5' },
  { name: '蓝色', value: '#1677FF' },
  { name: '青色', value: '#13C2C2' },
  { name: '翠绿', value: '#10B981' },
  { name: '橙色', value: '#F59E0B' },
  { name: '玫红', value: '#EB2F96' },
];

const SettingsForm = ({ settings, onSave, onThemeColorChange, onSettingsChange }) => {
  const [form] = Form.useForm();
  const [testResult, setTestResult] = useState(null);
  const [themeColor, setThemeColor] = useState(settings.themeColor || '#4F46E5');

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

  const handleThemeColorSelect = async (newColor) => {
    setThemeColor(newColor);
    const newSettings = { ...settings, themeColor: newColor };
    // 同步父组件 settings state（避免 Drawer 重开时 UI 回退）
    if (onSettingsChange) {
      onSettingsChange(newSettings);
    }
    if (onThemeColorChange) {
      onThemeColorChange(newColor);
    }
    // 即时持久化到 electron-store
    try {
      await window.electronAPI.settings.save(newSettings);
    } catch (err) {
      message.error('主题色保存失败: ' + err.message);
    }
  };

  const handleExportLog = async () => {
    try {
      await window.electronAPI.system.exportLogZip();
      message.success('日志导出完成');
    } catch (error) {
      message.error('导出失败: ' + error.message);
    }
  };

  const handleFinish = (values) => {
    const newSettings = { ...settings, ...values, themeColor };
    onSave(newSettings);
  };

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{ ...settings, themeColor }}
      onFinish={handleFinish}
    >
      <Tabs defaultActiveKey="general" items={[
        {
          key: 'general',
          label: '常规设置',
          children: (
            <>
              <Form.Item label="主题颜色">
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  {THEME_COLORS.map((c) => {
                    const selected = themeColor === c.value;
                    return (
                      <div
                        key={c.value}
                        onClick={() => handleThemeColorSelect(c.value)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '6px 14px',
                          borderRadius: '20px',
                          cursor: 'pointer',
                          border: selected ? `2px solid ${c.value}` : '1px solid #d9d9d9',
                          backgroundColor: selected ? `${c.value}14` : '#fff',
                          transition: 'all 0.2s',
                          userSelect: 'none',
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-block',
                            width: '16px',
                            height: '16px',
                            borderRadius: '50%',
                            backgroundColor: c.value,
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ lineHeight: '16px' }}>{c.name}</span>
                      </div>
                    );
                  })}
                </div>
              </Form.Item>

              <Divider />

              <Form.Item label="日志管理">
                <Button icon={<ExportOutlined />} onClick={handleExportLog}>
                  导出当前日志
                </Button>
              </Form.Item>
            </>
          ),
        },
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
          ),
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
          ),
        },
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

import React, { useState } from 'react';
import { Modal, Button, Input, Divider, message } from 'antd';
import { PlusOutlined, MinusOutlined } from '@ant-design/icons';
import { extractIssueAndDesc } from '../utils/versionJsonHelpers';

const LABEL_STYLE = { width: 96, flexShrink: 0, textAlign: 'right', paddingRight: 12 };
const ROW_STYLE = { display: 'flex', alignItems: 'center', marginBottom: 12 };
// 加号仅在最后一行显示，其余行用等宽占位撑开，保证各行输入框宽度一致
const ICON_PLACEHOLDER_STYLE = { display: 'inline-block', width: 40, flexShrink: 0 };

/**
 * version.json 信息补充表单（受控组件，由 showVersionJsonDialog 挂载到 Modal 内）
 */
const VersionJsonForm = ({ defaultIssue, defaultDesc, onSkip, onConfirm }) => {
  const [issue, setIssue] = useState(defaultIssue || '');
  const [desc, setDesc] = useState(defaultDesc || '');
  const [modules, setModules] = useState(['']);
  const [issueError, setIssueError] = useState(false);
  const [moduleError, setModuleError] = useState(false);

  const handleModuleChange = (index, value) => {
    setModules(prev => prev.map((m, i) => (i === index ? value : m)));
    if (moduleError) setModuleError(false);
  };

  const handleAddModule = () => {
    setModules(prev => [...prev, '']);
  };

  const handleRemoveModule = (index) => {
    setModules(prev => prev.filter((_, i) => i !== index));
    if (moduleError) setModuleError(false);
  };

  const handleConfirm = () => {
    const trimmedIssue = issue.trim();
    // 去空 + 去重，保留用户输入顺序
    const validModules = [...new Set(modules.map(m => m.trim()).filter(Boolean))];

    const issueMissing = !trimmedIssue;
    const moduleMissing = validModules.length === 0;
    setIssueError(issueMissing);
    setModuleError(moduleMissing);

    if (issueMissing && moduleMissing) {
      message.error('请填写昆仑单号，并至少输入一个模块名');
      return;
    }
    if (issueMissing) {
      message.error('请填写昆仑单号');
      return;
    }
    if (moduleMissing) {
      message.error('请至少输入一个模块名');
      return;
    }

    onConfirm({ issue: trimmedIssue, desc: desc.trim(), modules: validModules });
  };

  return (
    <div>
      <p style={{ marginBottom: 16 }}>
        本次合并的目标分支中包含非 develop 分支，是否需要补充 version.json 文件内容？
        确认后将在合并分支的 version.json 的 relations 中追加一条记录。
      </p>

      <div style={ROW_STYLE}>
        <span style={LABEL_STYLE}>昆仑单号</span>
        <Input
          value={issue}
          status={issueError ? 'error' : ''}
          placeholder="例如: MKR-30211"
          onChange={(e) => {
            setIssue(e.target.value);
            if (issueError) setIssueError(false);
          }}
        />
      </div>

      <div style={ROW_STYLE}>
        <span style={LABEL_STYLE}>说明内容</span>
        <Input
          value={desc}
          placeholder="昆仑单标题"
          onChange={(e) => setDesc(e.target.value)}
        />
      </div>

      <Divider style={{ margin: '16px 0' }} />

      {modules.map((moduleName, index) => (
        <div style={ROW_STYLE} key={index}>
          <span style={LABEL_STYLE}>{index === 0 ? '请输入模块名' : ''}</span>
          <Input
            value={moduleName}
            status={moduleError ? 'error' : ''}
            placeholder="例如: mk-ai-base"
            onChange={(e) => handleModuleChange(index, e.target.value)}
          />
          {index === modules.length - 1 ? (
            <Button
              type="text"
              icon={<PlusOutlined />}
              onClick={handleAddModule}
              style={{ marginLeft: 8, flexShrink: 0 }}
            />
          ) : (
            // 占位，保持各行输入框宽度一致
            <span style={ICON_PLACEHOLDER_STYLE} />
          )}
          {/* 仅剩一个输入框时不显示减号；多于一个时每行都显示，宽度天然一致 */}
          {modules.length > 1 && (
            <Button
              type="text"
              icon={<MinusOutlined />}
              onClick={() => handleRemoveModule(index)}
              style={{ marginLeft: 4, flexShrink: 0 }}
            />
          )}
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
        <Button onClick={onSkip}>不需要</Button>
        <Button type="primary" onClick={handleConfirm}>确认</Button>
      </div>
    </div>
  );
};

/**
 * 弹出 version.json 信息补充弹窗。
 * 默认值从选中提交记录中提取（格式 fix(feat): #MKR-XXXX 说明内容）。
 * @param {Array} selectedCommitsData 选中的提交对象列表
 * @returns {Promise<{issue: string, desc: string, modules: string[]}|null>} 点击"不需要"返回 null
 */
export const showVersionJsonDialog = async (selectedCommitsData) => {
  const { issue, desc } = extractIssueAndDesc(selectedCommitsData);

  return await new Promise((resolve) => {
    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      destroy();
      resolve(value);
    };

    const { destroy } = Modal.confirm({
      title: '补充 version.json 内容',
      width: 640,
      icon: null,
      bodyStyle: { padding: '20px 24px' },
      content: (
        <VersionJsonForm
          defaultIssue={issue}
          defaultDesc={desc}
          onSkip={() => finish(null)}
          onConfirm={(data) => finish(data)}
        />
      ),
      footer: null,
      closable: false,
      maskClosable: false
    });
  });
};

export default VersionJsonForm;

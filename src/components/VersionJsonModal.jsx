import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Input, Divider, message } from 'antd';
import { PlusOutlined, MinusOutlined, CloseOutlined } from '@ant-design/icons';
import { extractIssueAndDesc } from '../utils/versionJsonHelpers';

const LABEL_STYLE = { width: 96, flexShrink: 0, textAlign: 'right', paddingRight: 12 };
const ROW_STYLE = { display: 'flex', alignItems: 'center', marginBottom: 12 };
// 加号仅在最后一行显示，其余行用等宽占位撑开，保证各行输入框宽度一致
const ICON_PLACEHOLDER_STYLE = { display: 'inline-block', width: 40, flexShrink: 0 };

// 常用模块标签的浅色系配色（背景 + 文字 + 边框），按模块名哈希取色，
// 同一模块名每次打开弹窗颜色保持一致，不同模块名之间颜色随机分布
const TAG_COLORS = [
  { bg: '#E6F4FF', fg: '#0958D9', border: '#91CAFF' },
  { bg: '#F6FFED', fg: '#389E0D', border: '#B7EB8F' },
  { bg: '#FFF7E6', fg: '#D46B08', border: '#FFD591' },
  { bg: '#FFF0F6', fg: '#C41D7F', border: '#FFADD2' },
  { bg: '#F9F0FF', fg: '#531DAB', border: '#D3ADF7' },
  { bg: '#E6FFFB', fg: '#08979C', border: '#87E8DE' },
  { bg: '#FCFFE6', fg: '#7CB305', border: '#EAFF8F' },
  { bg: '#FFF1F0', fg: '#CF1322', border: '#FFA39E' },
];

// 模块名 -> 配色：字符串哈希后对配色表取模
const getTagColor = (name) => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return TAG_COLORS[hash % TAG_COLORS.length];
};

/**
 * version.json 信息补充表单（受控组件，由 showVersionJsonDialog 挂载到 Modal 内）
 */
const VersionJsonForm = ({ defaultIssue, defaultDesc, onSkip, onConfirm }) => {
  const [issue, setIssue] = useState(defaultIssue || '');
  const [desc, setDesc] = useState(defaultDesc || '');
  const [modules, setModules] = useState(['']);
  const [issueError, setIssueError] = useState(false);
  const [moduleError, setModuleError] = useState(false);
  const [commonModules, setCommonModules] = useState([]);

  // 加载历史输入过的常用模块（独立文件存储，与应用设置分开）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await window.electronAPI.versionJson.getCommonModules();
        if (!cancelled) setCommonModules(Array.isArray(list) ? list : []);
      } catch (error) {
        console.warn('[VersionJsonForm] 加载常用模块失败:', error.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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

  // 点击常用模块：已填入则忽略；优先填进第一个空行，没有空行则新增一行
  const handlePickCommonModule = useCallback((name) => {
    setModules(prev => {
      if (prev.some(m => m.trim() === name)) {
        message.info(`模块 ${name} 已添加`);
        return prev;
      }
      const emptyIndex = prev.findIndex(m => !m.trim());
      if (emptyIndex === -1) return [...prev, name];
      return prev.map((m, i) => (i === emptyIndex ? name : m));
    });
    if (moduleError) setModuleError(false);
  }, [moduleError]);

  // 删除常用模块（只影响历史记录，不影响当前已填入的输入框）
  const handleDeleteCommonModule = async (name, event) => {
    event.stopPropagation();
    try {
      const list = await window.electronAPI.versionJson.removeCommonModule(name);
      setCommonModules(Array.isArray(list) ? list : []);
    } catch (error) {
      console.error('[VersionJsonForm] 删除常用模块失败:', error.message);
      message.error('删除常用模块失败: ' + error.message);
    }
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

    // 本次输入的模块名沉淀为常用模块，失败不阻断主流程
    window.electronAPI.versionJson.addCommonModules(validModules).catch((error) => {
      console.warn('[VersionJsonForm] 保存常用模块失败:', error.message);
    });

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

      {/* 常用模块：历史输入过的模块名，点击填入输入框，叉号从历史记录中删除 */}
      {commonModules.length > 0 && (
        <div style={{ display: 'flex', marginTop: 16 }}>
          <span style={{ ...LABEL_STYLE, paddingTop: 4 }}>常用模块</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, flex: 1 }}>
            {commonModules.map((name) => {
              const color = getTagColor(name);
              return (
                <span
                  key={name}
                  onClick={() => handlePickCommonModule(name)}
                  title={`点击填入模块 ${name}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '3px 8px 3px 10px',
                    borderRadius: 12,
                    fontSize: 13,
                    lineHeight: '20px',
                    cursor: 'pointer',
                    userSelect: 'none',
                    background: color.bg,
                    color: color.fg,
                    border: `1px solid ${color.border}`,
                  }}
                >
                  {name}
                  <CloseOutlined
                    onClick={(e) => handleDeleteCommonModule(name, e)}
                    title="从常用模块中删除"
                    style={{ fontSize: 10, opacity: 0.65, cursor: 'pointer' }}
                  />
                </span>
              );
            })}
          </div>
        </div>
      )}

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

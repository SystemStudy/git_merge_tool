/**
 * 操作面板组件 - 从 MainWorkspace.js 中抽取
 * 包含合并类型选择、目标分支配置、操作按钮组
 */
import React from 'react';
import {
  Card,
  Button,
  Radio,
  Checkbox,
  AutoComplete,
} from 'antd';
import {
  SearchOutlined,
  TagOutlined,
  PlusOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { MERGE_TYPES } from './CommitList';
import {
  getTargetBranches,
  getActionButtons,
} from '../utils/workspaceHelpers';

const OperationPanel = ({
  mergeType,
  setMergeType,
  selectedTargetBranches,
  setSelectedTargetBranches,
  customBranchInputs,
  setCustomBranchInputs,
  branches,
  settings,
  loading,
  handleCherryPickAndPush,
  handleCreateMergeBranch,
  handleDetectChanges,
  handleDetectVersion,
  changeDetecting,
  versionDetecting,
  selectedCommitsCount,
  handleCrossRepoPlaceholder,
}) => {
  return (
    <div className="operations-panel">
      <Card title="合并操作" size="small">
        <div className="merge-type-section">
          <label className="section-label">合并类型:</label>
          <Radio.Group 
            value={mergeType} 
            onChange={(e) => {
              setMergeType(e.target.value);
              setSelectedTargetBranches([]);
              if (e.target.value === 'custom') {
                setCustomBranchInputs(['']);
              }
            }}
            className="merge-type-radio-group"
          >
            {MERGE_TYPES.filter(type => !type.hidden).map(type => (
              <Radio.Button key={type.value} value={type.value}>
                {type.label}
              </Radio.Button>
            ))}
          </Radio.Group>
        </div>

        {mergeType !== 'crossRepo' && (
          <div className="target-branches-section">
            <label className="section-label">目标分支:</label>
            {mergeType === 'custom' ? (
            <div className="custom-branches-input-list">
              {customBranchInputs.map((value, index) => (
                <div key={index} className="custom-branch-input-row">
                  <AutoComplete
                    className="custom-branch-autocomplete"
                    placeholder="输入分支名搜索..."
                    value={value}
                    options={branches
                      .filter(b => b.toLowerCase().includes((value || '').toLowerCase()))
                      .slice(0, 20)
                      .map(b => ({ value: b, label: b }))
                    }
                    onChange={(val) => {
                      const newInputs = [...customBranchInputs];
                      newInputs[index] = val;
                      setCustomBranchInputs(newInputs);
                    }}
                    onSelect={(val) => {
                      const newInputs = [...customBranchInputs];
                      newInputs[index] = val;
                      setCustomBranchInputs(newInputs);
                    }}
                    allowClear
                  />
                  {customBranchInputs.length > 1 && (
                    <Button
                      type="text"
                      danger
                      icon={<CloseOutlined />}
                      onClick={() => setCustomBranchInputs(prev => prev.filter((_, i) => i !== index))}
                    />
                  )}
                  {index === customBranchInputs.length - 1 && (
                    <Button
                      type="dashed"
                      icon={<PlusOutlined />}
                      onClick={() => setCustomBranchInputs(prev => [...prev, ''])}
                    >
                      添加分支
                    </Button>
                  )}
                </div>
              ))}
            </div>
            ) : (
              <Checkbox.Group
                className="branches-checkbox-group"
                options={getTargetBranches(mergeType, settings, customBranchInputs).map(b => ({ label: b, value: b }))}
                value={selectedTargetBranches}
                onChange={setSelectedTargetBranches}
              />
            )}
          </div>
        )}

        <div className="action-buttons">
          {getActionButtons({ mergeType, loading, handleCherryPickAndPush, handleCreateMergeBranch, handleCrossRepoPlaceholder })}
          {mergeType !== 'crossRepo' && (
            <>
              <Button
                type="default"
                icon={<SearchOutlined />}
                onClick={handleDetectChanges}
                loading={changeDetecting}
                disabled={selectedCommitsCount === 0 || selectedTargetBranches.length === 0 || changeDetecting}
                style={{ marginLeft: 8 }}
              >
                检测变更
              </Button>
              {mergeType === 'release' && (
                <Button
                  type="default"
                  icon={<TagOutlined />}
                  onClick={handleDetectVersion}
                  loading={versionDetecting}
                  disabled={selectedCommitsCount !== 1 || selectedTargetBranches.length === 0 || versionDetecting}
                  style={{ marginLeft: 8 }}
                >
                  检测版本
                </Button>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
};

export default OperationPanel;

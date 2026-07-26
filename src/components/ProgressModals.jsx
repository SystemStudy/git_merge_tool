import React from 'react';
import {
  Modal, Progress, Alert, Card, Tag, Button, Space, Table, message, Input
} from 'antd';
import {
  BranchesOutlined, CopyOutlined, SearchOutlined
} from '@ant-design/icons';
import './ProgressModals.css';

/**
 * 合并分支进度 Modal
 */
export function MergeProgressModal({ mergeProgress }) {
  return (
    <Modal
      title="创建合并分支"
      open={mergeProgress.visible}
      closable={false}
      footer={null}
      maskClosable={false}
      width={600}
      zIndex={1000}
      className="merge-progress-modal"
    >
      <div className="modal-content-padding" style={{ padding: '20px 0' }}>
        <Progress
          percent={Math.round((mergeProgress.current / mergeProgress.total) * 100)}
          status="active"
          format={(percent) => `${percent}%`}
        />
        <div className="modal-status-text">
          {mergeProgress.status}
        </div>
        {mergeProgress.results.length > 0 && (
          <div style={{ marginTop: 16, maxHeight: '200px', overflowY: 'auto' }}>
            <Alert
              message="已完成操作"
              description={
                <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                  {mergeProgress.results.map((result, index) => (
                    <li key={index} style={{ marginBottom: '4px' }}>
                      {result.success ? '\u2713' : '\u2717'} {result.mergeBranch}
                      {result.success && result.mrUrl && (
                        <a
                          href="#!"
                          onClick={(e) => {
                            e.preventDefault();
                            window.electronAPI.system.openExternal(result.mrUrl);
                          }}
                          style={{ marginLeft: 8 }}
                        >
                          查看MR
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              }
              type={mergeProgress.current === mergeProgress.total ? 'success' : 'info'}
              showIcon
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * 合并分支结果 Modal
 */
export function MergeResultModal({ mergeResultModal, setMergeResultModal, selectedCommits, findCommitByHash }) {
  return (
    <Modal
      title="合并请求创建结果"
      open={mergeResultModal.visible}
      onCancel={() => setMergeResultModal({ visible: false, success: false, results: [] })}
      footer={[
        <Button
          key="copy"
          icon={<CopyOutlined />}
          onClick={() => {
            const formatResults = () => {
              const successResults = mergeResultModal.results.filter(r => r.success);
              if (successResults.length === 0) {
                return '无成功的合并请求';
              }

              const firstCommitHash = selectedCommits[0];
              const firstCommit = findCommitByHash(firstCommitHash);
              const author = firstCommit?.author_name || '-';
              const date = firstCommit?.date || '-';
              const commitMessage = firstCommit?.message || '-';

              let text = '=== Git多分支合并信息 ===\n';
              text += `作者: ${author}   时间: ${date}\n`;
              text += `提交记录: ${commitMessage}\n`;
              successResults.forEach((result, index) => {
                text += `${index + 1}. 分支: ${result.targetBranch}\n`;
                if (result.mrUrl) {
                  text += `   合并请求地址: ${result.mrUrl}\n`;
                }
              });
              return text;
            };

            const textToCopy = formatResults();
            navigator.clipboard.writeText(textToCopy).then(() => {
              message.success('已复制到剪贴板');
            }).catch((err) => {
              console.error('复制失败:', err);
              message.error('复制失败');
            });
          }}
        >
          复制信息
        </Button>,
        <Button
          key="close"
          type="primary"
          onClick={() => setMergeResultModal({ visible: false, success: false, results: [] })}
        >
          关闭
        </Button>
      ]}
      width={700}
      className="merge-result-modal"
    >
      <div style={{ padding: '10px 0' }}>
        <Alert
          message={mergeResultModal.success ? '全部创建成功' : '部分创建失败'}
          description={
            <div>
              <p style={{ marginBottom: '12px' }}>
                共处理 {mergeResultModal.results.length} 个目标分支
              </p>
              {mergeResultModal.results.map((result, index) => (
                <Card
                  key={index}
                  size="small"
                  className={`merge-result-card ${result.success ? 'success' : 'error'}`}
                  style={{ marginBottom: '12px' }}
                >
                  <div style={{ marginBottom: '8px' }}>
                    <strong>目标分支:</strong> {result.targetBranch}
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <strong>源分支:</strong> {result.sourceBranch}
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <strong>创建分支:</strong> {result.mergeBranch}
                  </div>
                  {result.success && result.mrUrl && (
                    <div style={{ marginBottom: '8px' }}>
                      <strong>合并请求:</strong>{' '}
                      <a
                        href="#!"
                        onClick={(e) => {
                          e.preventDefault();
                          window.electronAPI.system.openExternal(result.mrUrl);
                        }}
                        className="merge-result-link"
                      >
                        {result.mrUrl}
                      </a>
                    </div>
                  )}
                  {result.error && (
                    <div style={{ color: '#ff4d4f' }}>
                      <strong>错误:</strong> {result.error}
                    </div>
                  )}
                  <div style={{ marginTop: '8px' }}>
                    <Tag color={result.success ? 'green' : 'red'}>
                      {result.success ? '成功' : '失败'}
                    </Tag>
                  </div>
                </Card>
              ))}
            </div>
          }
          type={mergeResultModal.success ? 'success' : 'warning'}
          showIcon
        />
      </div>
    </Modal>
  );
}

/**
 * 冲突解决 Modal
 */
export function ConflictResolveModal({ conflictModal, allFilesResolved, handleConflictConfirm, handleConflictCancel, handleOpenFile, handleMarkResolved }) {
  return (
    <Modal
      title="使用外部应用解决冲突"
      open={conflictModal.visible}
      closable={false}
      maskClosable={false}
      zIndex={2000}
      footer={[
        <Button key="cancel" onClick={handleConflictCancel}>
          取消
        </Button>,
        <Button key="confirm" type="primary" disabled={!allFilesResolved} onClick={handleConflictConfirm}>
          确认
        </Button>
      ]}
      width={600}
    >
      <div style={{ padding: '10px 0' }}>
        <Alert
          message={`Cherry-pick 到 ${conflictModal.branch} 时发生冲突`}
          description={'请在外部编辑器中手动解决冲突，解决后点击\u201C已处理\u201D标记该文件。所有文件标记为已处理后，点击\u201C确认\u201D继续。'}
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <div className="conflict-section-label">
          冲突文件（共 {conflictModal.files.length} 个）：
        </div>
        {conflictModal.files.map((file, index) => (
          <div
            key={index}
            className={`conflict-file-item ${file.resolved ? 'resolved' : ''}`}
          >
            <span className="conflict-file-path">
              {file.path}
            </span>
            <Space>
              <Button size="small" onClick={() => handleOpenFile(file.path)}>
                解决
              </Button>
              <Button
                size="small"
                type={file.resolved ? 'default' : 'primary'}
                disabled={file.resolved}
                onClick={() => handleMarkResolved(file.path)}
              >
                {file.resolved ? '已完成' : '已处理'}
              </Button>
            </Space>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/**
 * CherryPick 进度 Modal
 */
export function CherryPickProgressModal({ cherryPickProgress }) {
  return (
    <Modal
      title="遴选推送"
      open={cherryPickProgress.visible}
      closable={false}
      footer={null}
      maskClosable={false}
      width={600}
      zIndex={1000}
      className="merge-progress-modal"
    >
      <div className="modal-content-padding" style={{ padding: '20px 0' }}>
        <Progress
          percent={Math.round((cherryPickProgress.current / cherryPickProgress.total) * 100)}
          status="active"
          format={(percent) => `${percent}%`}
        />
        <div className="modal-status-text">
          {cherryPickProgress.status}
        </div>
        {cherryPickProgress.results.length > 0 && (
          <div style={{ marginTop: 16, maxHeight: '200px', overflowY: 'auto' }}>
            <Alert
              message="已完成操作"
              description={
                <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                  {cherryPickProgress.results.map((result, index) => (
                    <li key={index} style={{ marginBottom: '4px' }}>
                      {result.success ? '\u2713' : '\u2717'} {result.targetBranch}
                      {result.success && (
                        <span style={{ color: '#52c41a', marginLeft: 8 }}>
                          推送成功
                        </span>
                      )}
                      {result.error && (
                        <span style={{ color: '#ff4d4f', marginLeft: 8 }}>
                          {result.error}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              }
              type={cherryPickProgress.current === cherryPickProgress.total ? 'success' : 'info'}
              showIcon
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * CherryPick 结果 Modal
 */
export function CherryPickResultModal({ cherryPickResultModal, setCherryPickResultModal }) {
  return (
    <Modal
      title="遴选推送结果"
      open={cherryPickResultModal.visible}
      onCancel={() => setCherryPickResultModal({ visible: false, success: false, results: [] })}
      footer={[
        <Button
          key="copy"
          icon={<CopyOutlined />}
          onClick={() => {
            const formatResults = () => {
              // 只复制成功的结果
              const successResults = cherryPickResultModal.results.filter(r => r.success);
              if (successResults.length === 0) {
                return '无成功的推送';
              }

              let text = '=== Git遴选推送信息 ===\n';
              successResults.forEach((result, index) => {
                text += `${index + 1}. 目标分支: ${result.targetBranch}\n`;
                text += '   状态: 推送成功\n';
              });
              return text;
            };

            const textToCopy = formatResults();
            navigator.clipboard.writeText(textToCopy).then(() => {
              message.success('已复制到剪贴板');
            }).catch((err) => {
              console.error('复制失败:', err);
              message.error('复制失败');
            });
          }}
        >
          复制信息
        </Button>,
        <Button
          key="close"
          type="primary"
          onClick={() => setCherryPickResultModal({ visible: false, success: false, results: [] })}
        >
          关闭
        </Button>
      ]}
      width={600}
      className="merge-result-modal"
    >
      <div style={{ padding: '10px 0' }}>
        <Alert
          message={cherryPickResultModal.success ? '全部推送成功' : '部分推送失败'}
          description={
            <div>
              <p style={{ marginBottom: '12px' }}>
                共处理 {cherryPickResultModal.results.length} 个目标分支
              </p>
              {cherryPickResultModal.results.map((result, index) => (
                <Card
                  key={index}
                  size="small"
                  className={`merge-result-card ${result.success ? 'success' : 'error'}`}
                  style={{ marginBottom: '12px' }}
                >
                  <div style={{ marginBottom: '8px' }}>
                    <strong>目标分支:</strong> {result.targetBranch}
                  </div>
                  {result.success && (
                    <div style={{ color: '#52c41a', marginBottom: '8px' }}>
                      {'\u2713'} 推送成功
                    </div>
                  )}
                  {result.error && (
                    <div style={{ color: '#ff4d4f' }}>
                      <strong>错误:</strong> {result.error}
                    </div>
                  )}
                  <div style={{ marginTop: '8px' }}>
                    <Tag color={result.success ? 'green' : 'red'}>
                      {result.success ? '成功' : '失败'}
                    </Tag>
                  </div>
                </Card>
              ))}
            </div>
          }
          type={cherryPickResultModal.success ? 'success' : 'warning'}
          showIcon
        />
      </div>
    </Modal>
  );
}

/**
 * 冲突检测进度 Modal
 */
export function ConflictProgressModal({ conflictProgress }) {
  return (
    <Modal
      title="检测冲突"
      open={conflictProgress.visible}
      onCancel={() => {}}
      footer={null}
      closable={false}
      maskClosable={false}
      width={500}
    >
      <div className="modal-content-padding">
        <Progress
          percent={conflictProgress.total > 0 ? Math.round((conflictProgress.current / conflictProgress.total) * 100) : 0}
          status="active"
        />
        <div className="modal-status-text" style={{ marginTop: 8 }}>
          {conflictProgress.status}
        </div>
      </div>
    </Modal>
  );
}

/**
 * 冲突检测结果 Modal
 */
export function ConflictResultModal({ conflictResultModal, setConflictResultModal }) {
  return (
    <Modal
      title="冲突检测结果"
      open={conflictResultModal.visible}
      onCancel={() => setConflictResultModal({ visible: false, results: [] })}
      footer={[
        <Button
          key="close"
          type="primary"
          onClick={() => setConflictResultModal({ visible: false, results: [] })}
        >
          关闭
        </Button>
      ]}
      width={500}
    >
      <div style={{ padding: '10px 0' }}>
        <Alert
          message={
            conflictResultModal.results.every(r => !r.hasConflict)
              ? '所有分支均无冲突'
              : '部分分支存在冲突'
          }
          type={
            conflictResultModal.results.every(r => !r.hasConflict)
              ? 'success'
              : 'warning'
          }
          showIcon
          style={{ marginBottom: 16 }}
        />
        {conflictResultModal.results.map((result, index) => (
          <Card
            key={index}
            size="small"
            style={{
              marginBottom: 8,
              borderLeft: `4px solid ${result.hasConflict ? '#ff4d4f' : '#52c41a'}`
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 500 }}>{result.targetBranch}</span>
              <Tag color={result.hasConflict ? 'error' : 'success'}>
                {result.hasConflict ? '有冲突' : '无冲突'}
              </Tag>
            </div>
          </Card>
        ))}
      </div>
    </Modal>
  );
}

/**
 * 变更检测进度 Modal
 */
export function ChangeDetectProgressModal({ changeDetectProgress }) {
  return (
    <Modal
      title="检测变更进度"
      open={changeDetectProgress.visible}
      footer={null}
      closable={false}
      width={500}
    >
      <div className="modal-content-padding" style={{ padding: '20px 0' }}>
        <Progress
          percent={changeDetectProgress.total > 0 ? Math.round((changeDetectProgress.current / changeDetectProgress.total) * 100) : 0}
          status={changeDetectProgress.current < changeDetectProgress.total ? 'active' : 'success'}
        />
        <div className="modal-status-text">
          {changeDetectProgress.status}
        </div>
      </div>
    </Modal>
  );
}

/**
 * 变更检测结果 Modal
 */
export function ChangeDetectResultModal({ changeDetectResultModal, setChangeDetectResultModal }) {
  return (
    <Modal
      title="变更检测结果"
      open={changeDetectResultModal.visible}
      onCancel={() => setChangeDetectResultModal({ visible: false, results: [], isSingleCommit: false, allExist: true, missingBySubject: {}, commitSubjects: [] })}
      footer={[
        <Button
          key="close"
          type="primary"
          onClick={() => setChangeDetectResultModal({ visible: false, results: [], isSingleCommit: false, allExist: true, missingBySubject: {}, commitSubjects: [] })}
        >
          关闭
        </Button>
      ]}
      width={550}
    >
      <div className="modal-content-padding">
        {changeDetectResultModal.allExist ? (
          // 全部存在 — 简单提示即可
          <Alert
            message="全部存在"
            description={
              changeDetectResultModal.isSingleCommit
                ? '所选提交在目标分支中均存在'
                : `所选 ${changeDetectResultModal.commitSubjects?.length || 0} 个提交在目标分支中均存在`
            }
            type="success"
            showIcon
          />
        ) : changeDetectResultModal.isSingleCommit ? (
          // 单条提交且不存在 — 按分支展示结果文本
          <div>
            <Alert
              message="部分分支不存在"
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
            />
            {changeDetectResultModal.results.map((r, i) => (
              <div key={i} style={{ marginBottom: 6, fontSize: 14 }}>
                <span style={{ fontWeight: 500 }}>{r.targetBranch}:</span>{' '}
                <span style={{ color: Object.values(r.commits || {})[0] ? 'var(--color-success)' : 'var(--color-error)', fontWeight: 500 }}>
                  {Object.values(r.commits || {})[0] ? '存在' : '不存在'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          // 多条提交且部分不存在 — 详细展示
          <>
            <Alert
              message="部分变更不存在"
              description={
                (() => {
                  const missing = Object.entries(changeDetectResultModal.missingBySubject || {});
                  return (
                    <div>
                      <p style={{ marginBottom: 8 }}>以下提交在部分目标分支中不存在：</p>
                      {missing.map(([subject, branches], i) => (
                        <div key={i} className="missing-commit-item">
                          <div className="missing-commit-subject">
                            {'\u2717'} {subject}
                          </div>
                          <div className="missing-commit-branches">
                            缺失分支: {branches.join(', ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()
              }
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
            />
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, color: 'var(--color-text-primary)' }}>各分支检测详情</div>
              {changeDetectResultModal.results.map((result, index) => (
                <Card
                  key={index}
                  size="small"
                  style={{ marginBottom: 8 }}
                >
                  <div style={{ fontWeight: 500, marginBottom: 8 }}>{result.targetBranch}</div>
                  {Object.entries(result.commits || {}).map(([subject, exists], ci) => (
                    <div key={ci} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subject}</span>
                      <Tag color={exists ? 'success' : 'error'} style={{ flexShrink: 0, marginLeft: 8 }}>
                        {exists ? '已存在' : '不存在'}
                      </Tag>
                    </div>
                  ))}
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * 版本检测进度 Modal
 */
export function VersionDetectProgressModal({ versionDetectProgress }) {
  return (
    <Modal
      title="检测版本"
      open={versionDetectProgress.visible}
      footer={null}
      closable={false}
      maskClosable={false}
      width={500}
    >
      <div className="modal-content-padding" style={{ padding: '20px 0' }}>
        <Progress
          percent={versionDetectProgress.total > 0 ? Math.round((versionDetectProgress.current / versionDetectProgress.total) * 100) : 0}
          status={versionDetectProgress.current < versionDetectProgress.total ? 'active' : 'success'}
        />
        <div className="modal-status-text">
          {versionDetectProgress.status}
        </div>
      </div>
    </Modal>
  );
}

/**
 * 版本检测结果 Modal
 */
export function VersionDetectResultModal({ versionDetectResultModal, setVersionDetectResultModal }) {
  const formatDate = (text) => {
    if (!text) return '-';
    try {
      const d = new Date(text);
      if (isNaN(d.getTime())) return text;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}/${m}/${day}`;
    } catch {
      return text;
    }
  };

  return (
    <Modal
      title="版本检测结果"
      open={versionDetectResultModal.visible}
      onCancel={() => setVersionDetectResultModal({ visible: false, results: [] })}
      footer={[
        <Button
          key="close"
          type="primary"
          onClick={() => setVersionDetectResultModal({ visible: false, results: [] })}
        >
          关闭
        </Button>
      ]}
      width={800}
    >
      <div className="modal-content-padding">
        {versionDetectResultModal.results.length === 0 ? (
          <Alert message="无检测结果" type="info" showIcon />
        ) : (
          versionDetectResultModal.results.map((branchResult, index) => {
            const data = branchResult.tags || {};

            return (
              <Card
                key={index}
                size="small"
                className="version-card"
                title={<span><BranchesOutlined style={{ marginRight: 8 }} />{branchResult.targetBranch}</span>}
                style={{ marginBottom: 12 }}
              >
                {branchResult.error ? (
                  <Alert message={`查询失败: ${branchResult.error}`} type="error" showIcon />
                ) : (
                  <Table
                    dataSource={[{
                      key: 0,
                      matchedTag: data.matchedTag?.tag || '-',
                      matchedDate: data.matchedTag?.tagDate || '-',
                      latestTag: data.latestTag?.tag || '-',
                      latestDate: data.latestTag?.tagDate || '-'
                    }]}
                    columns={[
                      {
                        title: '匹配Tag',
                        dataIndex: 'matchedTag',
                        key: 'matchedTag',
                        render: (text) => text !== '-' ? <Tag color="blue">{text}</Tag> : <span style={{ color: 'var(--color-text-tertiary)' }}>-</span>
                      },
                      {
                        title: '匹配时间',
                        dataIndex: 'matchedDate',
                        key: 'matchedDate',
                        width: 110,
                        render: (text) => formatDate(text)
                      },
                      {
                        title: '最新Tag',
                        dataIndex: 'latestTag',
                        key: 'latestTag',
                        render: (text) => text !== '-' ? <Tag color="green">{text}</Tag> : <span style={{ color: 'var(--color-text-tertiary)' }}>-</span>
                      },
                      {
                        title: '最新时间',
                        dataIndex: 'latestDate',
                        key: 'latestDate',
                        width: 110,
                        render: (text) => formatDate(text)
                      }
                    ]}
                    pagination={false}
                    size="small"
                  />
                )}
              </Card>
            );
          })
        )}
      </div>
    </Modal>
  );
}

/**
 * 分支切换 Modal
 */
export function BranchSwitcherModal({
  branchSwitcherVisible, setBranchSwitcherVisible,
  branchSearchText, setBranchSearchText,
  branches, selectedViewBranch, setSelectedViewBranch,
  setViewBranch, setSelectedCommits, setSearchText, setShowMyCommits,
  currentBranch, originalBranch
}) {
  return (
    <Modal
      title="切换分支 (仅切换视图，不切换当前分支)"
      open={branchSwitcherVisible}
      onOk={async () => {
        try {
          await window.electronAPI.git.fetch();
        } catch (e) {
          console.warn('[BranchSwitcher] fetch 失败:', e.message);
        }
        setViewBranch(selectedViewBranch);
        setSelectedCommits([]);
        setSearchText('');
        setShowMyCommits(false);
        setBranchSearchText('');
        setBranchSwitcherVisible(false);
      }}
      onCancel={() => {
        setBranchSearchText('');
        setBranchSwitcherVisible(false);
      }}
      okText="确认切换"
      cancelText="取消"
      width={500}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <Input
          placeholder="搜索分支..."
          value={branchSearchText}
          onChange={(e) => {
            setBranchSearchText(e.target.value);
          }}
          style={{ flex: 1 }}
          prefix={<SearchOutlined />}
          allowClear
        />
        <Button
          type="primary"
          icon={<SearchOutlined />}
          onClick={() => {}}
        />
      </div>
      {(() => {
        const filteredBranches = branchSearchText
          ? branches.filter(b => b.toLowerCase().includes(branchSearchText.toLowerCase()))
          : branches;

        if (filteredBranches.length === 0) {
          return (
            <div className="branch-switcher-empty">
              {branchSearchText ? '未找到匹配的分支' : '暂无可用分支'}
            </div>
          );
        }

        return (
          <div className="branch-switcher-list">
            {filteredBranches.map(branch => (
              <div
                key={branch}
                className={`branch-switcher-item ${selectedViewBranch === branch ? 'selected' : ''}`}
                onClick={() => setSelectedViewBranch(branch)}
              >
                <span className="branch-switcher-item-name">
                  <BranchesOutlined />
                  {branch}
                </span>
                <Space size="small" style={{ flexShrink: 0 }}>
                  {branch === currentBranch && (
                    <Tag color="green" style={{ margin: 0 }}>当前</Tag>
                  )}
                  {branch === originalBranch && branch !== currentBranch && (
                    <Tag color="blue" style={{ margin: 0 }}>初始</Tag>
                  )}
                </Space>
              </div>
            ))}
          </div>
        );
      })()}
    </Modal>
  );
}

import { message } from 'antd';

export const useRemoteCherryPick = ({
  selectedCommits,
  selectedRemoteRepos,
  remoteRepoBranches,
  selectedRemoteBranches,
  remoteRepos,
  sourceProjectPath,
  setLoading,
  setCherryPickProgress,
  setCherryPickResultModal,
}) => {
  const execute = async () => {
    const hasRemoteWork = selectedRemoteRepos.length > 0 &&
      selectedRemoteRepos.some(repoId => {
        const branches = selectedRemoteBranches[repoId] || [];
        return branches.length > 0;
      });

    if (!hasRemoteWork) {
      return { hasRemoteWork: false };
    }

    if (selectedCommits.length === 0) {
      message.warning('请选择要cherry-pick的提交');
      return { hasRemoteWork: true };
    }

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [useRemoteCherryPick] 开始跨仓库遴选推送`);
    console.log(`[${timestamp}] [useRemoteCherryPick] 选中的提交: ${selectedCommits.length}个`);
    console.log(`[${timestamp}] [useRemoteCherryPick] 选中的仓库: ${selectedRemoteRepos.join(', ')}`);

    const tasks = [];
    for (const repoId of selectedRemoteRepos) {
      const branches = selectedRemoteBranches[repoId] || [];
      for (const branch of branches) {
        tasks.push({ repoId, branch });
      }
    }

    const totalOperations = tasks.length;
    const results = [];

    setCherryPickProgress(prev => ({
      ...prev,
      visible: true,
      current: 0,
      total: totalOperations * 2,
      status: '正在准备跨仓库遴选推送...',
      results: []
    }));

    try {
      for (let i = 0; i < tasks.length; i++) {
        const { repoId, branch } = tasks[i];
        const repo = remoteRepos.find(r => r.id === repoId);
        const repoName = repo ? repo.name : repoId;
        const currentOp = i + 1;
        const opTimestamp = new Date().toISOString();

        console.log(`[${opTimestamp}] [useRemoteCherryPick] 处理 ${currentOp}/${totalOperations}: ${repoName} -> ${branch}`);

        setCherryPickProgress(prev => ({
          ...prev,
          status: `准备仓库 ${currentOp}/${totalOperations}: ${repoName} (${branch})`
        }));

        const cloneResult = await window.electronAPI.remoteRepos.clone({ url: repo.url, repoId: repo.id });
        if (!cloneResult.success) {
          console.error(`[${opTimestamp}] [useRemoteCherryPick] clone 失败: ${cloneResult.error}`);
          results.push({
            success: false,
            targetBranch: `${repoName}/${branch}`,
            error: `仓库准备失败: ${cloneResult.error}`
          });
          setCherryPickProgress(prev => ({
            ...prev,
            current: currentOp * 2,
            results: [...results]
          }));
          continue;
        }

        const { repoPath } = cloneResult;

        setCherryPickProgress(prev => ({
          ...prev,
          current: currentOp,
          status: `Cherry-pick + 推送 ${currentOp}/${totalOperations}: ${repoName} (${branch})`
        }));

        const cpResult = await window.electronAPI.remoteRepos.cherryPickPush({
          repoPath,
          branch,
          commitShas: [...selectedCommits],
          sourceProjectPath
        });

        if (cpResult.success) {
          const skippedCount = (cpResult.results?.skipped || []).length;
          let msg = `成功推送到 ${repoName}/${branch}`;
          if (skippedCount > 0) {
            msg += ` (${skippedCount}个提交已存在)`;
          }
          results.push({
            success: true,
            targetBranch: `${repoName}/${branch}`,
            message: msg
          });
          console.log(`[${opTimestamp}] [useRemoteCherryPick] 成功: ${repoName}/${branch}`);
        } else {
          const errorDetail = cpResult.error ||
            (cpResult.results?.errors || []).map(e => `${e.sha}: ${e.error}`).join('; ') ||
            (cpResult.results?.errors || []).map(e => `${e.sha}: ${e.detail}`).join('; ') ||
            'Cherry-pick 失败';
          results.push({
            success: false,
            targetBranch: `${repoName}/${branch}`,
            error: errorDetail
          });
          console.error(`[${opTimestamp}] [useRemoteCherryPick] 失败: ${repoName}/${branch} - ${errorDetail}`);
        }

        setCherryPickProgress(prev => ({
          ...prev,
          current: currentOp * 2,
          results: [...results]
        }));
      }

      const finalTimestamp = new Date().toISOString();
      console.log(`[${finalTimestamp}] [useRemoteCherryPick] 所有操作完成`);

      setCherryPickProgress(prev => ({
        ...prev,
        visible: false
      }));

      return { hasRemoteWork: true, results };
    } catch (error) {
      const errorTimestamp = new Date().toISOString();
      console.error(`[${errorTimestamp}] [useRemoteCherryPick] 失败:`, error);
      setCherryPickProgress(prev => ({
        ...prev,
        visible: false
      }));
      return { hasRemoteWork: true, results, error: error.message };
    }
  };

  return execute;
};

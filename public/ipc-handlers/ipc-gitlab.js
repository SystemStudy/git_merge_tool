/**
 * GitLab 相关 IPC handlers
 */
const axios = require('axios');

module.exports = function registerGitLabHandlers(ipcMain) {
  ipcMain.handle('gitlab-test-token', async (event, serverUrl, token) => {
    try {
      const response = await axios.get(`${serverUrl}/api/v4/user`, {
        headers: { 'PRIVATE-TOKEN': token },
        timeout: 10000
      });
      return { success: true, user: response.data };
    } catch (error) {
      let errorMessage = '令牌验证失败';
      if (error.response) {
        switch (error.response.status) {
          case 401: errorMessage = '令牌无效或已过期'; break;
          case 403: errorMessage = '没有访问权限'; break;
          case 404: errorMessage = 'GitLab服务器地址错误'; break;
          default: errorMessage = `服务器错误: ${error.response.status}`;
        }
      } else if (error.request) {
        errorMessage = '网络连接失败';
      }
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('gitlab-get-project-id', async (event, serverUrl, token, projectPath) => {
    try {
      const encodedPath = encodeURIComponent(projectPath);
      const response = await axios.get(`${serverUrl}/api/v4/projects/${encodedPath}`, {
        headers: { 'PRIVATE-TOKEN': token },
        timeout: 10000
      });
      return { success: true, projectId: response.data.id };
    } catch (error) {
      console.error('[gitlab-get-project-id] 错误:', error.response?.data || error.message);
      return { success: false, error: error.response?.data?.message || error.message };
    }
  });

  ipcMain.handle('gitlab-create-merge-request', async (event, serverUrl, token, projectId, sourceBranch, targetBranch, title, description, removeSourceBranch = true) => {
    try {
      // projectId 可以是数字 ID 或 URL 编码的项目路径
      const response = await axios.post(
        `${serverUrl}/api/v4/projects/${projectId}/merge_requests`,
        {
          source_branch: sourceBranch,
          target_branch: targetBranch,
          title: title,
          description: description,
          remove_source_branch: removeSourceBranch
        },
        {
          headers: { 'PRIVATE-TOKEN': token },
          timeout: 30000
        }
      );
      console.log('[gitlab-create-merge-request] 合并请求创建成功，源分支将被删除:', removeSourceBranch);
      return { success: true, mergeRequest: response.data };
    } catch (error) {
      console.error('[gitlab-create-merge-request] 错误:', error.response?.data || error.message);
      return { success: false, error: error.response?.data?.message || error.message };
    }
  });
};

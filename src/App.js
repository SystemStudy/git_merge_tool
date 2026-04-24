import React, { useState, useEffect } from 'react';
import { Layout, message } from 'antd';
import WelcomePage from './components/WelcomePage';
import MainWorkspace from './components/MainWorkspace';
import './App.css';

const { Content } = Layout;

function App() {
  const [currentProject, setCurrentProject] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // 监听主进程的项目打开事件
    const handleProjectOpened = (data) => {
      setCurrentProject(data);
      message.success(`已打开项目: ${data.info.name}`);
    };

    if (window.electronAPI) {
      window.electronAPI.on('project-opened', handleProjectOpened);
    }

    return () => {
      if (window.electronAPI) {
        window.electronAPI.removeAllListeners('project-opened');
      }
    };
  }, []);

  const handleProjectSelect = async (projectPath) => {
    setLoading(true);
    try {
      const result = await window.electronAPI.projects.open(projectPath);
      if (!result.success) {
        message.error(result.error || '打开项目失败');
      }
    } catch (error) {
      message.error('打开项目失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCloseProject = () => {
    setCurrentProject(null);
  };

  return (
    <Layout className="app-layout">
      <Content className="app-content">
        {currentProject ? (
          <MainWorkspace 
            project={currentProject} 
            onClose={handleCloseProject}
          />
        ) : (
          <WelcomePage 
            onProjectSelect={handleProjectSelect}
            loading={loading}
          />
        )}
      </Content>
    </Layout>
  );
}

export default App;

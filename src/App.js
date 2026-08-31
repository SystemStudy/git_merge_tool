import React, { useState, useEffect } from 'react';
import { Layout, message, ConfigProvider } from 'antd';
import WelcomePage from './components/WelcomePage';
import MainWorkspace from './components/MainWorkspace';
import CustomTitleBar from './components/CustomTitleBar';
import UpdateManager from './components/UpdateManager';
import './App.css';

const { Content } = Layout;

function App() {
  const [currentProject, setCurrentProject] = useState(null);
  const [loading, setLoading] = useState(false);
  const [themeColor, setThemeColor] = useState('#4F46E5');

  useEffect(() => {
    // 监听主进程的项目打开事件
    const handleProjectOpened = (data) => {
      setCurrentProject(data);
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

  useEffect(() => {
    (async () => {
      try {
        const settings = await window.electronAPI.settings.get();
        if (settings && settings.themeColor) {
          setThemeColor(settings.themeColor);
        }
      } catch (e) {
        // 忽略：使用默认色
      }
    })();
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
    <ConfigProvider theme={{ token: { colorPrimary: themeColor, colorInfo: themeColor } }}>
      <UpdateManager />
      <Layout className="app-layout">
        <CustomTitleBar projectName={currentProject?.info?.name} />
        <Content className="app-content">
          {currentProject ? (
            <MainWorkspace 
              project={currentProject} 
              onClose={handleCloseProject}
              onThemeColorChange={setThemeColor}
            />
          ) : (
            <WelcomePage 
              onProjectSelect={handleProjectSelect}
              loading={loading}
              onThemeColorChange={setThemeColor}
            />
          )}
        </Content>
      </Layout>
    </ConfigProvider>
  );
}

export default App;

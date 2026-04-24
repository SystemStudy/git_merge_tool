# Git合并辅助工具 - Electron + React 版本

基于 Electron 和 React 技术栈开发的 Git 合并辅助桌面应用程序，完整迁移原 landray-idea-webstorm 插件功能。

## 功能特性

### 核心功能
- **可视化分支合并界面** - 直观查看和管理 Git 分支
- **智能提交历史管理** - 分页加载、搜索过滤、作者筛选
- **多目标分支支持** - 支持同时向多个分支创建合并分支
- **GitLab 深度集成** - 自动创建合并请求(MR)
- **Cherry-pick 功能** - 精确选择提交进行合并，支持批量操作
- **智能 Stash 管理** - 自动检测、创建、恢复未提交更改
- **冲突检测** - 提前检测合并冲突

### 项目管理
- **目录选择** - 从本地文件系统选择 Git 项目目录
- **项目记忆** - 自动记录最近打开的项目
- **快速访问** - 从历史记录快速重新打开项目
- **记录管理** - 支持删除项目记录（不影响本地文件）

## 技术栈

- **Electron** - 跨平台桌面应用框架
- **React 18** - 用户界面开发
- **Ant Design** - UI 组件库
- **simple-git** - Git 操作库
- **electron-store** - 本地数据持久化

## 安装和运行

### 开发环境

```bash
# 进入项目目录
cd git-merge-assistant

# 安装依赖
npm install

# 启动开发服务器（同时启动 React 和 Electron）
npm run electron-dev
```

### 生产构建

```bash
# 构建 Windows 安装包
npm run electron-build-win

# 构建 Windows 便携版
npm run electron-build-win-portable

# 构建 macOS DMG 安装包
npm run electron-build-mac-dmg

# 构建 macOS 应用（DMG + ZIP）
npm run electron-build-mac

# 构建所有平台
npm run electron-pack
```

构建完成后，安装包位于 `dist` 目录：
- **Windows**
  - `Git合并辅助 Setup 1.5.2.exe` - 安装程序
  - `Git合并辅助-便携版-1.5.2.exe` - 便携版（无需安装）
- **macOS**
  - `LandrayGitTool-1.5.2.dmg` - DMG 安装包
  - `LandrayGitTool-1.5.2-mac.zip` - ZIP 压缩包

## 使用说明

### 首次使用

1. 启动应用后，点击"选择项目目录"按钮
2. 在文件浏览器中选择一个 Git 仓库目录
3. 应用会自动加载项目信息并显示提交历史

### 主要操作流程

1. **选择提交** - 在提交列表中勾选要合并的提交
2. **选择合并类型** - 提测/入库/Bug提测/自定义/临时选择
3. **选择目标分支** - 勾选要合并到的目标分支
4. **执行操作** - 点击"遴选&Push"或"创建合并分支"

### 设置配置

点击右上角的"设置"按钮，可以配置：

- **GitLab 设置** - 服务器地址和访问令牌
- **分支配置** - 各类型对应的目标分支列表
- **常规设置** - 业务线、默认选项等

### 菜单功能

- **文件** → 打开项目 / 刷新 / 退出
- **Git 操作** → Fetch / Pull
- **设置** → 应用设置
- **帮助** → 使用说明 / 关于

## 项目结构

```
git-merge-assistant/
├── public/                 # 静态资源
│   ├── electron.js        # Electron 主进程
│   ├── preload.js         # 预加载脚本
│   └── index.html         # HTML 模板
├── src/
│   ├── components/        # React 组件
│   │   ├── WelcomePage.js # 欢迎页面（项目选择）
│   │   └── MainWorkspace.js # 主工作区
│   ├── App.js             # 应用入口
│   ├── index.js           # 渲染进程入口
│   └── index.css          # 全局样式
├── package.json           # 项目配置
└── README.md              # 说明文档
```

## 与原插件功能对比

| 功能 | 原 IDEA 插件 | Electron 版本 |
|------|-------------|---------------|
| 项目选择 | WebStorm 工作空间 | 文件系统目录选择 |
| 项目记忆 | IDE 最近项目 | electron-store 持久化 |
| 分支管理 | ✓ | ✓ |
| 提交历史 | ✓ | ✓ |
| Cherry-pick | ✓ | ✓ |
| 创建合并分支 | ✓ | ✓ |
| GitLab MR | ✓ | ✓ |
| 冲突检测 | ✓ | ✓ |
| Stash 管理 | ✓ | ✓ |

## 系统要求

### Windows
- Windows 10 或更高版本
- 已安装 Git
- 网络连接（用于 GitLab 集成）

### macOS
- macOS 10.13 (High Sierra) 或更高版本
- 已安装 Git
- 网络连接（用于 GitLab 集成）

## 注意事项

1. **删除项目记录** - 仅移除软件中的记录，不会删除本地实际项目文件
2. **GitLab 令牌** - 需要具有 `api` 权限的 Personal Access Token
3. **首次使用** - 建议先配置 GitLab 设置以使用完整功能

## 开发计划

- [ ] 深色主题支持
- [ ] 多语言支持
- [ ] 更多 Git 托管平台集成（GitHub、Gitee 等）
- [ ] 提交对比视图
- [ ] 分支图形化展示

## 许可证

MIT License

## 作者

蓝凌软件

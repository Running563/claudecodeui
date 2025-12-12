# Git 功能 (Source Control) 前后端实现架构

## 📋 目录

1. [整体架构](#整体架构)
2. [核心功能模块](#核心功能模块)
3. [Git 状态管理](#git-状态管理)
4. [文件差异对比](#文件差异对比)
5. [提交流程](#提交流程)
6. [分支管理](#分支管理)
7. [远程仓库操作](#远程仓库操作)
8. [AI 生成提交信息](#ai-生成提交信息)
9. [安全机制](#安全机制)
10. [数据流图](#数据流图)

---

## 🏗️ 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           前端 (React)                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                      GitPanel.jsx                                  │ │
│  │  ┌───────────────┐  ┌───────────────┐  ┌────────────────────┐    │ │
│  │  │ 状态管理       │  │ 分支管理       │  │ 远程仓库管理        │    │ │
│  │  │ - gitStatus   │  │ - branches    │  │ - remoteStatus     │    │ │
│  │  │ - selectedFiles│  │ - currentBranch│  │ - ahead/behind   │    │ │
│  │  │ - gitDiff     │  │ - branch ops  │  │ - push/pull/fetch  │    │ │
│  │  └───────────────┘  └───────────────┘  └────────────────────┘    │ │
│  │                                                                    │ │
│  │  ┌──────────────────────────────────────────────────────────┐    │ │
│  │  │                 提交区域                                   │    │ │
│  │  │  - commitMessage (textarea)                              │    │ │
│  │  │  - AI 生成提交信息 (使用 Claude/Cursor)                   │    │ │
│  │  │  - 文件选择 (checkbox)                                    │    │ │
│  │  └──────────────────────────────────────────────────────────┘    │ │
│  │                                                                    │ │
│  │  ┌──────────────────────────────────────────────────────────┐    │ │
│  │  │              DiffViewer.jsx (代码差异)                     │    │ │
│  │  │  - 使用 diff2html 渲染 diff                               │    │ │
│  │  │  - 支持 side-by-side / line-by-line 模式                  │    │ │
│  │  └──────────────────────────────────────────────────────────┘    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│                   ▼ HTTP/HTTPS (authenticatedFetch)                      │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────┐
│                         后端 (Node.js + Express)                          │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                    /api/git/* Routes                             │    │
│  │                                                                  │    │
│  │  GET  /status          - 获取 Git 状态                           │    │
│  │  GET  /diff            - 获取文件差异                            │    │
│  │  GET  /file-with-diff  - 获取文件内容 + Diff 信息               │    │
│  │  POST /commit          - 提交更改                                │    │
│  │  POST /initial-commit  - 创建初始提交                           │    │
│  │  GET  /branches        - 获取分支列表                           │    │
│  │  POST /checkout        - 切换分支                                │    │
│  │  POST /create-branch   - 创建分支                                │    │
│  │  GET  /commits         - 获取提交历史                            │    │
│  │  GET  /commit-diff     - 获取提交差异                            │    │
│  │  POST /generate-commit-message - AI 生成提交信息                │    │
│  │  GET  /remote-status   - 获取远程状态                            │    │
│  │  POST /fetch           - 从远程拉取                              │    │
│  │  POST /pull            - 拉取并合并                              │    │
│  │  POST /push            - 推送到远程                              │    │
│  │  POST /publish         - 发布分支到远程                          │    │
│  │  POST /discard         - 丢弃更改                                │    │
│  │  POST /delete-untracked - 删除未跟踪文件                         │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                  ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │             Git 命令执行层 (child_process.exec)                  │    │
│  │                                                                  │    │
│  │  - 路径验证 (validateGitRepository)                              │    │
│  │  - 路径解析 (extractProjectDirectory)                           │    │
│  │  - Diff 头部清理 (stripDiffHeaders)                              │    │
│  │  - 提交信息清理 (cleanCommitMessage)                             │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                  ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                 AI 集成 (Claude SDK / Cursor CLI)                │    │
│  │                                                                  │    │
│  │  - generateCommitMessageWithAI()                                │    │
│  │  - queryClaudeSDK() / spawnCursor()                             │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────┐
│                         系统 Git 命令层                                     │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────┐    │
│  │                         Git CLI 命令                               │    │
│  │                                                                   │    │
│  │  git status --porcelain        - 获取简洁的状态信息              │    │
│  │  git diff -- <file>            - 获取工作区差异                   │    │
│  │  git diff --cached -- <file>   - 获取暂存区差异                   │    │
│  │  git add <file>                - 暂存文件                         │    │
│  │  git commit -m "<msg>"         - 提交更改                         │    │
│  │  git branch -a                 - 列出所有分支                     │    │
│  │  git checkout <branch>         - 切换分支                         │    │
│  │  git checkout -b <branch>      - 创建并切换分支                   │    │
│  │  git log --pretty=format       - 获取提交历史                     │    │
│  │  git show <commit>             - 显示提交详情                     │    │
│  │  git fetch <remote>            - 从远程获取                       │    │
│  │  git pull <remote> <branch>    - 拉取并合并                       │    │
│  │  git push <remote> <branch>    - 推送到远程                       │    │
│  │  git restore <file>            - 丢弃工作区更改                   │    │
│  │  git rev-parse --show-toplevel - 获取仓库根目录                   │    │
│  └───────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🎯 核心功能模块

### 1. 状态管理
- **Git 状态**: 追踪修改、添加、删除、未跟踪文件
- **文件选择**: 多选复选框，支持全选/取消全选
- **视图切换**: Changes (更改) / History (历史)

### 2. 文件差异对比
- **Diff 渲染**: 使用 `diff2html` 库
- **多种模式**: Side-by-side、Line-by-line
- **语法高亮**: 支持多种编程语言

### 3. 提交管理
- **手动提交**: 用户输入提交信息
- **AI 生成**: 使用 Claude/Cursor 自动生成规范的提交信息
- **初始提交**: 一键创建初始提交

### 4. 分支管理
- **列出分支**: 本地 + 远程分支
- **切换分支**: 快速切换到其他分支
- **创建分支**: 新建分支并切换

### 5. 远程仓库操作
- **Fetch**: 获取远程更新
- **Pull**: 拉取并合并远程更改
- **Push**: 推送本地提交到远程
- **Publish**: 发布本地分支到远程

---

## 📊 Git 状态管理

### 前端实现 (`GitPanel.jsx:78-123`)

```javascript
const fetchGitStatus = async () => {
  setIsLoading(true);
  try {
    // 1. 调用后端 API 获取 Git 状态
    const response = await authenticatedFetch(
      `/api/git/status?project=${encodeURIComponent(selectedProject.name)}`
    );
    const data = await response.json();
    
    // 2. 处理错误或设置状态
    if (data.error) {
      setGitStatus({ error: data.error, details: data.details });
    } else {
      setGitStatus(data);
      setCurrentBranch(data.branch || 'main');
      
      // 3. 自动选择所有更改的文件
      const allFiles = new Set([
        ...(data.modified || []),
        ...(data.added || []),
        ...(data.deleted || []),
        ...(data.untracked || [])
      ]);
      setSelectedFiles(allFiles);
      
      // 4. 批量获取文件差异
      for (const file of data.modified || []) {
        fetchFileDiff(file);
      }
      // ... 其他文件类型
    }
  } catch (error) {
    console.error('Error fetching git status:', error);
  } finally {
    setIsLoading(false);
  }
};
```

### 后端实现 (`git.js:81-154`)

```javascript
router.get('/status', async (req, res) => {
  const { project } = req.query;
  
  try {
    // 1. 解析项目路径
    const projectPath = await getActualProjectPath(project);
    
    // 2. 验证是否为 Git 仓库
    await validateGitRepository(projectPath);
    
    // 3. 获取当前分支名称
    let branch = 'main';
    let hasCommits = true;
    try {
      const { stdout: branchOutput } = await execAsync(
        'git rev-parse --abbrev-ref HEAD', 
        { cwd: projectPath }
      );
      branch = branchOutput.trim();
    } catch (error) {
      // 仓库没有提交 - 处理 HEAD 不存在的情况
      if (error.message.includes('unknown revision')) {
        hasCommits = false;
        branch = 'main';
      }
    }
    
    // 4. 执行 git status --porcelain 获取状态
    const { stdout: statusOutput } = await execAsync(
      'git status --porcelain', 
      { cwd: projectPath }
    );
    
    // 5. 解析 porcelain 格式的状态输出
    const modified = [];
    const added = [];
    const deleted = [];
    const untracked = [];
    
    statusOutput.split('\n').forEach(line => {
      if (!line.trim()) return;
      
      const status = line.substring(0, 2);  // 前两个字符是状态码
      const file = line.substring(3);       // 文件路径从第4个字符开始
      
      // 状态码解析:
      // M  = 修改 (staged)
      //  M = 修改 (unstaged)
      // MM = 修改 (staged + unstaged)
      // A  = 新增 (staged)
      // D  = 删除
      // ?? = 未跟踪
      if (status === 'M ' || status === ' M' || status === 'MM') {
        modified.push(file);
      } else if (status === 'A ' || status === 'AM') {
        added.push(file);
      } else if (status === 'D ' || status === ' D') {
        deleted.push(file);
      } else if (status === '??') {
        untracked.push(file);
      }
    });
    
    // 6. 返回结构化的状态信息
    res.json({
      branch,
      hasCommits,
      modified,
      added,
      deleted,
      untracked
    });
  } catch (error) {
    console.error('Git status error:', error);
    res.json({
      error: error.message,
      details: error.message
    });
  }
});
```

### Git Porcelain 格式说明

```
格式: XY PATH
其中:
  X = 暂存区状态
  Y = 工作区状态

常见状态码:
  ' ' = 未修改
  M = 修改
  A = 添加
  D = 删除
  R = 重命名
  C = 复制
  U = 未合并
  ? = 未跟踪

示例:
  M  README.md    -> 修改已暂存
   M README.md    -> 修改未暂存
  MM README.md    -> 修改已暂存+工作区又有修改
  A  newfile.js   -> 新文件已暂存
  ?? temp.txt     -> 未跟踪文件
  D  old.js       -> 文件已删除
```

---

## 🔍 文件差异对比

### 获取文件 Diff

#### 前端调用 (`GitPanel.jsx:408-422`)

```javascript
const fetchFileDiff = async (filePath) => {
  try {
    const response = await authenticatedFetch(
      `/api/git/diff?project=${encodeURIComponent(selectedProject.name)}&file=${encodeURIComponent(filePath)}`
    );
    const data = await response.json();
    
    if (!data.error && data.diff) {
      setGitDiff(prev => ({
        ...prev,
        [filePath]: data.diff  // 以文件路径为 key 存储 diff
      }));
    }
  } catch (error) {
    console.error('Error fetching file diff:', error);
  }
};
```

#### 后端实现 (`git.js:157-216`)

```javascript
router.get('/diff', async (req, res) => {
  const { project, file } = req.query;
  
  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);
    
    // 1. 检查文件状态
    const { stdout: statusOutput } = await execAsync(
      `git status --porcelain "${file}"`, 
      { cwd: projectPath }
    );
    const isUntracked = statusOutput.startsWith('??');
    const isDeleted = statusOutput.trim().startsWith('D ');
    
    let diff;
    
    // 2. 未跟踪文件 - 生成添加 diff
    if (isUntracked) {
      const filePath = path.join(projectPath, file);
      const stats = await fs.stat(filePath);
      
      if (stats.isDirectory()) {
        diff = `Directory: ${file}\n(Cannot show diff for directories)`;
      } else {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const lines = fileContent.split('\n');
        // 格式化为 unified diff 格式
        diff = `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n` +
               lines.map(line => `+${line}`).join('\n');
      }
    } 
    // 3. 已删除文件 - 显示删除 diff
    else if (isDeleted) {
      const { stdout: fileContent } = await execAsync(
        `git show HEAD:"${file}"`, 
        { cwd: projectPath }
      );
      const lines = fileContent.split('\n');
      diff = `--- a/${file}\n+++ /dev/null\n@@ -1,${lines.length} +0,0 @@\n` +
             lines.map(line => `-${line}`).join('\n');
    } 
    // 4. 跟踪文件 - 获取实际 diff
    else {
      // 优先显示未暂存的更改
      const { stdout: unstagedDiff } = await execAsync(
        `git diff -- "${file}"`, 
        { cwd: projectPath }
      );
      
      if (unstagedDiff) {
        diff = stripDiffHeaders(unstagedDiff);
      } else {
        // 如果没有未暂存更改，检查已暂存的更改
        const { stdout: stagedDiff } = await execAsync(
          `git diff --cached -- "${file}"`, 
          { cwd: projectPath }
        );
        diff = stripDiffHeaders(stagedDiff) || '';
      }
    }
    
    res.json({ diff });
  } catch (error) {
    console.error('Git diff error:', error);
    res.json({ error: error.message });
  }
});
```

### Diff 头部清理 (`git.js:24-51`)

```javascript
function stripDiffHeaders(diff) {
  if (!diff) return '';
  
  const lines = diff.split('\n');
  const filteredLines = [];
  let startIncluding = false;
  
  // 移除 git diff 头部信息，只保留实际的差异内容
  for (const line of lines) {
    // 跳过以下头部行:
    // diff --git a/file b/file
    // index abc123..def456 100644
    // --- a/file
    // +++ b/file
    if (line.startsWith('diff --git') ||
        line.startsWith('index ') ||
        line.startsWith('new file mode') ||
        line.startsWith('deleted file mode') ||
        line.startsWith('---') ||
        line.startsWith('+++')) {
      continue;
    }
    
    // 从 @@ hunk 头开始包含
    if (line.startsWith('@@') || startIncluding) {
      startIncluding = true;
      filteredLines.push(line);
    }
  }
  
  return filteredLines.join('\n');
}
```

### DiffViewer 组件 (`DiffViewer.jsx`)

```javascript
import React, { useEffect, useRef } from 'react';
import * as Diff2Html from 'diff2html';
import 'diff2html/bundles/css/diff2html.min.css';

function DiffViewer({ diff, wrapText = true }) {
  const diffContainerRef = useRef(null);
  
  useEffect(() => {
    if (!diff || !diffContainerRef.current) return;
    
    try {
      // 1. 解析 unified diff 格式
      const diffJson = Diff2Html.parse(diff);
      
      // 2. 渲染为 HTML
      const diffHtml = Diff2Html.html(diffJson, {
        drawFileList: false,           // 不显示文件列表
        matching: 'lines',             // 行匹配模式
        outputFormat: 'side-by-side',  // 并排模式
        renderNothingWhenEmpty: true,
        maxLineLengthHighlight: 10000,
        fileContentToggle: false,
        synchronisedScroll: true
      });
      
      // 3. 插入到容器
      diffContainerRef.current.innerHTML = diffHtml;
      
      // 4. 应用文本换行设置
      if (wrapText) {
        diffContainerRef.current.querySelectorAll('.d2h-code-line-ctn').forEach(el => {
          el.style.whiteSpace = 'pre-wrap';
          el.style.wordBreak = 'break-word';
        });
      }
    } catch (error) {
      console.error('Error rendering diff:', error);
      diffContainerRef.current.innerHTML = '<pre>' + diff + '</pre>';
    }
  }, [diff, wrapText]);
  
  return <div ref={diffContainerRef} className="diff-viewer" />;
}

export default DiffViewer;
```

---

## 💾 提交流程

### 手动提交

#### 前端实现 (`GitPanel.jsx:549-579`)

```javascript
const handleCommit = async () => {
  if (!commitMessage.trim() || selectedFiles.size === 0) return;
  
  setIsCommitting(true);
  try {
    // 1. 发送提交请求
    const response = await authenticatedFetch('/api/git/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: selectedProject.name,
        message: commitMessage,
        files: Array.from(selectedFiles)  // 只提交选中的文件
      })
    });
    
    const data = await response.json();
    if (data.success) {
      // 2. 重置状态
      setCommitMessage('');
      setSelectedFiles(new Set());
      
      // 3. 刷新 Git 状态和远程状态
      fetchGitStatus();
      fetchRemoteStatus();
    } else {
      console.error('Commit failed:', data.error);
    }
  } catch (error) {
    console.error('Error committing changes:', error);
  } finally {
    setIsCommitting(false);
  }
};
```

#### 后端实现 (`git.js:326-352`)

```javascript
router.post('/commit', async (req, res) => {
  const { project, message, files } = req.body;
  
  if (!project || !message || !files || files.length === 0) {
    return res.status(400).json({ 
      error: 'Project name, commit message, and files are required' 
    });
  }
  
  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);
    
    // 1. 逐个暂存选中的文件
    for (const file of files) {
      await execAsync(`git add "${file}"`, { cwd: projectPath });
    }
    
    // 2. 执行提交 (转义引号)
    const { stdout } = await execAsync(
      `git commit -m "${message.replace(/"/g, '\\"')}"`, 
      { cwd: projectPath }
    );
    
    res.json({ success: true, output: stdout });
  } catch (error) {
    console.error('Git commit error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

### 初始提交

#### 前端实现 (`GitPanel.jsx:581-599`)

```javascript
const createInitialCommit = async () => {
  setIsCreatingInitialCommit(true);
  try {
    const response = await authenticatedFetch('/api/git/initial-commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: selectedProject.name
      })
    });
    
    const data = await response.json();
    if (data.success) {
      fetchGitStatus();
      fetchRemoteStatus();
    } else {
      alert(data.error || 'Failed to create initial commit');
    }
  } catch (error) {
    console.error('Error creating initial commit:', error);
  } finally {
    setIsCreatingInitialCommit(false);
  }
};
```

#### 后端实现 (`git.js:282-323`)

```javascript
router.post('/initial-commit', async (req, res) => {
  const { project } = req.body;
  
  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);
    
    // 1. 检查是否已经有提交
    try {
      await execAsync('git rev-parse HEAD', { cwd: projectPath });
      return res.status(400).json({ 
        error: 'Repository already has commits. Use regular commit instead.' 
      });
    } catch (error) {
      // 没有 HEAD - 可以创建初始提交
    }
    
    // 2. 添加所有文件
    await execAsync('git add .', { cwd: projectPath });
    
    // 3. 创建初始提交
    const { stdout } = await execAsync(
      'git commit -m "Initial commit"', 
      { cwd: projectPath }
    );
    
    res.json({ 
      success: true, 
      output: stdout, 
      message: 'Initial commit created successfully' 
    });
  } catch (error) {
    console.error('Git initial commit error:', error);
    
    // 处理没有文件可提交的情况
    if (error.message.includes('nothing to commit')) {
      return res.status(400).json({
        error: 'Nothing to commit',
        details: 'No files found in the repository. Add some files first.'
      });
    }
    
    res.status(500).json({ error: error.message });
  }
});
```

---

## 🌿 分支管理

### 获取分支列表

#### 后端实现 (`git.js:354-394`)

```javascript
router.get('/branches', async (req, res) => {
  const { project } = req.query;
  
  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);
    
    // 1. 获取所有分支 (本地 + 远程)
    const { stdout } = await execAsync('git branch -a', { cwd: projectPath });
    
    // 2. 解析分支列表
    const branches = stdout
      .split('\n')
      .map(branch => branch.trim())
      .filter(branch => branch && !branch.includes('->')) // 移除 HEAD 指针
      .map(branch => {
        // 移除当前分支的星号标记
        if (branch.startsWith('* ')) {
          return branch.substring(2);
        }
        // 移除远程分支前缀
        if (branch.startsWith('remotes/origin/')) {
          return branch.substring(15);
        }
        return branch;
      })
      .filter((branch, index, self) => self.indexOf(branch) === index); // 去重
    
    res.json({ branches });
  } catch (error) {
    console.error('Git branches error:', error);
    res.json({ error: error.message });
  }
});
```

### 切换分支

#### 前端实现 (`GitPanel.jsx:156-178`)

```javascript
const switchBranch = async (branchName) => {
  try {
    const response = await authenticatedFetch('/api/git/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: selectedProject.name,
        branch: branchName
      })
    });
    
    const data = await response.json();
    if (data.success) {
      setCurrentBranch(branchName);
      setShowBranchDropdown(false);
      fetchGitStatus(); // 刷新状态
    } else {
      console.error('Failed to switch branch:', data.error);
    }
  } catch (error) {
    console.error('Error switching branch:', error);
  }
};
```

#### 后端实现 (`git.js:396-415`)

```javascript
router.post('/checkout', async (req, res) => {
  const { project, branch } = req.body;
  
  if (!project || !branch) {
    return res.status(400).json({ 
      error: 'Project name and branch are required' 
    });
  }
  
  try {
    const projectPath = await getActualProjectPath(project);
    
    // 切换到指定分支
    const { stdout } = await execAsync(
      `git checkout "${branch}"`, 
      { cwd: projectPath }
    );
    
    res.json({ success: true, output: stdout });
  } catch (error) {
    console.error('Git checkout error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

### 创建新分支

#### 后端实现 (`git.js:417-436`)

```javascript
router.post('/create-branch', async (req, res) => {
  const { project, branch } = req.body;
  
  if (!project || !branch) {
    return res.status(400).json({ 
      error: 'Project name and branch name are required' 
    });
  }
  
  try {
    const projectPath = await getActualProjectPath(project);
    
    // 创建并切换到新分支
    const { stdout } = await execAsync(
      `git checkout -b "${branch}"`, 
      { cwd: projectPath }
    );
    
    res.json({ success: true, output: stdout });
  } catch (error) {
    console.error('Git create branch error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

---

## 🌐 远程仓库操作

### 远程状态检测

#### 后端实现 (`git.js:714-783`)

```javascript
router.get('/remote-status', async (req, res) => {
  const { project } = req.query;
  
  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);
    
    // 1. 获取当前分支
    const { stdout: currentBranch } = await execAsync(
      'git rev-parse --abbrev-ref HEAD', 
      { cwd: projectPath }
    );
    const branch = currentBranch.trim();
    
    // 2. 智能检测远程跟踪分支
    let trackingBranch;
    let remoteName;
    try {
      const { stdout } = await execAsync(
        `git rev-parse --abbrev-ref ${branch}@{upstream}`, 
        { cwd: projectPath }
      );
      trackingBranch = stdout.trim();
      remoteName = trackingBranch.split('/')[0]; // 提取远程名 (e.g., "origin")
    } catch (error) {
      // 没有配置上游分支 - 检查是否有 remote
      let hasRemote = false;
      let remoteName = null;
      try {
        const { stdout } = await execAsync('git remote', { cwd: projectPath });
        const remotes = stdout.trim().split('\n').filter(r => r.trim());
        if (remotes.length > 0) {
          hasRemote = true;
          remoteName = remotes.includes('origin') ? 'origin' : remotes[0];
        }
      } catch (remoteError) {
        // 没有配置 remote
      }
      
      return res.json({ 
        hasRemote,
        hasUpstream: false,
        branch,
        remoteName,
        message: 'No remote tracking branch configured'
      });
    }
    
    // 3. 获取 ahead/behind 计数
    const { stdout: countOutput } = await execAsync(
      `git rev-list --count --left-right ${trackingBranch}...HEAD`,
      { cwd: projectPath }
    );
    
    const [behind, ahead] = countOutput.trim().split('\t').map(Number);
    
    res.json({
      hasRemote: true,
      hasUpstream: true,
      branch,
      remoteBranch: trackingBranch,
      remoteName,
      ahead: ahead || 0,      // 本地领先的提交数
      behind: behind || 0,    // 本地落后的提交数
      isUpToDate: ahead === 0 && behind === 0
    });
  } catch (error) {
    console.error('Git remote status error:', error);
    res.json({ error: error.message });
  }
});
```

### Fetch (拉取远程更新)

#### 后端实现 (`git.js:786-824`)

```javascript
router.post('/fetch', async (req, res) => {
  const { project } = req.body;
  
  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);
    
    // 1. 获取当前分支及其上游 remote
    const { stdout: currentBranch } = await execAsync(
      'git rev-parse --abbrev-ref HEAD', 
      { cwd: projectPath }
    );
    const branch = currentBranch.trim();
    
    let remoteName = 'origin'; // fallback
    try {
      const { stdout } = await execAsync(
        `git rev-parse --abbrev-ref ${branch}@{upstream}`, 
        { cwd: projectPath }
      );
      remoteName = stdout.trim().split('/')[0]; // 提取远程名
    } catch (error) {
      console.log('No upstream configured, using origin as fallback');
    }
    
    // 2. 执行 fetch
    const { stdout } = await execAsync(
      `git fetch ${remoteName}`, 
      { cwd: projectPath }
    );
    
    res.json({ 
      success: true, 
      output: stdout || 'Fetch completed successfully', 
      remoteName 
    });
  } catch (error) {
    console.error('Git fetch error:', error);
    res.status(500).json({ 
      error: 'Fetch failed', 
      details: error.message.includes('Could not resolve hostname') 
        ? 'Unable to connect to remote repository. Check your internet connection.'
        : error.message.includes('fatal: \'origin\' does not appear to be a git repository')
        ? 'No remote repository configured. Add a remote with: git remote add origin <url>'
        : error.message
    });
  }
});
```

### Pull (拉取并合并)

#### 后端实现 (`git.js:826-891`)

```javascript
router.post('/pull', async (req, res) => {
  const { project } = req.body;
  
  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);
    
    // 1. 智能检测远程分支
    const { stdout: currentBranch } = await execAsync(
      'git rev-parse --abbrev-ref HEAD', 
      { cwd: projectPath }
    );
    const branch = currentBranch.trim();
    
    let remoteName = 'origin';
    let remoteBranch = branch;
    try {
      const { stdout } = await execAsync(
        `git rev-parse --abbrev-ref ${branch}@{upstream}`, 
        { cwd: projectPath }
      );
      const tracking = stdout.trim();
      remoteName = tracking.split('/')[0];
      remoteBranch = tracking.split('/').slice(1).join('/');
    } catch (error) {
      console.log('No upstream configured, using origin/branch as fallback');
    }
    
    // 2. 执行 pull
    const { stdout } = await execAsync(
      `git pull ${remoteName} ${remoteBranch}`, 
      { cwd: projectPath }
    );
    
    res.json({ 
      success: true, 
      output: stdout || 'Pull completed successfully', 
      remoteName,
      remoteBranch
    });
  } catch (error) {
    console.error('Git pull error:', error);
    
    // 增强的错误处理
    let errorMessage = 'Pull failed';
    let details = error.message;
    
    if (error.message.includes('CONFLICT')) {
      errorMessage = 'Merge conflicts detected';
      details = 'Pull created merge conflicts. Please resolve conflicts manually in the editor, then commit the changes.';
    } else if (error.message.includes('Please commit your changes or stash them')) {
      errorMessage = 'Uncommitted changes detected';  
      details = 'Please commit or stash your local changes before pulling.';
    } else if (error.message.includes('Could not resolve hostname')) {
      errorMessage = 'Network error';
      details = 'Unable to connect to remote repository. Check your internet connection.';
    } else if (error.message.includes('diverged')) {
      errorMessage = 'Branches have diverged';
      details = 'Your local branch and remote branch have diverged. Consider fetching first to review changes.';
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: details
    });
  }
});
```

### Push (推送到远程)

#### 后端实现 (`git.js:893-961`)

```javascript
router.post('/push', async (req, res) => {
  const { project } = req.body;
  
  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);
    
    // 智能检测远程分支
    const { stdout: currentBranch } = await execAsync(
      'git rev-parse --abbrev-ref HEAD', 
      { cwd: projectPath }
    );
    const branch = currentBranch.trim();
    
    let remoteName = 'origin';
    let remoteBranch = branch;
    try {
      const { stdout } = await execAsync(
        `git rev-parse --abbrev-ref ${branch}@{upstream}`, 
        { cwd: projectPath }
      );
      const tracking = stdout.trim();
      remoteName = tracking.split('/')[0];
      remoteBranch = tracking.split('/').slice(1).join('/');
    } catch (error) {
      console.log('No upstream configured, using origin/branch as fallback');
    }
    
    // 执行 push
    const { stdout } = await execAsync(
      `git push ${remoteName} ${remoteBranch}`, 
      { cwd: projectPath }
    );
    
    res.json({ 
      success: true, 
      output: stdout || 'Push completed successfully', 
      remoteName,
      remoteBranch
    });
  } catch (error) {
    console.error('Git push error:', error);
    
    // 增强的错误处理
    let errorMessage = 'Push failed';
    let details = error.message;
    
    if (error.message.includes('rejected')) {
      errorMessage = 'Push rejected';
      details = 'The remote has newer commits. Pull first to merge changes before pushing.';
    } else if (error.message.includes('non-fast-forward')) {
      errorMessage = 'Non-fast-forward push';
      details = 'Your branch is behind the remote. Pull the latest changes first.';
    } else if (error.message.includes('Permission denied')) {
      errorMessage = 'Authentication failed';
      details = 'Permission denied. Check your credentials or SSH keys.';
    } else if (error.message.includes('no upstream branch')) {
      errorMessage = 'No upstream branch';
      details = 'No upstream branch configured. Use: git push --set-upstream origin <branch>';
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: details
    });
  }
});
```

### Publish (发布分支)

#### 后端实现 (`git.js:963-1037`)

```javascript
router.post('/publish', async (req, res) => {
  const { project, branch } = req.body;
  
  if (!project || !branch) {
    return res.status(400).json({ 
      error: 'Project name and branch are required' 
    });
  }
  
  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);
    
    // 1. 验证当前分支
    const { stdout: currentBranch } = await execAsync(
      'git rev-parse --abbrev-ref HEAD', 
      { cwd: projectPath }
    );
    const currentBranchName = currentBranch.trim();
    
    if (currentBranchName !== branch) {
      return res.status(400).json({ 
        error: `Branch mismatch. Current branch is ${currentBranchName}, but trying to publish ${branch}` 
      });
    }
    
    // 2. 检查是否存在 remote
    let remoteName = 'origin';
    try {
      const { stdout } = await execAsync('git remote', { cwd: projectPath });
      const remotes = stdout.trim().split('\n').filter(r => r.trim());
      if (remotes.length === 0) {
        return res.status(400).json({ 
          error: 'No remote repository configured. Add a remote with: git remote add origin <url>' 
        });
      }
      remoteName = remotes.includes('origin') ? 'origin' : remotes[0];
    } catch (error) {
      return res.status(400).json({ 
        error: 'No remote repository configured. Add a remote with: git remote add origin <url>' 
      });
    }
    
    // 3. 发布分支 (设置上游并推送)
    const { stdout } = await execAsync(
      `git push --set-upstream ${remoteName} ${branch}`, 
      { cwd: projectPath }
    );
    
    res.json({ 
      success: true, 
      output: stdout || 'Branch published successfully', 
      remoteName,
      branch
    });
  } catch (error) {
    console.error('Git publish error:', error);
    
    let errorMessage = 'Publish failed';
    let details = error.message;
    
    if (error.message.includes('rejected')) {
      errorMessage = 'Publish rejected';
      details = 'The remote branch already exists and has different commits. Use push instead.';
    } else if (error.message.includes('Permission denied')) {
      errorMessage = 'Authentication failed';
      details = 'Permission denied. Check your credentials or SSH keys.';
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: details
    });
  }
});
```

---

## 🤖 AI 生成提交信息

### 前端调用 (`GitPanel.jsx:483-507`)

```javascript
const generateCommitMessage = async () => {
  setIsGeneratingMessage(true);
  try {
    const response = await authenticatedFetch('/api/git/generate-commit-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: selectedProject.name,
        files: Array.from(selectedFiles),
        provider: provider  // 'claude' 或 'cursor'
      })
    });
    
    const data = await response.json();
    if (data.message) {
      setCommitMessage(data.message);  // 自动填入提交信息框
    } else {
      console.error('Failed to generate commit message:', data.error);
    }
  } catch (error) {
    console.error('Error generating commit message:', error);
  } finally {
    setIsGeneratingMessage(false);
  }
};
```

### 后端实现 (`git.js:514-573`)

```javascript
router.post('/generate-commit-message', async (req, res) => {
  const { project, files, provider = 'claude' } = req.body;
  
  if (!project || !files || files.length === 0) {
    return res.status(400).json({ 
      error: 'Project name and files are required' 
    });
  }
  
  // 验证 provider
  if (!['claude', 'cursor'].includes(provider)) {
    return res.status(400).json({ 
      error: 'provider must be "claude" or "cursor"' 
    });
  }
  
  try {
    const projectPath = await getActualProjectPath(project);
    
    // 1. 获取选中文件的 diff
    let diffContext = '';
    for (const file of files) {
      try {
        const { stdout } = await execAsync(
          `git diff HEAD -- "${file}"`,
          { cwd: projectPath }
        );
        if (stdout) {
          diffContext += `\n--- ${file} ---\n${stdout}`;
        }
      } catch (error) {
        console.error(`Error getting diff for ${file}:`, error);
      }
    }
    
    // 2. 如果没有 diff，可能是未跟踪文件 - 获取文件内容
    if (!diffContext.trim()) {
      for (const file of files) {
        try {
          const filePath = path.join(projectPath, file);
          const stats = await fs.stat(filePath);
          
          if (!stats.isDirectory()) {
            const content = await fs.readFile(filePath, 'utf-8');
            diffContext += `\n--- ${file} (new file) ---\n${content.substring(0, 1000)}\n`;
          } else {
            diffContext += `\n--- ${file} (new directory) ---\n`;
          }
        } catch (error) {
          console.error(`Error reading file ${file}:`, error);
        }
      }
    }
    
    // 3. 使用 AI 生成提交信息
    const message = await generateCommitMessageWithAI(
      files, 
      diffContext, 
      provider, 
      projectPath
    );
    
    res.json({ message });
  } catch (error) {
    console.error('Generate commit message error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

### AI 生成逻辑 (`git.js:575-676`)

```javascript
async function generateCommitMessageWithAI(files, diffContext, provider, projectPath) {
  // 1. 构建提示词
  const prompt = `Generate a conventional commit message for these changes.

REQUIREMENTS:
- Format: type(scope): subject
- Include body explaining what changed and why
- Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore
- Subject under 50 chars, body wrapped at 72 chars
- Focus on user-facing changes, not implementation details
- Consider what's being added AND removed
- Return ONLY the commit message (no markdown, explanations, or code blocks)

FILES CHANGED:
${files.map(f => `- ${f}`).join('\n')}

DIFFS:
${diffContext.substring(0, 4000)}

Generate the commit message:`;
  
  try {
    // 2. 创建响应收集器
    let responseText = '';
    const writer = {
      send: (data) => {
        try {
          const parsed = typeof data === 'string' ? JSON.parse(data) : data;
          
          // 处理不同格式的响应
          // Claude SDK: {type: 'claude-response', data: {message: {content: [...]}}}
          if (parsed.type === 'claude-response' && parsed.data) {
            const message = parsed.data.message || parsed.data;
            if (message.content && Array.isArray(message.content)) {
              for (const item of message.content) {
                if (item.type === 'text' && item.text) {
                  responseText += item.text;
                }
              }
            }
          }
          // Cursor CLI: {type: 'cursor-output', output: '...'}
          else if (parsed.type === 'cursor-output' && parsed.output) {
            responseText += parsed.output;
          }
          // 直接文本消息
          else if (parsed.type === 'text' && parsed.text) {
            responseText += parsed.text;
          }
        } catch (e) {
          console.error('Error parsing writer data:', e);
        }
      },
      setSessionId: () => {} // No-op
    };
    
    // 3. 调用相应的 AI agent
    if (provider === 'claude') {
      await queryClaudeSDK(prompt, {
        cwd: projectPath,
        permissionMode: 'bypassPermissions',
        model: 'sonnet'
      }, writer);
    } else if (provider === 'cursor') {
      await spawnCursor(prompt, {
        cwd: projectPath,
        skipPermissions: true
      }, writer);
    }
    
    // 4. 清理响应文本
    const cleanedMessage = cleanCommitMessage(responseText);
    
    return cleanedMessage || 'chore: update files';
  } catch (error) {
    console.error('Error generating commit message with AI:', error);
    // 降级到简单消息
    return `chore: update ${files.length} file${files.length !== 1 ? 's' : ''}`;
  }
}
```

### 提交信息清理 (`git.js:678-712`)

```javascript
function cleanCommitMessage(text) {
  if (!text || !text.trim()) {
    return '';
  }
  
  let cleaned = text.trim();
  
  // 1. 移除 markdown 代码块
  cleaned = cleaned.replace(/```[a-z]*\n/g, '');
  cleaned = cleaned.replace(/```/g, '');
  
  // 2. 移除 markdown 标题
  cleaned = cleaned.replace(/^#+\s*/gm, '');
  
  // 3. 移除首尾引号
  cleaned = cleaned.replace(/^["']|["']$/g, '');
  
  // 4. 清理多余的空行
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  // 5. 提取 Conventional Commit 格式的消息
  // 匹配模式: feat|fix|docs|...(scope): subject
  const conventionalCommitMatch = cleaned.match(
    /(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\(.+?\))?:.+/s
  );
  if (conventionalCommitMatch) {
    cleaned = cleaned.substring(cleaned.indexOf(conventionalCommitMatch[0]));
  }
  
  return cleaned.trim();
}
```

---

## 🔐 安全机制

### 1. Git 仓库验证 (`git.js:54-78`)

```javascript
async function validateGitRepository(projectPath) {
  try {
    // 检查目录是否存在
    await fs.access(projectPath);
  } catch {
    throw new Error(`Project path not found: ${projectPath}`);
  }
  
  try {
    // 使用 --show-toplevel 获取 Git 仓库根目录
    const { stdout: gitRoot } = await execAsync(
      'git rev-parse --show-toplevel', 
      { cwd: projectPath }
    );
    const normalizedGitRoot = path.resolve(gitRoot.trim());
    const normalizedProjectPath = path.resolve(projectPath);
    
    // 确保项目目录就是 Git 仓库根目录 (防止使用父级仓库)
    if (normalizedGitRoot !== normalizedProjectPath) {
      throw new Error(
        `Project directory is not a git repository. This directory is inside a git repository at ${normalizedGitRoot}, but git operations should be run from the repository root.`
      );
    }
  } catch (error) {
    if (error.message.includes('Project directory is not a git repository')) {
      throw error;
    }
    throw new Error(
      'Not a git repository. This directory does not contain a .git folder. Initialize a git repository with "git init" to use source control features.'
    );
  }
}
```

### 2. 路径安全

```javascript
// 所有 API 路由使用 authenticateToken 中间件
app.use('/api/git', authenticateToken, gitRoutes);

// 路径解析和规范化
async function getActualProjectPath(projectName) {
  try {
    // 使用 extractProjectDirectory 获取真实路径
    return await extractProjectDirectory(projectName);
  } catch (error) {
    console.error(`Error extracting project directory for ${projectName}:`, error);
    // Fallback 处理
    return projectName.replace(/-/g, '/');
  }
}
```

### 3. 命令注入防护

```javascript
// 文件路径使用引号包裹
await execAsync(`git add "${file}"`, { cwd: projectPath });

// 提交信息转义引号
const escapedMessage = message.replace(/"/g, '\\"');
await execAsync(`git commit -m "${escapedMessage}"`, { cwd: projectPath });
```

### 4. 错误处理

```javascript
// 统一的错误处理模式
try {
  // Git 操作
} catch (error) {
  console.error('Git operation error:', error);
  
  // 提供用户友好的错误信息
  if (error.message.includes('not a git repository')) {
    return res.status(400).json({ 
      error: 'Not a git repository',
      details: 'Initialize git with: git init'
    });
  }
  
  res.status(500).json({ 
    error: 'Operation failed', 
    details: error.message 
  });
}
```

---

## 📊 数据流图

### Git 状态查询流程

```
┌──────────────┐
│ 用户打开项目  │
└──────┬───────┘
       │
       ▼
┌────────────────────┐
│ GitPanel 组件加载   │
└──────┬─────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ fetchGitStatus()                     │
│ GET /api/git/status?project=xxx      │
└──────┬───────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ 后端处理                              │
│ 1. 解析项目路径                       │
│ 2. 验证 Git 仓库                      │
│ 3. 执行 git status --porcelain       │
│ 4. 解析输出                           │
│ 5. 返回结构化数据                     │
└──────┬───────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ 前端更新状态                          │
│ - setGitStatus()                     │
│ - setCurrentBranch()                 │
│ - setSelectedFiles()                 │
└──────┬───────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ 批量获取文件 Diff                     │
│ fetchFileDiff() for each file        │
└──────────────────────────────────────┘
```

### 提交流程

```
┌──────────────────┐
│ 用户选择文件      │
│ 输入提交信息      │
└──────┬───────────┘
       │
       ▼
┌──────────────────────────┐
│ 可选: AI 生成提交信息     │
│ generateCommitMessage()  │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│ 用户点击 Commit 按钮      │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ handleCommit()                       │
│ POST /api/git/commit                 │
│ {                                    │
│   project: "xxx",                    │
│   message: "feat: add feature",      │
│   files: ["src/app.js", ...]         │
│ }                                    │
└──────┬───────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ 后端处理                              │
│ 1. 验证参数                           │
│ 2. 验证 Git 仓库                      │
│ 3. 逐个暂存文件: git add "<file>"    │
│ 4. 执行提交: git commit -m "..."     │
│ 5. 返回结果                           │
└──────┬───────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ 前端更新                              │
│ - 清空提交信息                        │
│ - 清空选中文件                        │
│ - 刷新 Git 状态                       │
│ - 刷新远程状态                        │
└──────────────────────────────────────┘
```

### Push/Pull 流程

```
┌──────────────────────────┐
│ 用户点击 Push/Pull 按钮   │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ handlePush() / handlePull()          │
│ POST /api/git/push or pull           │
└──────┬───────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ 后端智能检测远程                      │
│ 1. 获取当前分支                       │
│ 2. 检测上游分支                       │
│    git rev-parse --abbrev-ref         │
│    branch@{upstream}                 │
│ 3. 提取 remote 名和分支名             │
└──────┬───────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ 执行 Git 命令                         │
│ git push origin main                 │
│ 或                                    │
│ git pull origin main                 │
└──────┬───────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ 错误处理                              │
│ - rejected: 需要先 pull              │
│ - CONFLICT: 合并冲突                 │
│ - Permission denied: 认证失败        │
│ - Network error: 网络问题            │
└──────┬───────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ 前端刷新状态                          │
│ - fetchGitStatus()                   │
│ - fetchRemoteStatus()                │
└──────────────────────────────────────┘
```

---

## 🎨 UI 组件结构

```
GitPanel
├── Header
│   ├── Branch Dropdown (分支切换)
│   ├── Fetch/Pull/Push Buttons (远程操作)
│   └── View Toggle (Changes/History)
│
├── Changes View
│   ├── Commit Area
│   │   ├── Textarea (提交信息)
│   │   ├── AI Generate Button (Sparkles icon)
│   │   └── Commit Button
│   │
│   └── Files List
│       ├── Modified Files (M)
│       ├── Added Files (A)
│       ├── Deleted Files (D)
│       └── Untracked Files (?)
│           ├── Checkbox (选择)
│           ├── File Name
│           ├── Actions (Open/Discard/Delete)
│           └── Expandable Diff Viewer
│
└── History View
    └── Recent Commits List
        ├── Commit Hash
        ├── Author & Date
        ├── Message
        ├── Stats (files changed)
        └── Expandable Diff Viewer
```

---

## 📈 性能优化

1. **批量 Diff 获取**: 状态更新后并行获取所有文件的 diff
2. **懒加载 Diff**: 只在用户展开文件时才渲染 diff
3. **Debounce**: 防止频繁刷新状态
4. **缓存**: 已获取的 diff 存储在 state 中避免重复请求
5. **智能远程检测**: 自动检测上游分支，减少配置负担

---

## 🔧 技术栈

### 前端
- **React**: UI 组件框架
- **diff2html**: Diff 渲染库
- **lucide-react**: 图标库

### 后端
- **Express.js**: Web 框架
- **child_process**: 执行 Git 命令
- **node-pty**: (用于其他功能，Git 使用 exec)

### Git 命令
- **porcelain**: 机器可读的状态格式
- **unified diff**: 标准差异格式
- **rev-parse**: 解析 Git 引用

---

## 📝 总结

这个 Git 功能实现提供了一个功能完整、用户友好的源代码控制界面：

### ✅ 核心优势

1. **完整的 Git 工作流**: Status → Diff → Commit → Push/Pull
2. **智能远程检测**: 自动识别上游分支和远程仓库
3. **AI 辅助**: 使用 Claude/Cursor 自动生成规范的提交信息
4. **可视化 Diff**: 使用 diff2html 提供清晰的代码对比
5. **安全可靠**: 路径验证、命令注入防护、错误处理
6. **用户友好**: 直观的 UI、清晰的错误提示、快捷操作

### 🎯 适用场景

- Web 端 Git 客户端
- 集成开发环境 (IDE) 的 Git 插件
- 代码审查工具
- 项目管理平台的版本控制模块

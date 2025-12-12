# 文件浏览与修改功能 - 前后端实现原理

## 目录
- [整体架构](#整体架构)
- [核心功能](#核心功能)
- [文件浏览实现](#文件浏览实现)
- [文件读取实现](#文件读取实现)
- [文件编辑实现](#文件编辑实现)
- [安全机制](#安全机制)
- [性能优化](#性能优化)

## 整体架构

```
┌───────────────────────────────────────────────────────────────┐
│                        前端层                                  │
├───────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─────────────────────┐      ┌──────────────────────┐       │
│  │   FileTree.jsx      │      │  CodeEditor.jsx      │       │
│  │   ───────────       │      │  ────────────        │       │
│  │   - 文件树展示      │      │  - CodeMirror 编辑器 │       │
│  │   - 搜索过滤        │◄────►│  - 语法高亮          │       │
│  │   - 多视图模式      │      │  - Diff 对比         │       │
│  │   - 懒加载展开      │      │  - 保存/下载         │       │
│  └──────────┬──────────┘      └──────────┬───────────┘       │
│             │                             │                    │
│             │         API 调用            │                    │
│             ▼                             ▼                    │
│  ┌──────────────────────────────────────────────────┐        │
│  │              api.js (API 工具层)                 │        │
│  │  ─────────────────────────────                   │        │
│  │  - authenticatedFetch() 认证包装                │        │
│  │  - api.getFiles()       获取文件树              │        │
│  │  - api.readFile()       读取文件内容            │        │
│  │  - api.saveFile()       保存文件内容            │        │
│  └──────────────────────┬───────────────────────────┘        │
│                         │                                      │
└─────────────────────────┼──────────────────────────────────────┘
                          │
                          │ HTTP/HTTPS
                          │
┌─────────────────────────▼──────────────────────────────────────┐
│                        后端层 (Express)                         │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────┐     │
│  │              路由层 (index.js)                        │     │
│  │  ───────────────────────────                          │     │
│  │  GET  /api/projects/:name/files     获取文件树       │     │
│  │  GET  /api/projects/:name/file      读取文件         │     │
│  │  PUT  /api/projects/:name/file      保存文件         │     │
│  │  GET  /api/projects/:name/files/    二进制文件       │     │
│  │       content                        (图片等)        │     │
│  └──────────────────┬────────────────────────────────────┘     │
│                     │                                           │
│                     ▼                                           │
│  ┌──────────────────────────────────────────────────────┐     │
│  │          文件系统操作层                               │     │
│  │  ──────────────────                                   │     │
│  │  - getFileTree()          递归读取目录结构           │     │
│  │  - fsPromises.readFile()  读取文件内容               │     │
│  │  - fsPromises.writeFile() 写入文件内容               │     │
│  │  - fsPromises.stat()      获取文件元信息             │     │
│  └──────────────────┬────────────────────────────────────┘     │
│                     │                                           │
└─────────────────────┼───────────────────────────────────────────┘
                      │
                      ▼
              ┌──────────────┐
              │  文件系统    │
              │  (磁盘)      │
              └──────────────┘
```

## 核心功能

### 1. 文件浏览
- **树形展示**: 递归显示项目目录结构
- **多视图模式**: Simple / Compact / Detailed 三种视图
- **搜索过滤**: 实时搜索文件和目录
- **懒加载**: 按需展开目录
- **元数据显示**: 文件大小、修改时间、权限

### 2. 文件编辑
- **语法高亮**: 支持 10+ 种编程语言
- **代码补全**: 自动括号匹配、代码补全
- **Diff 对比**: 对比修改前后的代码差异
- **多主题**: 亮色/暗色主题切换
- **自动保存**: Ctrl+S 快捷键保存

### 3. 文件操作
- **读取**: 支持文本文件和二进制文件
- **保存**: 覆盖式保存到原路径
- **下载**: 下载文件到本地
- **预览**: 图片文件预览

## 文件浏览实现

### 前端 - FileTree 组件

#### 1. 数据获取

**位置**: `src/components/FileTree.jsx:80-100`

```javascript
const fetchFiles = async () => {
  setLoading(true);
  try {
    // 调用 API 获取文件树
    const response = await api.getFiles(selectedProject.name);
    
    if (!response.ok) {
      console.error('❌ File fetch failed:', response.status);
      setFiles([]);
      return;
    }
    
    const data = await response.json();
    setFiles(data);  // 设置文件树数据
  } catch (error) {
    console.error('❌ Error fetching files:', error);
    setFiles([]);
  } finally {
    setLoading(false);
  }
};
```

**API 调用** (`src/utils/api.js:87-88`):
```javascript
getFiles: (projectName) =>
  authenticatedFetch(`/api/projects/${projectName}/files`)
```

#### 2. 文件树数据结构

```javascript
// 单个文件/目录节点
{
  name: 'index.js',              // 文件名
  path: '/absolute/path/index.js', // 绝对路径
  type: 'file' | 'directory',    // 类型
  size: 1024,                    // 文件大小（字节）
  modified: '2024-01-01T00:00:00.000Z', // 修改时间
  permissions: '644',            // 数字权限
  permissionsRwx: 'rw-r--r--',  // rwx 格式权限
  children: []                   // 子目录（仅 directory 类型）
}
```

#### 3. 三种视图模式

**Simple View** (简洁视图):
```javascript
// src/components/FileTree.jsx:141-198
const renderFileTree = (items, level = 0) => {
  return items.map((item) => (
    <Button
      style={{ paddingLeft: `${level * 16 + 12}px` }}  // 缩进表示层级
      onClick={() => {
        if (item.type === 'directory') {
          toggleDirectory(item.path);  // 展开/折叠目录
        } else {
          setSelectedFile({...});      // 打开文件编辑器
        }
      }}
    >
      {/* 文件图标 + 文件名 */}
    </Button>
  ));
};
```

**Detailed View** (详细视图):
```javascript
// src/components/FileTree.jsx:224-284
const renderDetailedView = (items, level = 0) => {
  return items.map((item) => (
    <div className="grid grid-cols-12 gap-2">
      <div className="col-span-5">  {/* 名称 */}
        {item.name}
      </div>
      <div className="col-span-2">  {/* 大小 */}
        {formatFileSize(item.size)}
      </div>
      <div className="col-span-3">  {/* 修改时间 */}
        {formatRelativeTime(item.modified)}
      </div>
      <div className="col-span-2">  {/* 权限 */}
        {item.permissionsRwx}
      </div>
    </div>
  ));
};
```

**Compact View** (紧凑视图):
```javascript
// src/components/FileTree.jsx:287-345
const renderCompactView = (items, level = 0) => {
  return items.map((item) => (
    <div className="flex items-center justify-between">
      <div>{/* 文件名 */}</div>
      <div className="flex gap-3">
        <span>{formatFileSize(item.size)}</span>
        <span>{item.permissionsRwx}</span>
      </div>
    </div>
  ));
};
```

#### 4. 搜索过滤功能

**实时过滤** (`src/components/FileTree.jsx:36-54`):
```javascript
useEffect(() => {
  if (!searchQuery.trim()) {
    setFilteredFiles(files);
  } else {
    const filtered = filterFiles(files, searchQuery.toLowerCase());
    setFilteredFiles(filtered);
    
    // 自动展开包含匹配项的目录
    const expandMatches = (items) => {
      items.forEach(item => {
        if (item.type === 'directory' && item.children?.length > 0) {
          setExpandedDirs(prev => new Set(prev.add(item.path)));
          expandMatches(item.children);
        }
      });
    };
    expandMatches(filtered);
  }
}, [files, searchQuery]);
```

**递归过滤算法** (`src/components/FileTree.jsx:56-78`):
```javascript
const filterFiles = (items, query) => {
  return items.reduce((filtered, item) => {
    const matchesName = item.name.toLowerCase().includes(query);
    let filteredChildren = [];
    
    // 递归过滤子目录
    if (item.type === 'directory' && item.children) {
      filteredChildren = filterFiles(item.children, query);
    }
    
    // 包含条件：
    // 1. 名称匹配查询
    // 2. 是包含匹配项的目录
    if (matchesName || filteredChildren.length > 0) {
      filtered.push({
        ...item,
        children: filteredChildren
      });
    }
    
    return filtered;
  }, []);
};
```

#### 5. 目录展开/折叠

```javascript
// src/components/FileTree.jsx:102-110
const toggleDirectory = (path) => {
  const newExpanded = new Set(expandedDirs);
  if (newExpanded.has(path)) {
    newExpanded.delete(path);  // 折叠
  } else {
    newExpanded.add(path);     // 展开
  }
  setExpandedDirs(newExpanded);
};
```

### 后端 - 文件树生成

#### 1. 路由处理

**位置**: `server/index.js:668-697`

```javascript
app.get('/api/projects/:projectName/files', authenticateToken, async (req, res) => {
  try {
    // 1. 提取项目真实路径
    let actualPath;
    try {
      actualPath = await extractProjectDirectory(req.params.projectName);
    } catch (error) {
      // 回退到简单的路径替换
      actualPath = req.params.projectName.replace(/-/g, '/');
    }
    
    // 2. 检查路径是否存在
    try {
      await fsPromises.access(actualPath);
    } catch (e) {
      return res.status(404).json({ 
        error: `Project path not found: ${actualPath}` 
      });
    }
    
    // 3. 获取文件树（最大深度 10，显示隐藏文件）
    const files = await getFileTree(actualPath, 10, 0, true);
    
    res.json(files);
  } catch (error) {
    console.error('[ERROR] File tree error:', error.message);
    res.status(500).json({ error: error.message });
  }
});
```

#### 2. 递归文件树生成

**位置**: `server/index.js:1531-1602`

```javascript
async function getFileTree(dirPath, maxDepth = 3, currentDepth = 0, showHidden = true) {
  const items = [];
  
  try {
    // 1. 读取目录内容
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      // 2. 跳过重量级目录
      if (entry.name === 'node_modules' ||
          entry.name === 'dist' ||
          entry.name === 'build') continue;
      
      const itemPath = path.join(dirPath, entry.name);
      const item = {
        name: entry.name,
        path: itemPath,
        type: entry.isDirectory() ? 'directory' : 'file'
      };
      
      // 3. 获取文件元数据
      try {
        const stats = await fsPromises.stat(itemPath);
        item.size = stats.size;
        item.modified = stats.mtime.toISOString();
        
        // 4. 转换权限格式 (数字 -> rwx)
        const mode = stats.mode;
        const ownerPerm = (mode >> 6) & 7;
        const groupPerm = (mode >> 3) & 7;
        const otherPerm = mode & 7;
        
        item.permissions = `${ownerPerm}${groupPerm}${otherPerm}`;
        item.permissionsRwx = 
          permToRwx(ownerPerm) + 
          permToRwx(groupPerm) + 
          permToRwx(otherPerm);
      } catch (statError) {
        // 5. stat 失败时使用默认值
        item.size = 0;
        item.modified = null;
        item.permissions = '000';
        item.permissionsRwx = '---------';
      }
      
      // 6. 递归处理子目录
      if (entry.isDirectory() && currentDepth < maxDepth) {
        try {
          // 检查目录访问权限
          await fsPromises.access(item.path, fs.constants.R_OK);
          // 递归调用
          item.children = await getFileTree(
            item.path, 
            maxDepth, 
            currentDepth + 1, 
            showHidden
          );
        } catch (e) {
          // 无权访问的目录设为空数组
          item.children = [];
        }
      }
      
      items.push(item);
    }
  } catch (error) {
    // 只记录非权限错误
    if (error.code !== 'EACCES' && error.code !== 'EPERM') {
      console.error('Error reading directory:', error);
    }
  }
  
  // 7. 排序：目录优先，然后按名称排序
  return items.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}
```

#### 3. 权限格式转换

**位置**: `server/index.js:1524-1529`

```javascript
function permToRwx(perm) {
  const r = perm & 4 ? 'r' : '-';  // 读权限
  const w = perm & 2 ? 'w' : '-';  // 写权限
  const x = perm & 1 ? 'x' : '-';  // 执行权限
  return r + w + x;
}
```

**示例**:
```
数字 7 (二进制 111) -> rwx
数字 6 (二进制 110) -> rw-
数字 5 (二进制 101) -> r-x
数字 4 (二进制 100) -> r--
```

## 文件读取实现

### 前端 - 读取文件

**CodeEditor 组件** (`src/components/CodeEditor.jsx:286-319`):

```javascript
useEffect(() => {
  const loadFileContent = async () => {
    try {
      setLoading(true);
      
      // 1. 如果有 diff 信息，直接使用
      if (file.diffInfo && 
          file.diffInfo.new_string !== undefined && 
          file.diffInfo.old_string !== undefined) {
        setContent(file.diffInfo.new_string);
        setLoading(false);
        return;
      }
      
      // 2. 否则从服务器加载
      const response = await api.readFile(file.projectName, file.path);
      
      if (!response.ok) {
        throw new Error(`Failed to load file: ${response.status}`);
      }
      
      const data = await response.json();
      setContent(data.content);
    } catch (error) {
      console.error('Error loading file:', error);
      setContent(`// Error loading file: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  loadFileContent();
}, [file, projectPath]);
```

**API 定义** (`src/utils/api.js:80-81`):
```javascript
readFile: (projectName, filePath) =>
  authenticatedFetch(`/api/projects/${projectName}/file?filePath=${encodeURIComponent(filePath)}`)
```

### 后端 - 文件读取

#### 1. 文本文件读取

**位置**: `server/index.js:522-561`

```javascript
app.get('/api/projects/:projectName/file', authenticateToken, async (req, res) => {
  try {
    const { projectName } = req.params;
    const { filePath } = req.query;
    
    console.log('[DEBUG] File read request:', projectName, filePath);
    
    // 1. 验证文件路径
    if (!filePath) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    
    // 2. 获取项目根目录
    const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
    if (!projectRoot) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // 3. 处理绝对路径和相对路径
    const resolved = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(projectRoot, filePath);
    
    // 4. 安全检查：确保文件在项目根目录内
    const normalizedRoot = path.resolve(projectRoot) + path.sep;
    if (!resolved.startsWith(normalizedRoot)) {
      return res.status(403).json({ error: 'Path must be under project root' });
    }
    
    // 5. 读取文件内容
    const content = await fsPromises.readFile(resolved, 'utf8');
    
    res.json({ content, path: resolved });
  } catch (error) {
    console.error('Error reading file:', error);
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'File not found' });
    } else if (error.code === 'EACCES') {
      res.status(403).json({ error: 'Permission denied' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});
```

#### 2. 二进制文件读取（图片等）

**位置**: `server/index.js:563-615`

```javascript
app.get('/api/projects/:projectName/files/content', authenticateToken, async (req, res) => {
  try {
    const { projectName } = req.params;
    const { path: filePath } = req.query;
    
    // 1-4. 同文本文件的验证步骤
    
    // 5. 检查文件是否存在
    try {
      await fsPromises.access(resolved);
    } catch (error) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // 6. 根据文件扩展名设置 MIME 类型
    const mimeType = mime.lookup(resolved) || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    
    // 7. 流式传输文件（适合大文件）
    const fileStream = fs.createReadStream(resolved);
    fileStream.pipe(res);
    
    fileStream.on('error', (error) => {
      console.error('Error streaming file:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error reading file' });
      }
    });
    
  } catch (error) {
    console.error('Error serving binary file:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});
```

## 文件编辑实现

### 前端 - CodeEditor 组件

#### 1. 编辑器初始化

**位置**: `src/components/CodeEditor.jsx:639-683`

```javascript
<CodeMirror
  ref={editorRef}
  value={content}
  onChange={setContent}  // 内容变化时更新状态
  extensions={[
    // 语言扩展
    ...getLanguageExtension(file.name),
    // 工具栏面板
    ...editorToolbarPanel,
    // Diff 对比扩展（如果有差异信息）
    ...(file.diffInfo && showDiff ? [
      unifiedMergeView({
        original: file.diffInfo.old_string,
        mergeControls: false,
        highlightChanges: true,
        syntaxHighlightDeletions: false,
        gutter: true
      }),
      ...minimapExtension,
      ...scrollToFirstChunkExtension
    ] : []),
    // 自动换行
    ...(wordWrap ? [EditorView.lineWrapping] : [])
  ]}
  theme={isDarkMode ? oneDark : undefined}
  height="100%"
  style={{ fontSize: `${fontSize}px` }}
  basicSetup={{
    lineNumbers: showLineNumbers,
    foldGutter: true,
    bracketMatching: true,
    closeBrackets: true,
    autocompletion: true,
    highlightSelectionMatches: true,
    searchKeymap: true,
  }}
/>
```

#### 2. 语言扩展选择

**位置**: `src/components/CodeEditor.jsx:257-283`

```javascript
const getLanguageExtension = (filename) => {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return [javascript({ 
        jsx: true, 
        typescript: ext.includes('ts') 
      })];
    case 'py':
      return [python()];
    case 'html':
    case 'htm':
      return [html()];
    case 'css':
    case 'scss':
    case 'less':
      return [css()];
    case 'json':
      return [json()];
    case 'md':
    case 'markdown':
      return [markdown()];
    default:
      return [];
  }
};
```

#### 3. 文件保存

**位置**: `src/components/CodeEditor.jsx:321-362`

```javascript
const handleSave = async () => {
  setSaving(true);
  try {
    console.log('Saving file:', {
      projectName: file.projectName,
      path: file.path,
      contentLength: content?.length
    });
    
    // 调用 API 保存文件
    const response = await api.saveFile(
      file.projectName, 
      file.path, 
      content
    );
    
    console.log('Save response:', {
      status: response.status,
      ok: response.ok
    });
    
    if (!response.ok) {
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Save failed: ${response.status}`);
      } else {
        const textError = await response.text();
        throw new Error(`Save failed: ${response.status} ${response.statusText}`);
      }
    }
    
    const result = await response.json();
    console.log('Save successful:', result);
    
    // 显示保存成功提示
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
    
  } catch (error) {
    console.error('Error saving file:', error);
    alert(`Error saving file: ${error.message}`);
  } finally {
    setSaving(false);
  }
};
```

**API 定义** (`src/utils/api.js:82-86`):
```javascript
saveFile: (projectName, filePath, content) =>
  authenticatedFetch(`/api/projects/${projectName}/file`, {
    method: 'PUT',
    body: JSON.stringify({ filePath, content }),
  })
```

#### 4. 快捷键支持

**位置**: `src/components/CodeEditor.jsx:431-447`

```javascript
useEffect(() => {
  const handleKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 's') {
        e.preventDefault();
        handleSave();  // Ctrl+S / Cmd+S 保存
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();     // ESC 关闭
      }
    }
  };
  
  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, [content]);
```

#### 5. Diff 对比功能

**位置**: `src/components/CodeEditor.jsx:649-661`

```javascript
// 启用 Diff 对比模式
unifiedMergeView({
  original: file.diffInfo.old_string,  // 原始内容
  mergeControls: false,                 // 不显示合并控制
  highlightChanges: true,               // 高亮变化
  syntaxHighlightDeletions: false,      // 不高亮已删除内容
  gutter: true                          // 显示侧边栏
})
```

**Diff 导航工具栏** (`src/components/CodeEditor.jsx:107-254`):
```javascript
// 工具栏显示: "1/5 changes" + 上一个/下一个按钮
const editorToolbarPanel = useMemo(() => {
  const createPanel = (view) => {
    const chunksData = getChunks(view.state);
    const chunks = chunksData?.chunks || [];
    
    // 上一个变化
    prevBtn.addEventListener('click', () => {
      currentIndex = currentIndex > 0 ? currentIndex - 1 : chunks.length - 1;
      view.dispatch({
        effects: EditorView.scrollIntoView(chunk.fromB, { y: 'center' })
      });
    });
    
    // 下一个变化
    nextBtn.addEventListener('click', () => {
      currentIndex = currentIndex < chunks.length - 1 ? currentIndex + 1 : 0;
      view.dispatch({
        effects: EditorView.scrollIntoView(chunk.fromB, { y: 'center' })
      });
    });
  };
  
  return [showPanel.of(createPanel)];
}, [file.diffInfo, showDiff]);
```

### 后端 - 文件保存

**位置**: `server/index.js:617-666`

```javascript
app.put('/api/projects/:projectName/file', authenticateToken, async (req, res) => {
  try {
    const { projectName } = req.params;
    const { filePath, content } = req.body;
    
    console.log('[DEBUG] File save request:', projectName, filePath);
    
    // 1. 验证文件路径
    if (!filePath) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    
    // 2. 验证内容
    if (content === undefined) {
      return res.status(400).json({ error: 'Content is required' });
    }
    
    // 3. 获取项目根目录
    const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
    if (!projectRoot) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // 4. 处理绝对路径和相对路径
    const resolved = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(projectRoot, filePath);
    
    // 5. 安全检查：确保文件在项目根目录内
    const normalizedRoot = path.resolve(projectRoot) + path.sep;
    if (!resolved.startsWith(normalizedRoot)) {
      return res.status(403).json({ error: 'Path must be under project root' });
    }
    
    // 6. 写入文件内容
    await fsPromises.writeFile(resolved, content, 'utf8');
    
    res.json({
      success: true,
      path: resolved,
      message: 'File saved successfully'
    });
  } catch (error) {
    console.error('Error saving file:', error);
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'File or directory not found' });
    } else if (error.code === 'EACCES') {
      res.status(403).json({ error: 'Permission denied' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});
```

## 安全机制

### 1. 路径验证

**防止路径遍历攻击**:

```javascript
// 1. 规范化路径
const resolved = path.isAbsolute(filePath)
  ? path.resolve(filePath)
  : path.resolve(projectRoot, filePath);

// 2. 确保在项目根目录内
const normalizedRoot = path.resolve(projectRoot) + path.sep;
if (!resolved.startsWith(normalizedRoot)) {
  return res.status(403).json({ error: 'Path must be under project root' });
}
```

**示例**:
```javascript
// 合法路径
projectRoot = '/home/user/project'
filePath = 'src/index.js'
resolved = '/home/user/project/src/index.js' ✅

// 非法路径（路径遍历）
projectRoot = '/home/user/project'
filePath = '../../../etc/passwd'
resolved = '/etc/passwd' ❌ (不在项目根目录内)
```

### 2. 认证和授权

**Token 认证** (`src/utils/api.js:2-21`):
```javascript
export const authenticatedFetch = (url, options = {}) => {
  const isPlatform = import.meta.env.VITE_IS_PLATFORM === 'true';
  const token = localStorage.getItem('auth-token');
  
  const defaultHeaders = {
    'Content-Type': 'application/json',
  };
  
  // 非平台模式需要携带 token
  if (!isPlatform && token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }
  
  return fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });
};
```

**中间件验证** (`server/index.js`):
```javascript
// 所有文件 API 都需要认证
app.get('/api/projects/:projectName/files', authenticateToken, ...);
app.get('/api/projects/:projectName/file', authenticateToken, ...);
app.put('/api/projects/:projectName/file', authenticateToken, ...);
```

### 3. 文件权限检查

```javascript
try {
  // 检查目录访问权限
  await fsPromises.access(item.path, fs.constants.R_OK);
  item.children = await getFileTree(...);
} catch (e) {
  // 无权访问的目录设为空数组
  item.children = [];
}
```

### 4. 错误处理

```javascript
try {
  const content = await fsPromises.readFile(resolved, 'utf8');
  res.json({ content, path: resolved });
} catch (error) {
  if (error.code === 'ENOENT') {
    res.status(404).json({ error: 'File not found' });
  } else if (error.code === 'EACCES') {
    res.status(403).json({ error: 'Permission denied' });
  } else {
    res.status(500).json({ error: error.message });
  }
}
```

## 性能优化

### 1. 目录深度限制

```javascript
// 限制递归深度，防止深层目录导致性能问题
const files = await getFileTree(actualPath, 10, 0, true);
//                                          ↑
//                                     最大深度 10 层
```

### 2. 跳过重量级目录

```javascript
// 跳过 node_modules、dist、build 等大目录
if (entry.name === 'node_modules' ||
    entry.name === 'dist' ||
    entry.name === 'build') continue;
```

### 3. 懒加载展开

```javascript
// 前端只展开用户点击的目录
const toggleDirectory = (path) => {
  const newExpanded = new Set(expandedDirs);
  if (newExpanded.has(path)) {
    newExpanded.delete(path);
  } else {
    newExpanded.add(path);
  }
  setExpandedDirs(newExpanded);
};
```

### 4. 搜索防抖

虽然代码中没有明显的防抖，但可以添加：

```javascript
// 建议优化：添加搜索防抖
const [debouncedQuery, setDebouncedQuery] = useState('');

useEffect(() => {
  const timer = setTimeout(() => {
    setDebouncedQuery(searchQuery);
  }, 300);
  
  return () => clearTimeout(timer);
}, [searchQuery]);
```

### 5. 流式传输大文件

```javascript
// 使用流式传输，避免一次性加载大文件到内存
const fileStream = fs.createReadStream(resolved);
fileStream.pipe(res);
```

### 6. 视图模式缓存

```javascript
// 保存用户的视图偏好到 localStorage
useEffect(() => {
  const savedViewMode = localStorage.getItem('file-tree-view-mode');
  if (savedViewMode && ['simple', 'detailed', 'compact'].includes(savedViewMode)) {
    setViewMode(savedViewMode);
  }
}, []);

const changeViewMode = (mode) => {
  setViewMode(mode);
  localStorage.setItem('file-tree-view-mode', mode);
};
```

## 数据流总结

### 文件浏览流程
```
用户打开项目
     ↓
FileTree.fetchFiles()
     ↓
api.getFiles(projectName)
     ↓
GET /api/projects/:projectName/files
     ↓
extractProjectDirectory()
     ↓
getFileTree(path, 10, 0, true)
     ↓
递归读取目录（最多 10 层）
     ↓
返回文件树 JSON
     ↓
setFiles(data)
     ↓
渲染文件树（3 种视图）
```

### 文件读取流程
```
用户点击文件
     ↓
setSelectedFile({ name, path, ... })
     ↓
CodeEditor 组件加载
     ↓
api.readFile(projectName, filePath)
     ↓
GET /api/projects/:projectName/file?filePath=...
     ↓
路径验证（安全检查）
     ↓
fsPromises.readFile(resolved, 'utf8')
     ↓
返回 { content, path }
     ↓
setContent(data.content)
     ↓
CodeMirror 渲染编辑器
```

### 文件保存流程
```
用户修改内容并按 Ctrl+S
     ↓
handleSave()
     ↓
api.saveFile(projectName, filePath, content)
     ↓
PUT /api/projects/:projectName/file
     ↓
body: { filePath, content }
     ↓
路径验证（安全检查）
     ↓
fsPromises.writeFile(resolved, content, 'utf8')
     ↓
返回 { success: true, path, message }
     ↓
显示保存成功提示
```

## 技术栈

### 前端技术

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 18+ | UI 框架 |
| CodeMirror 6 | 最新 | 代码编辑器 |
| @codemirror/lang-* | 最新 | 语言支持包 |
| @codemirror/merge | 最新 | Diff 对比 |
| @replit/codemirror-minimap | 最新 | 代码小地图 |
| lucide-react | 最新 | 图标库 |

### 后端技术

| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | 18+ | 运行时环境 |
| Express | 4.x | HTTP 服务器 |
| fs/promises | 内置 | 文件系统操作 |
| mime-types | 最新 | MIME 类型识别 |

## 扩展功能

### 已实现
- ✅ 文件树展示（3 种视图）
- ✅ 搜索过滤
- ✅ 文件读取和保存
- ✅ 语法高亮（10+ 语言）
- ✅ Diff 对比
- ✅ 图片预览
- ✅ 权限显示
- ✅ 修改时间显示

### 可扩展
- 📁 文件创建/删除/重命名
- 📁 目录创建/删除
- 📁 文件拖拽上传
- 📁 批量操作
- 📁 文件版本历史
- 📁 代码格式化
- 📁 代码 Lint 检查
- 📁 多人协同编辑

---

## 总结

这个文件管理系统实现了：
- ✅ **完整的文件浏览**: 树形展示、多视图、搜索过滤
- ✅ **强大的代码编辑**: CodeMirror 6 + 语法高亮 + Diff 对比
- ✅ **安全的文件操作**: 路径验证、权限检查、错误处理
- ✅ **良好的性能**: 懒加载、深度限制、流式传输
- ✅ **优秀的用户体验**: 快捷键、自动保存、视图偏好记忆

适用于构建基于 Web 的代码编辑器和项目管理工具。

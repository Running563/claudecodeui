import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import fsSync from 'fs';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'database', 'projects.db');
let db = null;

// 获取北京时间字符串 (UTC+8)
function getBeijingTime() {
  const now = new Date();
  // 北京时间 = UTC + 8小时
  const beijingOffset = 8 * 60 * 60 * 1000;
  const beijingTime = new Date(now.getTime() + beijingOffset);
  return beijingTime.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
}

// 初始化数据库
export function initDatabase() {
  // 确保目录存在
  const dbDir = path.dirname(dbPath);
  if (!fsSync.existsSync(dbDir)) {
    fsSync.mkdirSync(dbDir, { recursive: true });
  }
  
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  
  // 创建表
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_path TEXT NOT NULL UNIQUE,
      display_name TEXT,
      deleted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      provider TEXT DEFAULT 'claude',
      title TEXT,
      source_file TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, session_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
  `);
  
  return db;
}

// 获取数据库实例
export function getDb() {
  if (!db) {
    initDatabase();
  }
  return db;
}

// ============ 项目操作 ============

// 获取所有项目 (不包括已删除的)
export function getProjects() {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, 
           (SELECT COUNT(*) FROM sessions WHERE project_id = p.id) as session_count
    FROM projects p 
    WHERE deleted = 0 
    ORDER BY created_at DESC
  `).all();
}

// 获取所有项目及其会话列表 (用于前端侧边栏)
export function getProjectsWithSessions(sessionLimit = 10) {
  const db = getDb();
  
  // 获取所有未删除的项目
  const projects = db.prepare(`
    SELECT id, original_path, display_name, created_at
    FROM projects 
    WHERE deleted = 0 
    ORDER BY created_at DESC
  `).all();
  
  // 获取每个项目的会话
  const getSessionsStmt = db.prepare(`
    SELECT session_id, provider, title, source_file, created_at, updated_at
    FROM sessions 
    WHERE project_id = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `);
  
  const getSessionCountStmt = db.prepare(`
    SELECT COUNT(*) as total FROM sessions WHERE project_id = ?
  `);
  
  return projects.map(project => {
    const sessions = getSessionsStmt.all(project.id, sessionLimit);
    const { total } = getSessionCountStmt.get(project.id);
    const projectPath = project.original_path;
    
    return {
      id: project.id,
      path: projectPath,
      displayName: project.display_name || projectPath.split('/').pop(),
      createdAt: project.created_at,
      sessions: sessions.map(s => ({
        id: s.session_id,
        provider: s.provider,
        title: s.title,
        sourceFile: s.source_file,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        lastActivity: s.updated_at  // 兼容旧字段
      })),
      sessionMeta: {
        total,
        hasMore: total > sessionLimit
      }
    };
  });
}

// 获取单个项目的会话列表（支持分页）
export function getSessionsByProjectIdPaginated(projectId, limit = 10, offset = 0) {
  const db = getDb();
  
  const sessions = db.prepare(`
    SELECT session_id, provider, title, source_file, created_at, updated_at
    FROM sessions 
    WHERE project_id = ?
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `).all(projectId, limit, offset);
  
  const { total } = db.prepare(`
    SELECT COUNT(*) as total FROM sessions WHERE project_id = ?
  `).get(projectId);
  
  return {
    sessions: sessions.map(s => ({
      id: s.session_id,
      provider: s.provider,
      title: s.title,
      sourceFile: s.source_file,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      lastActivity: s.updated_at
    })),
    hasMore: offset + limit < total,
    total,
    offset,
    limit
  };
}

// 同步单个项目的会话（从文件系统扫描并更新数据库）
export async function syncProjectSessionsById(projectId) {
  const project = getProjectById(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  
  const projectPath = project.original_path;
  // /data/codes/stock-quant -> -data-codes-stock-quant (Claude) / data-codes-stock-quant (CodeBuddy)
  const claudeProjectName = '-' + projectPath.replace(/^\//, '').replace(/\//g, '-');
  const codebuddyProjectName = projectPath.replace(/^\//, '').replace(/\//g, '-');
  
  const claudeDir = path.join(process.env.HOME, '.claude', 'projects', claudeProjectName);
  const codebuddyDir = path.join(process.env.HOME, '.codebuddy', 'projects', codebuddyProjectName);
  
  // 同步 Claude 会话
  await syncProjectSessionsFromDir(claudeDir, projectId, 'claude');
  
  // 同步 CodeBuddy 会话
  await syncProjectSessionsFromDir(codebuddyDir, projectId, 'codebuddy');
}

// 从指定目录同步会话到数据库
async function syncProjectSessionsFromDir(projectDir, projectId, provider) {
  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'));
    const isCodeBuddy = provider === 'codebuddy';
    
    for (const jsonlFile of jsonlFiles) {
      const sourceFile = path.join(projectDir, jsonlFile);
      
      if (isCodeBuddy) {
        // CodeBuddy: 文件名就是 sessionId
        const sessionId = path.basename(jsonlFile, '.jsonl');
        try {
          const info = await extractSessionInfo(sourceFile);
          createSession(projectId, sessionId, info.provider, info.title, sourceFile);
        } catch (e) {
          // 忽略单个文件错误
        }
      } else {
        // Claude: 需要从文件内容中提取所有 sessionId
        try {
          const sessionIds = await extractSessionIdsFromJsonl(sourceFile);
          for (const sessionId of sessionIds) {
            const info = await extractSessionInfoForSession(sourceFile, sessionId);
            createSession(projectId, sessionId, 'claude', info.title, sourceFile);
          }
        } catch (e) {
          // 忽略单个文件错误
        }
      }
    }
  } catch (e) {
    // 目录不存在或读取错误，忽略
  }
}

// 通过 ID 获取项目
export function getProjectById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM projects WHERE id = ? AND deleted = 0').get(id);
}

// 通过路径获取项目 (包括已删除的)
export function getProjectByPath(originalPath) {
  const db = getDb();
  return db.prepare('SELECT * FROM projects WHERE original_path = ?').get(originalPath);
}

// 添加或恢复项目
export function addProject(originalPath, displayName = null) {
  const db = getDb();
  const now = getBeijingTime();
  
  // 检查是否已存在
  const existing = getProjectByPath(originalPath);
  
  if (existing) {
    // 恢复已删除的项目
    if (existing.deleted) {
      db.prepare(`
        UPDATE projects 
        SET deleted = 0, display_name = COALESCE(?, display_name)
        WHERE id = ?
      `).run(displayName, existing.id);
    } else if (displayName && displayName !== existing.display_name) {
      // 更新显示名称
      db.prepare('UPDATE projects SET display_name = ? WHERE id = ?').run(displayName, existing.id);
    }
    return getProjectById(existing.id);
  }
  
  // 新增项目
  const result = db.prepare(`
    INSERT INTO projects (original_path, display_name, created_at) VALUES (?, ?, ?)
  `).run(originalPath, displayName || path.basename(originalPath), now);
  
  return getProjectById(result.lastInsertRowid);
}

// 删除项目 (软删除)
export function deleteProject(id) {
  const db = getDb();
  return db.prepare('UPDATE projects SET deleted = 1 WHERE id = ?').run(id);
}

// 更新项目显示名称
export function updateProjectDisplayName(id, displayName) {
  const db = getDb();
  return db.prepare('UPDATE projects SET display_name = ? WHERE id = ?').run(displayName, id);
}

// ============ 会话操作 ============

// 获取项目的所有会话
export function getSessionsByProjectId(projectId) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM sessions 
    WHERE project_id = ? 
    ORDER BY updated_at DESC
  `).all(projectId);
}

// 通过 ID 获取会话
export function getSessionById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

// 通过 session_id 和 project_id 获取会话
export function getSessionBySessionId(projectId, sessionId) {
  const db = getDb();
  return db.prepare('SELECT * FROM sessions WHERE project_id = ? AND session_id = ?').get(projectId, sessionId);
}

// 创建会话
export function createSession(projectId, sessionId, provider = 'claude', title = null, sourceFile = null) {
  const db = getDb();
  const now = getBeijingTime();
  
  // 检查是否已存在
  const existing = getSessionBySessionId(projectId, sessionId);
  if (existing) {
    // 已存在则跳过，不更新（避免打乱时间排序）
    return existing;
  }
  
  const result = db.prepare(`
    INSERT INTO sessions (project_id, session_id, provider, title, source_file, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(projectId, sessionId, provider, title, sourceFile, now, now);
  
  return getSessionById(result.lastInsertRowid);
}

// 更新会话
export function updateSession(id, updates) {
  const db = getDb();
  const now = getBeijingTime();
  const { provider, title, sourceFile } = updates;
  
  return db.prepare(`
    UPDATE sessions 
    SET provider = COALESCE(?, provider),
        title = COALESCE(?, title),
        source_file = COALESCE(?, source_file),
        updated_at = ?
    WHERE id = ?
  `).run(provider, title, sourceFile, now, id);
}

// 删除会话
export function deleteSession(id) {
  const db = getDb();
  return db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

// 通过 session_id 删除会话（用于删除磁盘文件后同步删除数据库记录）
export function deleteSessionBySessionId(sessionId) {
  const db = getDb();
  return db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
}

// ============ 同步功能 ============

// 从 JSONL 文件提取会话信息
async function extractSessionInfo(jsonlPath) {
  // 根据路径判断 provider 类型
  const provider = jsonlPath.includes('/.codebuddy/') ? 'codebuddy' : 'claude';
  
  return new Promise((resolve, reject) => {
    const fileStream = fsSync.createReadStream(jsonlPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    
    let title = null;
    let cwd = null;
    let firstUserMessage = null;
    
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const entry = JSON.parse(line);
        
        // 提取 cwd
        if (entry.cwd && !cwd) {
          cwd = entry.cwd;
        }
        
        // 提取第一条用户消息作为标题
        if (entry.type === 'user' && entry.message?.content && !firstUserMessage) {
          const content = typeof entry.message.content === 'string' 
            ? entry.message.content 
            : entry.message.content[0]?.text || '';
          firstUserMessage = content.slice(0, 100);
        }
      } catch (e) {
        // 忽略解析错误
      }
    });
    
    rl.on('close', () => {
      resolve({
        title: title || firstUserMessage || path.basename(jsonlPath, '.jsonl'),
        provider: provider,
        cwd
      });
    });
    
    rl.on('error', reject);
  });
}

// 从 Claude JSONL 文件中提取所有 sessionId
async function extractSessionIdsFromJsonl(jsonlPath) {
  const sessionIds = new Set();
  
  return new Promise((resolve, reject) => {
    const fileStream = fsSync.createReadStream(jsonlPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const entry = JSON.parse(line);
        if (entry.sessionId) {
          sessionIds.add(entry.sessionId);
        }
      } catch (e) {
        // 忽略解析错误
      }
    });
    
    rl.on('close', () => {
      resolve(Array.from(sessionIds));
    });
    
    rl.on('error', reject);
  });
}

// 从 Claude JSONL 文件中提取特定 sessionId 的信息
async function extractSessionInfoForSession(jsonlPath, targetSessionId) {
  return new Promise((resolve, reject) => {
    const fileStream = fsSync.createReadStream(jsonlPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    
    let title = null;
    let firstUserMessage = null;
    
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const entry = JSON.parse(line);
        
        // 只处理目标 sessionId 的条目
        if (entry.sessionId !== targetSessionId) return;
        
        // 提取 summary 作为标题
        if (entry.type === 'summary' && entry.summary && !title) {
          title = entry.summary;
        }
        
        // 提取第一条用户消息作为备选标题
        if (entry.type === 'user' && entry.message?.content && !firstUserMessage) {
          const content = typeof entry.message.content === 'string' 
            ? entry.message.content 
            : entry.message.content[0]?.text || '';
          if (content && !content.startsWith('<command-') && !content.startsWith('<system-')) {
            firstUserMessage = content.slice(0, 100);
          }
        }
      } catch (e) {
        // 忽略解析错误
      }
    });
    
    rl.on('close', () => {
      resolve({
        title: title || firstUserMessage || '新会话',
        provider: 'claude'
      });
    });
    
    rl.on('error', reject);
  });
}

// 从 CodeBuddy settings.json 加载 trustedDirectories
async function loadCodeBuddyTrustedDirectories() {
  const settingsPath = path.join(os.homedir(), '.codebuddy', 'settings.json');
  try {
    const content = await fs.readFile(settingsPath, 'utf8');
    const settings = JSON.parse(content);
    return settings.trustedDirectories || [];
  } catch {
    return [];
  }
}

// 将路径编码为目录名格式
// /data/codes/stock-quant -> data-codes-stock-quant
function encodePathToDirectoryName(projectPath) {
  return projectPath.replace(/^\//,'').replace(/\//g, '-');
}

// 从 trustedDirectories 中查找匹配的路径
function findTrustedPath(encodedName, trustedDirs) {
  const cleanName = encodedName.startsWith('-') ? encodedName.substring(1) : encodedName;
  
  for (const trustedPath of trustedDirs) {
    const encoded = encodePathToDirectoryName(trustedPath);
    if (encoded === cleanName) {
      return trustedPath;
    }
  }
  return null;
}

// Claude 路径解码 - 从编码的目录名生成可能的路径候选
function generatePathCandidates(encodedName) {
  const cleanName = encodedName.startsWith('-') ? encodedName.substring(1) : encodedName;
  const parts = cleanName.split('-');
  const candidates = [];
  
  const rootDirs = ['Users', 'home', 'opt', 'data', 'mnt', 'srv', 'root', 'var'];
  
  if (parts.length >= 3 && rootDirs.includes(parts[0])) {
    for (let pathPartCount = 3; pathPartCount <= parts.length; pathPartCount++) {
      const pathParts = parts.slice(0, pathPartCount);
      const remaining = parts.slice(pathPartCount);
      
      if (remaining.length > 0) {
        candidates.push('/' + pathParts.join('/') + '/' + remaining.join('-'));
      } else {
        candidates.push('/' + pathParts.join('/'));
      }
    }
  } else {
    candidates.push('/' + cleanName.replace(/-/g, '/'));
  }
  
  return candidates;
}

// 同步 Claude 和 CodeBuddy 项目
export async function syncProjects() {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  const codebuddyDir = path.join(os.homedir(), '.codebuddy', 'projects');
  
  const stats = { projects: 0, sessions: 0 };
  
  // 加载 CodeBuddy trustedDirectories
  const trustedDirs = await loadCodeBuddyTrustedDirectories();
  
  // 同步 Claude 项目
  async function syncClaudeProjects() {
    try {
      await fs.access(claudeDir);
    } catch {
      return;
    }
    
    const entries = await fs.readdir(claudeDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const projectDir = path.join(claudeDir, entry.name);
      const candidates = generatePathCandidates(entry.name);
      
      let validPath = null;
      for (const candidate of candidates) {
        try {
          await fs.access(candidate);
          validPath = candidate;
          break;
        } catch {
          // 继续尝试
        }
      }
      
      if (!validPath) continue;
      
      const project = addProject(validPath, path.basename(validPath));
      if (project) {
        stats.projects++;
        await syncProjectSessions(projectDir, project.id);
      }
    }
  }
  
  // 同步 CodeBuddy 项目 - 只从 trustedDirectories 获取路径
  async function syncCodeBuddyProjects() {
    try {
      await fs.access(codebuddyDir);
    } catch {
      return;
    }
    
    const entries = await fs.readdir(codebuddyDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const projectDir = path.join(codebuddyDir, entry.name);
      
      // 从 trustedDirectories 查找匹配的真实路径
      const validPath = findTrustedPath(entry.name, trustedDirs);
      
      if (!validPath) {
        // trustedDirectories 中找不到，跳过
        continue;
      }
      
      const project = addProject(validPath, path.basename(validPath));
      if (project) {
        stats.projects++;
        await syncProjectSessions(projectDir, project.id);
      }
    }
  }
  
  // 同步项目会话
  async function syncProjectSessions(projectDir, projectId) {
    try {
      const files = await fs.readdir(projectDir);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'));
      const isCodeBuddy = projectDir.includes('.codebuddy');
      
      for (const jsonlFile of jsonlFiles) {
        const sourceFile = path.join(projectDir, jsonlFile);
        
        if (isCodeBuddy) {
          // CodeBuddy: 文件名就是 sessionId
          const sessionId = path.basename(jsonlFile, '.jsonl');
          try {
            const info = await extractSessionInfo(sourceFile);
            createSession(projectId, sessionId, info.provider, info.title, sourceFile);
            stats.sessions++;
          } catch (e) {
            // 忽略单个文件错误
          }
        } else {
          // Claude: 需要从文件内容中提取所有 sessionId
          try {
            const sessionIds = await extractSessionIdsFromJsonl(sourceFile);
            for (const sessionId of sessionIds) {
              const info = await extractSessionInfoForSession(sourceFile, sessionId);
              createSession(projectId, sessionId, 'claude', info.title, sourceFile);
              stats.sessions++;
            }
          } catch (e) {
            // 忽略单个文件错误
          }
        }
      }
    } catch (e) {
      // 忽略读取错误
    }
  }
  
  await syncClaudeProjects();
  await syncCodeBuddyProjects();
  
  return stats;
}

// 关闭数据库
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

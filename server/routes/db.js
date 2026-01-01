import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getProjects,
  getProjectById,
  addProject,
  deleteProject,
  updateProjectDisplayName,
  getSessionsByProjectId,
  getSessionBySessionId,
  createSession,
  updateSession,
  deleteSession,
  syncProjects
} from '../db.js';
import { clearProjectDirectoryCache } from '../projects.js';
import fs from 'fs/promises';

const router = express.Router();

// ============ 项目 API ============

// 获取所有项目
router.get('/projects', authenticateToken, (req, res) => {
  try {
    const projects = getProjects();
    res.json(projects);
  } catch (error) {
    console.error('[DB] Get projects error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取单个项目
router.get('/projects/:id', authenticateToken, (req, res) => {
  try {
    const project = getProjectById(parseInt(req.params.id));
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json(project);
  } catch (error) {
    console.error('[DB] Get project error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 添加项目
router.post('/projects', authenticateToken, async (req, res) => {
  try {
    const { originalPath, displayName } = req.body;
    
    if (!originalPath) {
      return res.status(400).json({ error: 'originalPath is required' });
    }
    
    // 验证路径存在
    try {
      await fs.access(originalPath);
    } catch {
      return res.status(400).json({ error: 'Path does not exist' });
    }
    
    const project = addProject(originalPath, displayName);
    res.json(project);
  } catch (error) {
    console.error('[DB] Add project error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 删除项目
router.delete('/projects/:id', authenticateToken, (req, res) => {
  try {
    const result = deleteProject(parseInt(req.params.id));
    res.json({ success: result.changes > 0 });
  } catch (error) {
    console.error('[DB] Delete project error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 更新项目显示名称
router.patch('/projects/:id', authenticateToken, (req, res) => {
  try {
    const { displayName } = req.body;
    if (!displayName) {
      return res.status(400).json({ error: 'displayName is required' });
    }
    
    const result = updateProjectDisplayName(parseInt(req.params.id), displayName);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const project = getProjectById(parseInt(req.params.id));
    res.json(project);
  } catch (error) {
    console.error('[DB] Update project error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ 会话 API ============

// 获取项目的所有会话
router.get('/projects/:id/sessions', authenticateToken, (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const project = getProjectById(projectId);
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const sessions = getSessionsByProjectId(projectId);
    res.json(sessions);
  } catch (error) {
    console.error('[DB] Get sessions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 创建会话
router.post('/projects/:id/sessions', authenticateToken, (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const { sessionId, provider, title, sourceFile } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    
    const project = getProjectById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const session = createSession(projectId, sessionId, provider, title, sourceFile);
    res.json(session);
  } catch (error) {
    console.error('[DB] Create session error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 更新会话
router.patch('/sessions/:id', authenticateToken, (req, res) => {
  try {
    const { provider, title, sourceFile } = req.body;
    const result = updateSession(parseInt(req.params.id), { provider, title, sourceFile });
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('[DB] Update session error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 通过 project_id 和 session_id 更新会话标题
router.patch('/projects/:projectId/sessions/:sessionId/title', authenticateToken, (req, res) => {
  try {
    const { projectId, sessionId } = req.params;
    const { title } = req.body;
    
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }
    
    // 先通过 project_id 和 session_id 获取会话的数据库 id
    const session = getSessionBySessionId(parseInt(projectId), sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const result = updateSession(session.id, { title: title.trim() });
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Failed to update session' });
    }
    
    res.json({ success: true, title: title.trim() });
  } catch (error) {
    console.error('[DB] Update session title error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 删除会话
router.delete('/sessions/:id', authenticateToken, (req, res) => {
  try {
    const result = deleteSession(parseInt(req.params.id));
    res.json({ success: result.changes > 0 });
  } catch (error) {
    console.error('[DB] Delete session error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ 同步 API ============

// 同步 Claude/CodeBuddy 项目
router.post('/sync', authenticateToken, async (req, res) => {
  try {
    // Clear cache before sync to ensure fresh path resolution
    clearProjectDirectoryCache();
    const stats = await syncProjects();
    res.json({ 
      success: true, 
      message: `Synced ${stats.projects} projects and ${stats.sessions} sessions`,
      ...stats 
    });
  } catch (error) {
    console.error('[DB] Sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { addProject, getProjectByPath, getProjectById } from '../db.js';

const router = express.Router();

/**
 * Truncate session messages up to a specific timestamp
 * PUT /api/projects/:projectId/sessions/:sessionId/truncate
 * 
 * Body: { keepUntilTimestamp: ISO timestamp string }
 * 
 * Deletes all messages after the specified timestamp in the session's JSONL file
 */
router.put('/:projectId/sessions/:sessionId/truncate', async (req, res) => {
  try {
    const { projectId, sessionId } = req.params;
    const { keepUntilTimestamp } = req.body;

    if (!keepUntilTimestamp) {
      return res.status(400).json({ error: 'keepUntilTimestamp is required' });
    }

    const cutoffTime = new Date(keepUntilTimestamp);
    if (isNaN(cutoffTime.getTime())) {
      return res.status(400).json({ error: 'Invalid timestamp format' });
    }

    // Get project from database
    const project = getProjectById(parseInt(projectId, 10));
    if (!project) {
      return res.status(404).json({ error: `Project not found: ${projectId}` });
    }

    const projectPath = project.original_path;
    // Convert path to directory name format: /data/codes/stock-quant -> data-codes-stock-quant
    const projectDirName = projectPath.replace(/^\//, '').replace(/\//g, '-');

    // Determine JSONL file path based on provider
    // Try Claude first, then CodeBuddy
    const claudeDir = path.join(os.homedir(), '.claude', 'projects', '-' + projectDirName);
    const codebuddyDir = path.join(os.homedir(), '.codebuddy', 'projects', projectDirName);

    let jsonlFile = null;
    let provider = null;

    // Check Claude first
    try {
      await fs.access(claudeDir);
      jsonlFile = path.join(claudeDir, `${sessionId}.jsonl`);
      provider = 'claude';
      // Check if the session file exists in Claude directory
      try {
        await fs.access(jsonlFile);
      } catch (fileErr) {
        // File doesn't exist in Claude, try CodeBuddy
        throw new Error('Session file not in Claude directory');
      }
    } catch (err) {
      // Try CodeBuddy
      try {
        await fs.access(codebuddyDir);
        jsonlFile = path.join(codebuddyDir, `${sessionId}.jsonl`);
        provider = 'codebuddy';
      } catch (err2) {
        return res.status(404).json({ error: 'Project directory not found' });
      }
    }

    // Read JSONL file
    let fileContent;
    try {
      fileContent = await fs.readFile(jsonlFile, 'utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'Session file not found', path: jsonlFile });
      }
      throw err;
    }

    // Parse messages
    const lines = fileContent.trim().split('\n').filter(line => line.trim());
    const allMessages = lines.map(line => JSON.parse(line));

    // Filter messages: keep only those with timestamp <= cutoffTime
    const filteredMessages = allMessages.filter(msg => {
      if (!msg.timestamp) return true; // Keep messages without timestamp
      const messageTime = new Date(msg.timestamp);
      return messageTime <= cutoffTime;
    });

    const deletedCount = allMessages.length - filteredMessages.length;

    // Write back to file
    const newContent = filteredMessages.map(msg => JSON.stringify(msg)).join('\n') + (filteredMessages.length > 0 ? '\n' : '');
    await fs.writeFile(jsonlFile, newContent, 'utf-8');

    res.json({
      success: true,
      deletedCount,
      keptCount: filteredMessages.length,
      provider
    });

  } catch (error) {
    console.error('Error truncating session:', error);
    res.status(500).json({
      error: error.message || 'Failed to truncate session'
    });
  }
});

/**
 * 添加项目（简化版）
 * POST /api/projects/add
 *
 * Body:
 * - path: string (项目路径)
 * 
 * 逻辑：
 * 1. 验证路径存在且是目录
 * 2. 检查数据库是否已有该路径
 *    - 如果已有且未删除，返回已存在
 *    - 如果已有但已删除，恢复（设置 deleted = 0）
 *    - 如果没有，新增记录
 */
router.post('/add', async (req, res) => {
  try {
    const { path: projectPath } = req.body;

    // 验证必填字段
    if (!projectPath) {
      return res.status(400).json({ error: '请提供项目路径' });
    }

    // 解析为绝对路径
    const absolutePath = path.resolve(projectPath.replace(/^~/, os.homedir()));

    // 验证路径存在且是目录
    try {
      const stats = await fs.stat(absolutePath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: '路径不是目录' });
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: '路径不存在' });
      }
      throw error;
    }

    // 检查数据库是否已有该路径
    const existing = getProjectByPath(absolutePath);
    
    if (existing) {
      if (existing.deleted) {
        // 恢复已删除的项目
        const project = addProject(absolutePath, existing.display_name);
        return res.json({
          success: true,
          project,
          message: '项目已恢复'
        });
      } else {
        // 项目已存在
        return res.status(400).json({ error: '项目已存在' });
      }
    }

    // 新增项目
    const displayName = path.basename(absolutePath);
    const project = addProject(absolutePath, displayName);

    return res.json({
      success: true,
      project,
      message: '项目添加成功'
    });

  } catch (error) {
    console.error('添加项目失败:', error);
    res.status(500).json({
      error: error.message || '添加项目失败'
    });
  }
});

export default router;

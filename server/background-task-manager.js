/**
 * Background Task Manager (Simplified)
 * 
 * 极简版后台任务管理器：
 * - 跟踪运行中的任务（sessionId -> taskInfo）
 * - 任务在后台持续运行，客户端断开不影响
 * - 只有手动 abort 才终止任务
 * - 不缓存消息（重连时前端会拉历史数据）
 */

// ============================================================================
//  数据结构
// ============================================================================

// sessionId -> { provider, projectPath, abortFn, startTime }
const runningTasks = new Map();

// ============================================================================
//  核心 API
// ============================================================================

/**
 * 注册一个后台任务
 * @param {string} sessionId - 会话ID
 * @param {string} provider - 提供者类型 (claude/cursor/codebuddy)
 * @param {string} projectPath - 项目路径
 * @param {Function} abortFn - 终止任务的函数
 */
function registerTask(sessionId, provider, projectPath, abortFn = null) {
  runningTasks.set(sessionId, {
    provider,
    projectPath,
    abortFn,
    startTime: Date.now()
  });
  console.log(`[BGTask] 注册任务: ${sessionId} (${provider})`);
}

/**
 * 更新任务的 sessionId（用于新会话获取真实ID后更新）
 * @param {string} oldId - 旧ID（临时ID）
 * @param {string} newId - 新ID（真实sessionId）
 */
function updateTaskId(oldId, newId) {
  const task = runningTasks.get(oldId);
  if (task && oldId !== newId) {
    runningTasks.delete(oldId);
    runningTasks.set(newId, task);
    console.log(`[BGTask] 更新任务ID: ${oldId} -> ${newId}`);
  }
}

/**
 * 设置任务的终止函数
 * @param {string} sessionId - 会话ID
 * @param {Function} abortFn - 终止函数
 */
function setAbortFn(sessionId, abortFn) {
  const task = runningTasks.get(sessionId);
  if (task) {
    task.abortFn = abortFn;
  }
}

/**
 * 标记任务完成
 * @param {string} sessionId - 会话ID
 */
function completeTask(sessionId) {
  if (runningTasks.has(sessionId)) {
    runningTasks.delete(sessionId);
    console.log(`[BGTask] 任务完成: ${sessionId}`);
  }
}

/**
 * 终止任务（手动停止）
 * @param {string} sessionId - 会话ID
 * @returns {boolean} 是否成功终止
 */
async function abortTask(sessionId) {
  const task = runningTasks.get(sessionId);
  if (!task) {
    return false;
  }

  console.log(`[BGTask] 终止任务: ${sessionId}`);
  
  // 调用终止函数（可能是 async 函数）
  if (task.abortFn && typeof task.abortFn === 'function') {
    try {
      // 使用 await 等待 async abortFn 完成，并捕获可能的异常
      await Promise.resolve(task.abortFn()).catch(e => {
        console.error(`[BGTask] 终止任务出错:`, e.message);
      });
    } catch (e) {
      console.error(`[BGTask] 终止任务出错:`, e.message);
    }
  }

  runningTasks.delete(sessionId);
  return true;
}

/**
 * 检查任务是否正在运行
 * @param {string} sessionId - 会话ID
 * @returns {boolean}
 */
function isTaskRunning(sessionId) {
  return runningTasks.has(sessionId);
}

/**
 * 获取所有运行中的任务
 * @returns {Array} 任务列表
 */
function getRunningTasks() {
  const tasks = [];
  for (const [sessionId, task] of runningTasks) {
    tasks.push({
      sessionId,
      provider: task.provider,
      projectPath: task.projectPath,
      startTime: task.startTime
    });
  }
  return tasks;
}

/**
 * 获取指定项目的运行中任务
 * @param {string} projectPath - 项目路径
 * @returns {Array} 任务列表
 */
function getTasksByProject(projectPath) {
  const tasks = [];
  for (const [sessionId, task] of runningTasks) {
    if (task.projectPath === projectPath) {
      tasks.push({
        sessionId,
        provider: task.provider,
        startTime: task.startTime
      });
    }
  }
  return tasks;
}

// ============================================================================
//  导出
// ============================================================================

export {
  registerTask,
  updateTaskId,
  setAbortFn,
  completeTask,
  abortTask,
  isTaskRunning,
  getRunningTasks,
  getTasksByProject
};

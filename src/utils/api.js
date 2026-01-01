// Utility function for authenticated API calls
export const authenticatedFetch = (url, options = {}) => {
  const isPlatform = import.meta.env.VITE_IS_PLATFORM === 'true';
  const token = localStorage.getItem('auth-token');

  // Check if headers is explicitly provided (even if empty object)
  // If empty object is passed, don't set Content-Type (for FormData uploads)
  const hasExplicitHeaders = 'headers' in options;
  const isEmptyHeaders = hasExplicitHeaders && Object.keys(options.headers || {}).length === 0;

  // For FormData uploads (empty headers), we must NOT set Content-Type
  // The browser will automatically set it with the correct boundary
  if (isEmptyHeaders) {
    // Create a new options object without the headers property
    const { headers: _ignoredHeaders, ...restOptions } = options;
    
    // Only add Authorization header for non-platform mode
    if (!isPlatform && token) {
      return fetch(url, {
        ...restOptions,
        headers: {
          'Authorization': `Bearer ${token}`,
          // DO NOT set Content-Type here - let browser handle it for FormData
        },
      });
    }
    
    // No auth needed, let browser handle everything
    return fetch(url, restOptions);
  }

  // For regular requests, set Content-Type and merge headers
  const headers = {
    'Content-Type': 'application/json',
  };

  if (!isPlatform && token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Merge with provided headers
  if (options.headers) {
    Object.assign(headers, options.headers);
  }

  return fetch(url, {
    ...options,
    headers,
  });
};

// Get project identifier for API calls (uses database id)
export const getProjectId = (project) => {
  if (!project) return null;
  return project.id;
};

// API endpoints
export const api = {
  // Auth endpoints (no token required)
  auth: {
    status: () => fetch('/api/auth/status'),
    login: (username, password) => fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    register: (username, password) => fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    user: () => authenticatedFetch('/api/auth/user'),
    logout: () => authenticatedFetch('/api/auth/logout', { method: 'POST' }),
  },

  // Protected endpoints
  // config endpoint removed - no longer needed (frontend uses window.location)
  projects: () => authenticatedFetch('/api/projects'),
  sessions: (projectId, limit = 5, offset = 0) => 
    authenticatedFetch(`/api/projects/${projectId}/sessions?limit=${limit}&offset=${offset}`),
  sessionMessages: (projectId, sessionId, limit = null, offset = 0) => {
    const params = new URLSearchParams();
    if (limit !== null) {
      params.append('limit', limit);
      params.append('offset', offset);
    }
    const queryString = params.toString();
    const url = `/api/projects/${projectId}/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`;
    return authenticatedFetch(url);
  },
  renameProject: (projectId, displayName) =>
    authenticatedFetch(`/api/projects/${projectId}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ displayName }),
    }),
  deleteSession: (projectId, sessionId) =>
    authenticatedFetch(`/api/projects/${projectId}/sessions/${sessionId}`, {
      method: 'DELETE',
    }),
  deleteProject: (projectId) =>
    authenticatedFetch(`/api/projects/${projectId}`, {
      method: 'DELETE',
    }),
  createProject: (path) =>
    authenticatedFetch('/api/projects/create', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  // 添加项目（简化版：只需要路径）
  addProject: (projectPath) =>
    authenticatedFetch('/api/projects/add', {
      method: 'POST',
      body: JSON.stringify({ path: projectPath }),
    }),
  readFile: (projectId, filePath) =>
    authenticatedFetch(`/api/projects/${projectId}/file?filePath=${encodeURIComponent(filePath)}`),
  saveFile: (projectId, filePath, content) =>
    authenticatedFetch(`/api/projects/${projectId}/file`, {
      method: 'PUT',
      body: JSON.stringify({ filePath, content }),
    }),
  getFiles: (projectId, options = {}) => {
    const params = new URLSearchParams();
    if (options.depth) params.append('depth', options.depth);
    if (options.path) params.append('path', options.path);
    const queryString = params.toString();
    return authenticatedFetch(`/api/projects/${projectId}/files${queryString ? `?${queryString}` : ''}`);
  },
  transcribe: (formData) =>
    authenticatedFetch('/api/transcribe', {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set Content-Type for FormData
    }),
  
  // Browse filesystem for project suggestions
  browseFilesystem: (dirPath = null) => {
    const params = new URLSearchParams();
    if (dirPath) params.append('path', dirPath);

    return authenticatedFetch(`/api/browse-filesystem?${params}`);
  },

  // User endpoints
  user: {
    gitConfig: () => authenticatedFetch('/api/user/git-config'),
    updateGitConfig: (gitName, gitEmail) =>
      authenticatedFetch('/api/user/git-config', {
        method: 'POST',
        body: JSON.stringify({ gitName, gitEmail }),
      }),
    onboardingStatus: () => authenticatedFetch('/api/user/onboarding-status'),
    completeOnboarding: () =>
      authenticatedFetch('/api/user/complete-onboarding', {
        method: 'POST',
      }),
  },

  // Database API (SQLite-based project management)
  db: {
    // Projects
    getProjects: () => authenticatedFetch('/api/db/projects'),
    getProject: (id) => authenticatedFetch(`/api/db/projects/${id}`),
    addProject: (originalPath, displayName = null) =>
      authenticatedFetch('/api/db/projects', {
        method: 'POST',
        body: JSON.stringify({ originalPath, displayName }),
      }),
    deleteProject: (id) =>
      authenticatedFetch(`/api/db/projects/${id}`, {
        method: 'DELETE',
      }),
    updateProject: (id, displayName) =>
      authenticatedFetch(`/api/db/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ displayName }),
      }),
    
    // Sessions
    getSessions: (projectId) => authenticatedFetch(`/api/db/projects/${projectId}/sessions`),
    createSession: (projectId, sessionId, model = 'claude', title = null) =>
      authenticatedFetch(`/api/db/projects/${projectId}/sessions`, {
        method: 'POST',
        body: JSON.stringify({ sessionId, model, title }),
      }),
    deleteSession: (sessionId) =>
      authenticatedFetch(`/api/db/sessions/${sessionId}`, {
        method: 'DELETE',
      }),
    
    // Sync
    sync: () =>
      authenticatedFetch('/api/db/sync', {
        method: 'POST',
      }),
  },

  // Generic GET method for any endpoint
  get: (endpoint) => authenticatedFetch(`/api${endpoint}`),
};
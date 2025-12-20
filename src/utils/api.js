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
  sessions: (projectName, limit = 5, offset = 0) => 
    authenticatedFetch(`/api/projects/${projectName}/sessions?limit=${limit}&offset=${offset}`),
  sessionMessages: (projectName, sessionId, limit = null, offset = 0) => {
    const params = new URLSearchParams();
    if (limit !== null) {
      params.append('limit', limit);
      params.append('offset', offset);
    }
    const queryString = params.toString();
    const url = `/api/projects/${projectName}/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`;
    return authenticatedFetch(url);
  },
  renameProject: (projectName, displayName) =>
    authenticatedFetch(`/api/projects/${projectName}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ displayName }),
    }),
  deleteSession: (projectName, sessionId) =>
    authenticatedFetch(`/api/projects/${projectName}/sessions/${sessionId}`, {
      method: 'DELETE',
    }),
  deleteProject: (projectName) =>
    authenticatedFetch(`/api/projects/${projectName}`, {
      method: 'DELETE',
    }),
  createProject: (path) =>
    authenticatedFetch('/api/projects/create', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  createWorkspace: (workspaceData) =>
    authenticatedFetch('/api/projects/create-workspace', {
      method: 'POST',
      body: JSON.stringify(workspaceData),
    }),
  readFile: (projectName, filePath) =>
    authenticatedFetch(`/api/projects/${projectName}/file?filePath=${encodeURIComponent(filePath)}`),
  saveFile: (projectName, filePath, content) =>
    authenticatedFetch(`/api/projects/${projectName}/file`, {
      method: 'PUT',
      body: JSON.stringify({ filePath, content }),
    }),
  getFiles: (projectName) =>
    authenticatedFetch(`/api/projects/${projectName}/files`),
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

  // Generic GET method for any endpoint
  get: (endpoint) => authenticatedFetch(`/api${endpoint}`),
};
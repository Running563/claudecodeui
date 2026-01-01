import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { ConfirmDialog } from './ui/confirm-dialog';
import { X, Plus, Settings as SettingsIcon, Shield, AlertTriangle, Moon, Sun, Server, Edit3, Trash2, Globe, Terminal, Zap, FolderOpen, LogIn, Key, GitBranch, Check } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useBackClose } from '../hooks/useBackClose';
import ClaudeLogo from './ClaudeLogo';
import CodeBuddyLogo from './CodeBuddyLogo';
import CredentialsSettings from './CredentialsSettings';
import GitSettings from './GitSettings';
import LoginModal from './LoginModal';
import { authenticatedFetch } from '../utils/api';

function Settings({ isOpen, onClose, projects = [], initialTab = 'tools' }) {
  const { isDarkMode, toggleDarkMode } = useTheme();
  
  // Support closing via browser back button (especially useful on mobile)
  useBackClose(isOpen, onClose, 'settings');
  
  const [allowedTools, setAllowedTools] = useState([]);
  const [disallowedTools, setDisallowedTools] = useState([]);
  const [newAllowedTool, setNewAllowedTool] = useState('');
  const [newDisallowedTool, setNewDisallowedTool] = useState('');
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [projectSortOrder, setProjectSortOrder] = useState('name');

  const [mcpServers, setMcpServers] = useState([]);
  const [showMcpForm, setShowMcpForm] = useState(false);
  const [editingMcpServer, setEditingMcpServer] = useState(null);
  const [mcpFormData, setMcpFormData] = useState({
    name: '',
    type: 'stdio',
    scope: 'user',
    projectPath: '', // For local scope
    config: {
      command: '',
      args: [],
      env: {},
      url: '',
      headers: {},
      timeout: 30000
    },
    jsonInput: '', // For JSON import
    importMode: 'form' // 'form' or 'json'
  });
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpTestResults, setMcpTestResults] = useState({});
  const [mcpServerTools, setMcpServerTools] = useState({});
  const [mcpToolsLoading, setMcpToolsLoading] = useState({});
  const [activeTab, setActiveTab] = useState(initialTab);
  const [jsonValidationError, setJsonValidationError] = useState('');
  const [toolsProvider, setToolsProvider] = useState('claude'); // 'claude' or 'cursor'
  
  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null
  });

  // Code Editor settings
  const [codeEditorTheme, setCodeEditorTheme] = useState(() =>
    localStorage.getItem('codeEditorTheme') || 'dark'
  );
  const [codeEditorWordWrap, setCodeEditorWordWrap] = useState(() =>
    localStorage.getItem('codeEditorWordWrap') === 'true'
  );
  const [codeEditorLineNumbers, setCodeEditorLineNumbers] = useState(() =>
    localStorage.getItem('codeEditorLineNumbers') !== 'false' // Default true
  );
  const [codeEditorFontSize, setCodeEditorFontSize] = useState(() =>
    localStorage.getItem('codeEditorFontSize') || '14'
  );
  


  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginProvider, setLoginProvider] = useState('');
  const [selectedProject, setSelectedProject] = useState(null);

  const [claudeAuthStatus, setClaudeAuthStatus] = useState({
    authenticated: false,
    email: null,
    loading: true,
    error: null
  });

  
  const [codebuddyAuthStatus, setCodeBuddyAuthStatus] = useState({
    authenticated: false,
    email: null,
    loading: true,
    error: null
  });

  // Common tool patterns for Claude
  const commonTools = [
    'Bash(git log:*)',
    'Bash(git diff:*)',
    'Bash(git status:*)',
    'Write',
    'Read',
    'Edit',
    'Glob',
    'Grep',
    'MultiEdit',
    'Task',
    'TodoWrite',
    'TodoRead',
    'WebFetch',
    'WebSearch'
  ];
  

  
  // MCP API functions
  const fetchMcpServers = async () => {
    try {
      // Try to read directly from config files for complete details
      const configResponse = await authenticatedFetch('/api/mcp/config/read');

      if (configResponse.ok) {
        const configData = await configResponse.json();
        if (configData.success && configData.servers) {
          setMcpServers(configData.servers);
          return;
        }
      }

      // Fallback to Claude CLI
      const cliResponse = await authenticatedFetch('/api/mcp/cli/list');

      if (cliResponse.ok) {
        const cliData = await cliResponse.json();
        if (cliData.success && cliData.servers) {
          // Convert CLI format to our format
          const servers = cliData.servers.map(server => ({
            id: server.name,
            name: server.name,
            type: server.type,
            scope: 'user',
            config: {
              command: server.command || '',
              args: server.args || [],
              env: server.env || {},
              url: server.url || '',
              headers: server.headers || {},
              timeout: 30000
            },
            created: new Date().toISOString(),
            updated: new Date().toISOString()
          }));
          setMcpServers(servers);
          return;
        }
      }

      // Final fallback to direct config reading
      const response = await authenticatedFetch('/api/mcp/servers?scope=user');

      if (response.ok) {
        const data = await response.json();
        setMcpServers(data.servers || []);
      } else {
        console.error('Failed to fetch MCP servers');
      }
    } catch (error) {
      console.error('Error fetching MCP servers:', error);
    }
  };

  const saveMcpServer = async (serverData) => {
    try {
      if (editingMcpServer) {
        // For editing, remove old server and add new one
        await deleteMcpServer(editingMcpServer.id, 'user');
      }

      // Use Claude CLI to add the server
      const response = await authenticatedFetch('/api/mcp/cli/add', {
        method: 'POST',
        body: JSON.stringify({
          name: serverData.name,
          type: serverData.type,
          scope: serverData.scope,
          projectPath: serverData.projectPath,
          command: serverData.config?.command,
          args: serverData.config?.args || [],
          url: serverData.config?.url,
          headers: serverData.config?.headers || {},
          env: serverData.config?.env || {}
        })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          await fetchMcpServers(); // Refresh the list
          return true;
        } else {
          throw new Error(result.error || 'Failed to save server via Claude CLI');
        }
      } else {
        const error = await response.json();
        throw new Error(error.error || '保存服务器失败');
      }
    } catch (error) {
      console.error('Error saving MCP server:', error);
      throw error;
    }
  };

  const deleteMcpServer = async (serverId, scope = 'user') => {
    try {
      // Use Claude CLI to remove the server with proper scope
      const response = await authenticatedFetch(`/api/mcp/cli/remove/${serverId}?scope=${scope}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          await fetchMcpServers(); // Refresh the list
          return true;
        } else {
          throw new Error(result.error || '通过 Claude CLI 删除服务器失败');
        }
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete server');
      }
    } catch (error) {
      console.error('Error deleting MCP server:', error);
      throw error;
    }
  };

  const testMcpServer = async (serverId, scope = 'user') => {
    try {
      const response = await authenticatedFetch(`/api/mcp/servers/${serverId}/test?scope=${scope}`, {
        method: 'POST'
      });

      if (response.ok) {
        const data = await response.json();
        return data.testResult;
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to test server');
      }
    } catch (error) {
      console.error('Error testing MCP server:', error);
      throw error;
    }
  };


  const discoverMcpTools = async (serverId, scope = 'user') => {
    try {
      const response = await authenticatedFetch(`/api/mcp/servers/${serverId}/tools?scope=${scope}`, {
        method: 'POST'
      });

      if (response.ok) {
        const data = await response.json();
        return data.toolsResult;
      } else {
        const error = await response.json();
        throw new Error(error.error || '发现工具失败');
      }
    } catch (error) {
      console.error('Error discovering MCP tools:', error);
      throw error;
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadSettings();
      checkClaudeAuthStatus();
      checkCodeBuddyAuthStatus();
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Persist code editor settings to localStorage
  useEffect(() => {
    localStorage.setItem('codeEditorTheme', codeEditorTheme);
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorTheme]);

  useEffect(() => {
    localStorage.setItem('codeEditorWordWrap', codeEditorWordWrap.toString());
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorWordWrap]);

  useEffect(() => {
    localStorage.setItem('codeEditorLineNumbers', codeEditorLineNumbers.toString());
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorLineNumbers]);

  useEffect(() => {
    localStorage.setItem('codeEditorFontSize', codeEditorFontSize);
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorFontSize]);

  const loadSettings = async () => {
    try {
      
      // Load Claude settings from localStorage
      const savedSettings = localStorage.getItem('claude-settings');
      
      if (savedSettings) {
        const settings = JSON.parse(savedSettings);
        setAllowedTools(settings.allowedTools || []);
        setDisallowedTools(settings.disallowedTools || []);
        setSkipPermissions(settings.skipPermissions || false);
        setProjectSortOrder(settings.projectSortOrder || 'name');
      } else {
        // Set defaults
        setAllowedTools([]);
        setDisallowedTools([]);
        setSkipPermissions(false);
        setProjectSortOrder('name');
      }
      
      // Load MCP servers from API
      await fetchMcpServers();
    } catch (error) {
      console.error('Error loading tool settings:', error);
      setAllowedTools([]);
      setDisallowedTools([]);
      setSkipPermissions(false);
      setProjectSortOrder('name');
    }
  };

  const checkClaudeAuthStatus = async () => {
    try {
      const response = await authenticatedFetch('/api/cli/claude/status');

      if (response.ok) {
        const data = await response.json();
        setClaudeAuthStatus({
          authenticated: data.authenticated,
          email: data.email,
          loading: false,
          error: data.error || null
        });
      } else {
        setClaudeAuthStatus({
          authenticated: false,
          email: null,
          loading: false,
          error: 'Failed to check authentication status'
        });
      }
    } catch (error) {
      console.error('Error checking Claude auth status:', error);
      setClaudeAuthStatus({
        authenticated: false,
        email: null,
        loading: false,
        error: error.message
      });
    }
  };



  const checkCodeBuddyAuthStatus = async () => {
    try {
      const response = await authenticatedFetch('/api/cli/codebuddy/status');

      if (response.ok) {
        const data = await response.json();
        setCodeBuddyAuthStatus({
          authenticated: data.authenticated,
          email: data.email,
          loading: false,
          error: data.error || null
        });
      } else {
        setCodeBuddyAuthStatus({
          authenticated: false,
          email: null,
          loading: false,
          error: 'Failed to check authentication status'
        });
      }
    } catch (error) {
      console.error('Error checking CodeBuddy auth status:', error);
      setCodeBuddyAuthStatus({
        authenticated: false,
        email: null,
        loading: false,
        error: error.message
      });
    }
  };
  const handleClaudeLogin = () => {
    setLoginProvider('claude');
    setSelectedProject(projects?.[0] || { name: 'default', path: process.cwd() });
    setShowLoginModal(true);
  };

  const handleCodeBuddyLogin = () => {
    setLoginProvider('codebuddy');
    setSelectedProject(projects?.[0] || { name: 'default', path: process.cwd() });
    setShowLoginModal(true);
  };

  const handleLoginComplete = (exitCode) => {
    if (exitCode === 0) {
      setSaveStatus('success');

      if (loginProvider === 'claude') {
        checkClaudeAuthStatus();
      } else if (loginProvider === 'codebuddy') {
        checkCodeBuddyAuthStatus();
      }
    }
  };

  const saveSettings = () => {
    setIsSaving(true);
    setSaveStatus(null);
    
    try {
      // Save Claude settings
      const claudeSettings = {
        allowedTools,
        disallowedTools,
        skipPermissions,
        projectSortOrder,
        lastUpdated: new Date().toISOString()
      };
      
      // Save to localStorage
      localStorage.setItem('claude-settings', JSON.stringify(claudeSettings));
      
      setSaveStatus('success');
      
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (error) {
      console.error('Error saving tool settings:', error);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const addAllowedTool = (tool) => {
    if (tool && !allowedTools.includes(tool)) {
      setAllowedTools([...allowedTools, tool]);
      setNewAllowedTool('');
    }
  };

  const removeAllowedTool = (tool) => {
    setAllowedTools(allowedTools.filter(t => t !== tool));
  };

  const addDisallowedTool = (tool) => {
    if (tool && !disallowedTools.includes(tool)) {
      setDisallowedTools([...disallowedTools, tool]);
      setNewDisallowedTool('');
    }
  };

  const removeDisallowedTool = (tool) => {
    setDisallowedTools(disallowedTools.filter(t => t !== tool));
  };

  // MCP form handling functions
  const resetMcpForm = () => {
    setMcpFormData({
      name: '',
      type: 'stdio',
      scope: 'user', // Default to user scope
      projectPath: '',
      config: {
        command: '',
        args: [],
        env: {},
        url: '',
        headers: {},
        timeout: 30000
      },
      jsonInput: '',
      importMode: 'form'
    });
    setEditingMcpServer(null);
    setShowMcpForm(false);
    setJsonValidationError('');
  };

  const openMcpForm = (server = null) => {
    if (server) {
      setEditingMcpServer(server);
      setMcpFormData({
        name: server.name,
        type: server.type,
        scope: server.scope,
        projectPath: server.projectPath || '',
        config: { ...server.config },
        raw: server.raw, // Store raw config for display
        importMode: 'form', // Always use form mode when editing
        jsonInput: ''
      });
    } else {
      resetMcpForm();
    }
    setShowMcpForm(true);
  };

  const handleMcpSubmit = async (e) => {
    e.preventDefault();
    
    setMcpLoading(true);
    
    try {
      if (mcpFormData.importMode === 'json') {
        // Use JSON import endpoint
        const response = await authenticatedFetch('/api/mcp/cli/add-json', {
          method: 'POST',
          body: JSON.stringify({
            name: mcpFormData.name,
            jsonConfig: mcpFormData.jsonInput,
            scope: mcpFormData.scope,
            projectPath: mcpFormData.projectPath
          })
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            await fetchMcpServers(); // Refresh the list
            resetMcpForm();
            setSaveStatus('success');
          } else {
            throw new Error(result.error || '通过 JSON 添加服务器失败');
          }
        } else {
          const error = await response.json();
          throw new Error(error.error || 'Failed to add server');
        }
      } else {
        // Use regular form-based save
        await saveMcpServer(mcpFormData);
        resetMcpForm();
        setSaveStatus('success');
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
      setSaveStatus('error');
    } finally {
      setMcpLoading(false);
    }
  };

  const handleMcpDelete = async (serverId, scope) => {
    setConfirmDialog({
      isOpen: true,
      title: '删除 MCP 服务器',
      message: '确定要删除此 MCP 服务器吗？',
      onConfirm: async () => {
        try {
          await deleteMcpServer(serverId, scope);
          setSaveStatus('success');
        } catch (error) {
          setSaveStatus('error');
        }
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleMcpTest = async (serverId, scope) => {
    try {
      setMcpTestResults({ ...mcpTestResults, [serverId]: { loading: true } });
      const result = await testMcpServer(serverId, scope);
      setMcpTestResults({ ...mcpTestResults, [serverId]: result });
    } catch (error) {
      setMcpTestResults({ 
        ...mcpTestResults, 
        [serverId]: { 
          success: false, 
          message: error.message,
          details: []
        } 
      });
    }
  };

  const handleMcpToolsDiscovery = async (serverId, scope) => {
    try {
      setMcpToolsLoading({ ...mcpToolsLoading, [serverId]: true });
      const result = await discoverMcpTools(serverId, scope);
      setMcpServerTools({ ...mcpServerTools, [serverId]: result });
    } catch (error) {
      setMcpServerTools({ 
        ...mcpServerTools, 
        [serverId]: { 
          success: false, 
          tools: [], 
          resources: [], 
          prompts: [] 
        } 
      });
    } finally {
      setMcpToolsLoading({ ...mcpToolsLoading, [serverId]: false });
    }
  };

  const updateMcpConfig = (key, value) => {
    setMcpFormData(prev => ({
      ...prev,
      config: {
        ...prev.config,
        [key]: value
      }
    }));
  };


  const getTransportIcon = (type) => {
    switch (type) {
      case 'stdio': return <Terminal className="w-4 h-4" />;
      case 'sse': return <Zap className="w-4 h-4" />;
      case 'http': return <Globe className="w-4 h-4" />;
      default: return <Server className="w-4 h-4" />;
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmText="删除"
        cancelText="取消"
        variant="destructive"
      />
      <div className="modal-backdrop fixed inset-0 flex items-center justify-center z-[9999] md:p-4 bg-background/95">
      <div className="bg-background border border-border md:rounded-lg shadow-xl w-full md:max-w-4xl h-full md:h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <SettingsIcon className="w-5 h-5 md:w-6 md:h-6 text-blue-600" />
            <h2 className="text-lg md:text-xl font-semibold text-foreground">
              设置
            </h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground touch-manipulation"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Tab Navigation */}
          <div className="border-b border-border">
            <div className="flex px-4 md:px-6">
              <button
                onClick={() => setActiveTab('appearance')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'appearance'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                外观
              </button>
              <button
                onClick={() => setActiveTab('tools')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'tools'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                工具
              </button>
              <button
                onClick={() => setActiveTab('git')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'git'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <GitBranch className="w-4 h-4 inline mr-2" />
                Git
              </button>
              <button
                onClick={() => setActiveTab('api')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'api'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Key className="w-4 h-4 inline mr-2" />
                API 密钥
              </button>
            </div>
          </div>

          <div className="p-4 md:p-6 space-y-6 md:space-y-8 pb-safe-area-inset-bottom">
            
            {/* Appearance Tab */}
            {activeTab === 'appearance' && (
              <div className="space-y-6 md:space-y-8">
               {activeTab === 'appearance' && (
  <div className="space-y-6 md:space-y-8">
    {/* Theme Settings */}
    <div className="space-y-4">
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">
              深色模式
            </div>
            <div className="text-sm text-muted-foreground">
              在浅色和深色主题之间切换
            </div>
          </div>
          <button
            onClick={toggleDarkMode}
            className="relative inline-flex h-8 w-14 items-center rounded-full bg-gray-200 dark:bg-gray-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            role="switch"
            aria-checked={isDarkMode}
            aria-label="切换深色模式"
          >
            <span className="sr-only">切换深色模式</span>
            <span
              className={`${
                isDarkMode ? 'translate-x-7' : 'translate-x-1'
              } inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-200 flex items-center justify-center`}
            >
              {isDarkMode ? (
                <Moon className="w-3.5 h-3.5 text-gray-700" />
              ) : (
                <Sun className="w-3.5 h-3.5 text-yellow-500" />
              )}
            </span>
          </button>
        </div>
      </div>
    </div>

    {/* Project Sorting */}
    <div className="space-y-4">
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">
              项目排序
            </div>
            <div className="text-sm text-muted-foreground">
              侧边栏中项目的排序方式
            </div>
          </div>
          <select
            value={projectSortOrder}
            onChange={(e) => setProjectSortOrder(e.target.value)}
            className="text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2 w-32"
          >
            <option value="name">按字母排序</option>
            <option value="date">按最近活动</option>
          </select>
        </div>
      </div>
    </div>

    {/* Code Editor Settings */}
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">代码编辑器</h3>

      {/* Editor Theme */}
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">
              编辑器主题
            </div>
            <div className="text-sm text-muted-foreground">
              代码编辑器的默认主题
            </div>
          </div>
          <button
            onClick={() => setCodeEditorTheme(codeEditorTheme === 'dark' ? 'light' : 'dark')}
            className="relative inline-flex h-8 w-14 items-center rounded-full bg-gray-200 dark:bg-gray-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            role="switch"
            aria-checked={codeEditorTheme === 'dark'}
            aria-label="切换编辑器主题"
          >
            <span className="sr-only">切换编辑器主题</span>
            <span
              className={`${
                codeEditorTheme === 'dark' ? 'translate-x-7' : 'translate-x-1'
              } inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-200 flex items-center justify-center`}
            >
              {codeEditorTheme === 'dark' ? (
                <Moon className="w-3.5 h-3.5 text-gray-700" />
              ) : (
                <Sun className="w-3.5 h-3.5 text-yellow-500" />
              )}
            </span>
          </button>
        </div>
      </div>

      {/* Word Wrap */}
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">
              自动换行
            </div>
            <div className="text-sm text-muted-foreground">
              在编辑器中默认启用自动换行
            </div>
          </div>
          <button
            onClick={() => setCodeEditorWordWrap(!codeEditorWordWrap)}
            className="relative inline-flex h-8 w-14 items-center rounded-full bg-gray-200 dark:bg-gray-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            role="switch"
            aria-checked={codeEditorWordWrap}
            aria-label="切换自动换行"
          >
            <span className="sr-only">切换自动换行</span>
            <span
              className={`${
                codeEditorWordWrap ? 'translate-x-7' : 'translate-x-1'
              } inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-200`}
            />
          </button>
        </div>
      </div>

      {/* Show Line Numbers */}
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">
              Show Line Numbers
            </div>
            <div className="text-sm text-muted-foreground">
              Display line numbers in the editor
            </div>
          </div>
          <button
            onClick={() => setCodeEditorLineNumbers(!codeEditorLineNumbers)}
            className="relative inline-flex h-8 w-14 items-center rounded-full bg-gray-200 dark:bg-gray-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            role="switch"
            aria-checked={codeEditorLineNumbers}
            aria-label="Toggle line numbers"
          >
            <span className="sr-only">Toggle line numbers</span>
            <span
              className={`${
                codeEditorLineNumbers ? 'translate-x-7' : 'translate-x-1'
              } inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-200`}
            />
          </button>
        </div>
      </div>

      {/* Font Size */}
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">
              Font Size
            </div>
            <div className="text-sm text-muted-foreground">
              Editor font size in pixels
            </div>
          </div>
          <select
            value={codeEditorFontSize}
            onChange={(e) => setCodeEditorFontSize(e.target.value)}
            className="text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2 w-24"
          >
            <option value="10">10px</option>
            <option value="11">11px</option>
            <option value="12">12px</option>
            <option value="13">13px</option>
            <option value="14">14px</option>
            <option value="15">15px</option>
            <option value="16">16px</option>
            <option value="18">18px</option>
            <option value="20">20px</option>
          </select>
        </div>
      </div>
    </div>
  </div>
)}

              </div>
            )}

            {/* Git Tab */}
            {activeTab === 'git' && <GitSettings />}

            {/* Tools Tab */}
            {activeTab === 'tools' && (
              <div className="space-y-6 md:space-y-8">
            
            {/* Provider Tabs */}
            <div className="border-b border-gray-300 dark:border-gray-600">
              <div className="flex gap-4">
                <button
                  onClick={() => setToolsProvider('claude')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    toolsProvider === 'claude'
                      ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <ClaudeLogo className="w-4 h-4" />
                    <span>Claude</span>
                  </div>
                </button>
                <button
                  onClick={() => setToolsProvider('codebuddy')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    toolsProvider === 'codebuddy'
                      ? 'border-green-600 text-green-600 dark:text-green-400'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <CodeBuddyLogo className="w-4 h-4" />
                    <span>CodeBuddy</span>
                  </div>
                </button>
              </div>
            </div>
            
            {/* Claude Content */}
            {toolsProvider === 'claude' && (
              <div className="space-y-6 md:space-y-8">
            
            {/* Skip Permissions */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-orange-500" />
                <h3 className="text-lg font-medium text-foreground">
                  权限设置
                </h3>
              </div>
              <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={skipPermissions}
                    onChange={(e) => setSkipPermissions(e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500 focus:ring-2 checked:bg-blue-600 dark:checked:bg-blue-600"
                  />
                  <div>
                    <div className="font-medium text-orange-900 dark:text-orange-100">
                      跳过权限提示（谨慎使用）
                    </div>
                    <div className="text-sm text-orange-700 dark:text-orange-300">
                      相当于 --dangerously-skip-permissions 标志
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <LogIn className="w-5 h-5 text-blue-500" />
                <h3 className="text-lg font-medium text-foreground">
                  身份验证
                </h3>
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    {claudeAuthStatus.loading ? (
                      <span className="text-sm text-blue-700 dark:text-blue-300">
                        检查身份验证...
                      </span>
                    ) : claudeAuthStatus.authenticated ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="success" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                          ✓ 已登录
                        </Badge>
                        {claudeAuthStatus.email && (
                          <span className="text-sm text-blue-700 dark:text-blue-300">
                            {claudeAuthStatus.email}
                          </span>
                        )}
                      </div>
                    ) : (
                      <Badge variant="secondary" className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300">
                        未认证
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-blue-900 dark:text-blue-100">
                        Claude CLI 登录
                      </div>
                      <div className="text-sm text-blue-700 dark:text-blue-300">
                        {claudeAuthStatus.authenticated
                          ? '重新认证或切换账户'
                          : '登录您的 Claude 账户以启用 AI 功能'}
                      </div>
                    </div>
                    <Button
                      onClick={handleClaudeLogin}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                      size="sm"
                    >
                      <LogIn className="w-4 h-4 mr-2" />
                      登录
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Allowed Tools */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-green-500" />
                <h3 className="text-lg font-medium text-foreground">
                  允许的工具
                </h3>
              </div>
              <p className="text-sm text-muted-foreground">
                自动允许而无需提示权限的工具
              </p>
              
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={newAllowedTool}
                  onChange={(e) => setNewAllowedTool(e.target.value)}
                  placeholder='例如: "Bash(git log:*)" 或 "Write"'
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      addAllowedTool(newAllowedTool);
                    }
                  }}
                  className="flex-1 h-10 touch-manipulation"
                  style={{ fontSize: '16px' }}
                />
                <Button
                  onClick={() => addAllowedTool(newAllowedTool)}
                  disabled={!newAllowedTool}
                  size="sm"
                  className="h-10 px-4 touch-manipulation"
                >
                  <Plus className="w-4 h-4 mr-2 sm:mr-0" />
                  <span className="sm:hidden">添加工具</span>
                </Button>
              </div>

              {/* Common tools quick add */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  快速添加常用工具:
                </p>
                <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
                  {commonTools.map(tool => (
                    <Button
                      key={tool}
                      variant="outline"
                      size="sm"
                      onClick={() => addAllowedTool(tool)}
                      disabled={allowedTools.includes(tool)}
                      className="text-xs h-8 touch-manipulation truncate"
                    >
                      {tool}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                {allowedTools.map(tool => (
                  <div key={tool} className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                    <span className="font-mono text-sm text-green-800 dark:text-green-200">
                      {tool}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeAllowedTool(tool)}
                      className="text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {allowedTools.length === 0 && (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    未配置允许的工具
                  </div>
                )}
              </div>
            </div>

            {/* Disallowed Tools */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                <h3 className="text-lg font-medium text-foreground">
                  禁止的工具
                </h3>
              </div>
              <p className="text-sm text-muted-foreground">
                自动阻止而无需提示权限的工具
              </p>
              
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={newDisallowedTool}
                  onChange={(e) => setNewDisallowedTool(e.target.value)}
                  placeholder='例如: "Bash(rm:*)" 或 "Write"'
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      addDisallowedTool(newDisallowedTool);
                    }
                  }}
                  className="flex-1 h-10 touch-manipulation"
                  style={{ fontSize: '16px' }}
                />
                <Button
                  onClick={() => addDisallowedTool(newDisallowedTool)}
                  disabled={!newDisallowedTool}
                  size="sm"
                  className="h-10 px-4 touch-manipulation"
                >
                  <Plus className="w-4 h-4 mr-2 sm:mr-0" />
                  <span className="sm:hidden">Add Tool</span>
                </Button>
              </div>

              <div className="space-y-2">
                {disallowedTools.map(tool => (
                  <div key={tool} className="flex items-center justify-between bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                    <span className="font-mono text-sm text-red-800 dark:text-red-200">
                      {tool}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeDisallowedTool(tool)}
                      className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {disallowedTools.length === 0 && (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    未配置禁止的工具
                  </div>
                )}
              </div>
            </div>

            {/* Help Section */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
                工具模式示例:
              </h4>
              <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Bash(git log:*)"</code> - 允许所有 git log 命令</li>
                <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Bash(git diff:*)"</code> - 允许所有 git diff 命令</li>
                <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Write"</code> - 允许所有 Write 工具使用</li>
                <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Read"</code> - 允许所有 Read 工具使用</li>
                <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Bash(rm:*)"</code> - 阻止所有 rm 命令（危险）</li>
              </ul>
            </div>

            {/* MCP Server Management */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Server className="w-5 h-5 text-purple-500" />
                <h3 className="text-lg font-medium text-foreground">
                  MCP 服务器
                </h3>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  模型上下文协议服务器为 Claude 提供额外的工具和数据源
                </p>
              </div>
              
              <div className="flex justify-between items-center">
                <Button
                  onClick={() => openMcpForm()}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                  size="sm"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  添加 MCP 服务器
                </Button>
              </div>

              {/* MCP Servers List */}
              <div className="space-y-2">
                {mcpServers.map(server => (
                  <div key={server.id} className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {getTransportIcon(server.type)}
                          <span className="font-medium text-foreground">{server.name}</span>
                          <Badge variant="outline" className="text-xs">
                            {server.type}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {server.scope === 'local' ? '📁 local' : server.scope === 'user' ? '👤 user' : server.scope}
                          </Badge>
                          {server.projectPath && (
                            <Badge variant="outline" className="text-xs bg-purple-50 dark:bg-purple-900/20" title={server.projectPath}>
                              {server.projectPath.split('/').pop()}
                            </Badge>
                          )}
                        </div>
                        
                        <div className="text-sm text-muted-foreground space-y-1">
                          {server.type === 'stdio' && server.config.command && (
                            <div>Command: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{server.config.command}</code></div>
                          )}
                          {(server.type === 'sse' || server.type === 'http') && server.config.url && (
                            <div>URL: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{server.config.url}</code></div>
                          )}
                          {server.config.args && server.config.args.length > 0 && (
                            <div>Args: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{server.config.args.join(' ')}</code></div>
                          )}
                          {server.config.env && Object.keys(server.config.env).length > 0 && (
                            <div>Environment: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{Object.entries(server.config.env).map(([k, v]) => `${k}=${v}`).join(', ')}</code></div>
                          )}
                          {server.raw && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">查看完整配置</summary>
                              <pre className="mt-1 text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-x-auto">
                                {JSON.stringify(server.raw, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>

                        {/* Test Results */}
                        {mcpTestResults[server.id] && (
                          <div className={`mt-2 p-2 rounded text-xs ${
                            mcpTestResults[server.id].success 
                              ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200' 
                              : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
                          }`}>
                            <div className="font-medium">{mcpTestResults[server.id].message}</div>
                            {mcpTestResults[server.id].details && mcpTestResults[server.id].details.length > 0 && (
                              <ul className="mt-1 space-y-0.5">
                                {mcpTestResults[server.id].details.map((detail, i) => (
                                  <li key={i}>• {detail}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}

                        {/* Tools Discovery Results */}
                        {mcpServerTools[server.id] && (
                          <div className="mt-2 p-2 rounded text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800">
                            <div className="font-medium mb-2">可用工具和资源</div>
                            
                            {mcpServerTools[server.id].tools && mcpServerTools[server.id].tools.length > 0 && (
                              <div className="mb-2">
                                <div className="font-medium text-xs mb-1">工具 ({mcpServerTools[server.id].tools.length}):</div>
                                <ul className="space-y-0.5">
                                  {mcpServerTools[server.id].tools.map((tool, i) => (
                                    <li key={i} className="flex items-start gap-1">
                                      <span className="text-blue-400 mt-0.5">•</span>
                                      <div>
                                        <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">{tool.name}</code>
                                        {tool.description && tool.description !== 'No description provided' && (
                                          <span className="ml-1 text-xs opacity-75">- {tool.description}</span>
                                        )}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {mcpServerTools[server.id].resources && mcpServerTools[server.id].resources.length > 0 && (
                              <div className="mb-2">
                                <div className="font-medium text-xs mb-1">资源 ({mcpServerTools[server.id].resources.length}):</div>
                                <ul className="space-y-0.5">
                                  {mcpServerTools[server.id].resources.map((resource, i) => (
                                    <li key={i} className="flex items-start gap-1">
                                      <span className="text-blue-400 mt-0.5">•</span>
                                      <div>
                                        <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">{resource.name}</code>
                                        {resource.description && resource.description !== 'No description provided' && (
                                          <span className="ml-1 text-xs opacity-75">- {resource.description}</span>
                                        )}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {mcpServerTools[server.id].prompts && mcpServerTools[server.id].prompts.length > 0 && (
                              <div>
                                <div className="font-medium text-xs mb-1">提示词 ({mcpServerTools[server.id].prompts.length}):</div>
                                <ul className="space-y-0.5">
                                  {mcpServerTools[server.id].prompts.map((prompt, i) => (
                                    <li key={i} className="flex items-start gap-1">
                                      <span className="text-blue-400 mt-0.5">•</span>
                                      <div>
                                        <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">{prompt.name}</code>
                                        {prompt.description && prompt.description !== 'No description provided' && (
                                          <span className="ml-1 text-xs opacity-75">- {prompt.description}</span>
                                        )}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {(!mcpServerTools[server.id].tools || mcpServerTools[server.id].tools.length === 0) &&
                             (!mcpServerTools[server.id].resources || mcpServerTools[server.id].resources.length === 0) &&
                             (!mcpServerTools[server.id].prompts || mcpServerTools[server.id].prompts.length === 0) && (
                              <div className="text-xs opacity-75">未发现工具、资源或提示词</div>
                            )}
                          </div>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2 ml-4">
                        <Button
                          onClick={() => openMcpForm(server)}
                          variant="ghost"
                          size="sm"
                          className="text-gray-600 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                          title="编辑服务器"
                        >
                          <Edit3 className="w-4 h-4" />
                        </Button>
                        <Button
                          onClick={() => handleMcpDelete(server.id, server.scope)}
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                          title="删除服务器"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {mcpServers.length === 0 && (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    未配置 MCP 服务器
                  </div>
                )}
              </div>
            </div>

            {/* MCP Server Form Modal */}
            {showMcpForm && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] p-4">
                <div className="bg-background border border-border rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                  <div className="flex items-center justify-between p-4 border-b border-border">
                    <h3 className="text-lg font-medium text-foreground">
                      {editingMcpServer ? '编辑 MCP 服务器' : '添加 MCP 服务器'}
                    </h3>
                    <Button variant="ghost" size="sm" onClick={resetMcpForm}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  
                  <form onSubmit={handleMcpSubmit} className="p-4 space-y-4">

                    {!editingMcpServer && (
                    <div className="flex gap-2 mb-4">
                      <button
                        type="button"
                        onClick={() => setMcpFormData(prev => ({...prev, importMode: 'form'}))}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                          mcpFormData.importMode === 'form'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        表单输入
                      </button>
                      <button
                        type="button"
                        onClick={() => setMcpFormData(prev => ({...prev, importMode: 'json'}))}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                          mcpFormData.importMode === 'json'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        JSON 导入
                      </button>
                    </div>
                    )}

                    {/* Show current scope when editing */}
                    {mcpFormData.importMode === 'form' && editingMcpServer && (
                      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                          <label className="block text-sm font-medium text-foreground mb-2">
                            范围
                          </label>
                        <div className="flex items-center gap-2">
                          {mcpFormData.scope === 'user' ? <Globe className="w-4 h-4" /> : <FolderOpen className="w-4 h-4" />}
                          <span className="text-sm">
                            {mcpFormData.scope === 'user' ? '用户（全局）' : '项目（本地）'}
                          </span>
                          {mcpFormData.scope === 'local' && mcpFormData.projectPath && (
                            <span className="text-xs text-muted-foreground">
                              - {mcpFormData.projectPath}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          编辑现有服务器时无法更改范围
                        </p>
                      </div>
                    )}

                    {/* Scope Selection - Moved to top, disabled when editing */}
                    {mcpFormData.importMode === 'form' && !editingMcpServer && (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            范围 *
                          </label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setMcpFormData(prev => ({...prev, scope: 'user', projectPath: ''}))}
                              className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                                mcpFormData.scope === 'user'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                              }`}
                            >
                              <div className="flex items-center justify-center gap-2">
                                <Globe className="w-4 h-4" />
                                <span>用户（全局）</span>
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => setMcpFormData(prev => ({...prev, scope: 'local'}))}
                              className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                                mcpFormData.scope === 'local'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                              }`}
                            >
                              <div className="flex items-center justify-center gap-2">
                                <FolderOpen className="w-4 h-4" />
                                <span>项目（本地）</span>
                              </div>
                            </button>
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">
                            {mcpFormData.scope === 'user' 
                              ? '用户范围：在您的机器上的所有项目中可用'
                              : '本地范围：仅在选定的项目中可用'
                            }
                          </p>
                        </div>

                        {/* Project Selection for Local Scope */}
                        {mcpFormData.scope === 'local' && !editingMcpServer && (
                          <div>
                            <label className="block text-sm font-medium text-foreground mb-2">
                              项目 *
                            </label>
                            <select
                              value={mcpFormData.projectPath}
                              onChange={(e) => setMcpFormData(prev => ({...prev, projectPath: e.target.value}))}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                              required={mcpFormData.scope === 'local'}
                            >
                              <option value="">选择项目...</option>
                              {projects.map(project => (
                                <option key={project.name} value={project.path || project.path}>
                                  {project.displayName || project.name}
                                </option>
                              ))}
                            </select>
                            {mcpFormData.projectPath && (
                              <p className="text-xs text-muted-foreground mt-1">
                                路径: {mcpFormData.projectPath}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Basic Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className={mcpFormData.importMode === 'json' ? 'md:col-span-2' : ''}>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          服务器名称 *
                        </label>
                        <Input
                          value={mcpFormData.name}
                          onChange={(e) => {
                            setMcpFormData(prev => ({...prev, name: e.target.value}));
                          }}
                          placeholder="我的服务器"
                          required
                        />
                      </div>
                      
                      {mcpFormData.importMode === 'form' && (
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            传输类型 *
                          </label>
                          <select
                            value={mcpFormData.type}
                            onChange={(e) => {
                              setMcpFormData(prev => ({...prev, type: e.target.value}));
                            }}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                          >
                            <option value="stdio">stdio</option>
                            <option value="sse">SSE</option>
                            <option value="http">HTTP</option>
                          </select>
                        </div>
                      )}
                    </div>


                    {/* Show raw configuration details when editing */}
                    {editingMcpServer && mcpFormData.raw && mcpFormData.importMode === 'form' && (
                      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                        <h4 className="text-sm font-medium text-foreground mb-2">
                          配置详情 (来自 {editingMcpServer.scope === 'global' ? '~/.claude.json' : '项目配置'})
                        </h4>
                        <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-x-auto">
                          {JSON.stringify(mcpFormData.raw, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* JSON Import Mode */}
                    {mcpFormData.importMode === 'json' && (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            JSON 配置 *
                          </label>
                          <textarea
                            value={mcpFormData.jsonInput}
                            onChange={(e) => {
                              setMcpFormData(prev => ({...prev, jsonInput: e.target.value}));
                              // Validate JSON as user types
                              try {
                                if (e.target.value.trim()) {
                                  const parsed = JSON.parse(e.target.value);
                                  // Basic validation
                                  if (!parsed.type) {
                                    setJsonValidationError('缺少必需字段：type');
                                  } else if (parsed.type === 'stdio' && !parsed.command) {
                                    setJsonValidationError('stdio 类型需要 command 字段');
                                  } else if ((parsed.type === 'http' || parsed.type === 'sse') && !parsed.url) {
                                    setJsonValidationError(`${parsed.type} 类型需要 url 字段`);
                                  } else {
                                    setJsonValidationError('');
                                  }
                                }
                              } catch (err) {
                                if (e.target.value.trim()) {
                                  setJsonValidationError('无效的 JSON 格式');
                                } else {
                                  setJsonValidationError('');
                                }
                              }
                            }}
                            className={`w-full px-3 py-2 border ${jsonValidationError ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'} bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500 font-mono text-sm`}
                            rows="8"
                            placeholder={'{\n  "type": "stdio",\n  "command": "/path/to/server",\n  "args": ["--api-key", "abc123"],\n  "env": {\n    "CACHE_DIR": "/tmp"\n  }\n}'}
                            required
                          />
                          {jsonValidationError && (
                            <p className="text-xs text-red-500 mt-1">{jsonValidationError}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-2">
                            以 JSON 格式粘贴您的 MCP 服务器配置。示例格式：
                            <br />• stdio: {`{"type":"stdio","command":"npx","args":["@upstash/context7-mcp"]}`}
                            <br />• http/sse: {`{"type":"http","url":"https://api.example.com/mcp"}`}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Transport-specific Config - Only show in form mode */}
                    {mcpFormData.importMode === 'form' && mcpFormData.type === 'stdio' && (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            命令 *
                          </label>
                          <Input
                            value={mcpFormData.config.command}
                            onChange={(e) => updateMcpConfig('command', e.target.value)}
                            placeholder="/path/to/mcp-server"
                            required
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            参数 (每行一个)
                          </label>
                          <textarea
                            value={Array.isArray(mcpFormData.config.args) ? mcpFormData.config.args.join('\n') : ''}
                            onChange={(e) => updateMcpConfig('args', e.target.value.split('\n').filter(arg => arg.trim()))}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                            rows="3"
                            placeholder="--api-key&#10;abc123"
                          />
                        </div>
                      </div>
                    )}

                    {mcpFormData.importMode === 'form' && (mcpFormData.type === 'sse' || mcpFormData.type === 'http') && (
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          URL *
                        </label>
                        <Input
                          value={mcpFormData.config.url}
                          onChange={(e) => updateMcpConfig('url', e.target.value)}
                          placeholder="https://api.example.com/mcp"
                          type="url"
                          required
                        />
                      </div>
                    )}

                    {/* Environment Variables - Only show in form mode */}
                    {mcpFormData.importMode === 'form' && (
                      <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        环境变量 (KEY=value, 每行一个)
                      </label>
                      <textarea
                        value={Object.entries(mcpFormData.config.env || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
                        onChange={(e) => {
                          const env = {};
                          e.target.value.split('\n').forEach(line => {
                            const [key, ...valueParts] = line.split('=');
                            if (key && key.trim()) {
                              env[key.trim()] = valueParts.join('=').trim();
                            }
                          });
                          updateMcpConfig('env', env);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                        rows="3"
                        placeholder="API_KEY=your-key&#10;DEBUG=true"
                      />
                    </div>
                    )}

                    {mcpFormData.importMode === 'form' && (mcpFormData.type === 'sse' || mcpFormData.type === 'http') && (
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          标头 (KEY=value, 每行一个)
                        </label>
                        <textarea
                          value={Object.entries(mcpFormData.config.headers || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
                          onChange={(e) => {
                            const headers = {};
                            e.target.value.split('\n').forEach(line => {
                              const [key, ...valueParts] = line.split('=');
                              if (key && key.trim()) {
                                headers[key.trim()] = valueParts.join('=').trim();
                              }
                            });
                            updateMcpConfig('headers', headers);
                          }}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                          rows="3"
                          placeholder="Authorization=Bearer token&#10;X-API-Key=your-key"
                        />
                      </div>
                    )}


                    <div className="flex justify-end gap-2 pt-4">
                      <Button type="button" variant="outline" onClick={resetMcpForm}>
                        取消
                      </Button>
                      <Button 
                        type="submit" 
                        disabled={mcpLoading} 
                        className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50"
                      >
                        {mcpLoading ? '保存中...' : (editingMcpServer ? '更新服务器' : '添加服务器')}
                      </Button>
                    </div>
                  </form>
                </div>
              </div>
            )}
            
            {/* CodeBuddy Content */}
            {toolsProvider === 'codebuddy' && (
              <div className="space-y-6 md:space-y-8">
                
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <LogIn className="w-5 h-5 text-green-500" />
                    <h3 className="text-lg font-medium text-foreground">
                      身份验证
                    </h3>
                  </div>
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        {codebuddyAuthStatus.loading ? (
                          <span className="text-sm text-green-700 dark:text-green-300">
                            检查身份验证...
                          </span>
                        ) : codebuddyAuthStatus.authenticated ? (
                          <div className="flex items-center gap-2">
                            <Badge variant="success" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                              ✓ HTTP API 已连接
                            </Badge>
                            {codebuddyAuthStatus.email && (
                              <span className="text-sm text-green-700 dark:text-green-300">
                                as {codebuddyAuthStatus.email}
                              </span>
                            )}
                          </div>
                        ) : (
                          <Badge variant="secondary" className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300">
                            未连接
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-green-900 dark:text-green-100">
                            CodeBuddy HTTP API
                          </div>
                          <div className="text-sm text-green-700 dark:text-green-300">
                            {codebuddyAuthStatus.authenticated
                              ? 'HTTP API 服务正在运行'
                              : '启动 CodeBuddy HTTP API 服务器以启用 AI 功能'}
                          </div>
                        </div>
                        <Button
                          onClick={handleCodeBuddyLogin}
                          className="bg-green-600 hover:bg-green-700 text-white"
                          size="sm"
                        >
                          <LogIn className="w-4 h-4 mr-2" />
                          连接
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Installation Instructions */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Terminal className="w-5 h-5 text-green-500" />
                    <h3 className="text-lg font-medium text-foreground">
                      安装和设置
                    </h3>
                  </div>
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                    <div className="space-y-4">
                      <div>
                        <div className="font-medium text-green-900 dark:text-green-100 mb-2">
                          1. 安装 CodeBuddy
                        </div>
                        <code className="block bg-green-100 dark:bg-green-800 px-3 py-2 rounded text-sm">
                          npm install -g @tencent-ai/codebuddy-code
                        </code>
                      </div>
                      
                      <div>
                        <div className="font-medium text-green-900 dark:text-green-100 mb-2">
                          2. Start HTTP API Server
                        </div>
                        <code className="block bg-green-100 dark:bg-green-800 px-3 py-2 rounded text-sm">
                          codebuddy --serve --port 8080
                        </code>
                        <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                          The HTTP API service will run at http://127.0.0.1:8080
                        </p>
                      </div>

                      <div>
                        <div className="font-medium text-green-900 dark:text-green-100 mb-2">
                          3. Configure API Endpoint (Optional)
                        </div>
                        <p className="text-sm text-green-700 dark:text-green-300">
                          Default endpoint: <code className="bg-green-100 dark:bg-green-800 px-1 rounded">http://127.0.0.1:8080</code>
                        </p>
                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                          You can change this in environment variables if needed
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* API Features */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Server className="w-5 h-5 text-green-500" />
                    <h3 className="text-lg font-medium text-foreground">
                      CodeBuddy Features
                    </h3>
                  </div>
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                    <ul className="text-sm text-green-800 dark:text-green-200 space-y-2">
                      <li className="flex items-start gap-2">
                        <span className="text-green-500">✓</span>
                        <span><strong>HTTP API Integration:</strong> Direct HTTP API calls without CLI wrapper</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-green-500">✓</span>
                        <span><strong>SSE Streaming:</strong> Real-time streaming responses via Server-Sent Events</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-green-500">✓</span>
                        <span><strong>Session Management:</strong> Resume and manage multiple chat sessions</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-green-500">✓</span>
                        <span><strong>Enterprise Features:</strong> Sandbox execution, custom plugins, and proxy support</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-green-500">✓</span>
                        <span><strong>Project Context:</strong> Dynamic project directory support via <code className="bg-green-100 dark:bg-green-800 px-1 rounded">cwd</code> parameter</span>
                      </li>
                    </ul>
                  </div>
                </div>

                {/* Help Section */}
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                  <h4 className="font-medium text-green-900 dark:text-green-100 mb-2">
                    CodeBuddy Integration Details:
                  </h4>
                  <ul className="text-sm text-green-800 dark:text-green-200 space-y-1">
                    <li><strong>Architecture:</strong> Global single HTTP service + multi-project support</li>
                    <li><strong>API Endpoint:</strong> <code className="bg-green-100 dark:bg-green-800 px-1 rounded">POST /agent</code> for queries</li>
                    <li><strong>Streaming:</strong> JSON-stream output format with Server-Sent Events</li>
                    <li><strong>Session Resume:</strong> Use <code className="bg-green-100 dark:bg-green-800 px-1 rounded">resume</code> parameter with session ID</li>
                  </ul>
                </div>
              </div>
            )}
              </div>
            )}
            
            {/* CodeBuddy Content */}
            {toolsProvider === 'codebuddy' && (
              <div className="space-y-6 md:space-y-8">
                
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <LogIn className="w-5 h-5 text-green-500" />
                    <h3 className="text-lg font-medium text-foreground">
                      身份验证
                    </h3>
                  </div>
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        {codebuddyAuthStatus.loading ? (
                          <span className="text-sm text-green-700 dark:text-green-300">
                            检查身份验证...
                          </span>
                        ) : codebuddyAuthStatus.authenticated ? (
                          <div className="flex items-center gap-2">
                            <Badge variant="success" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                              ✓ HTTP API 已连接
                            </Badge>
                            {codebuddyAuthStatus.email && (
                              <span className="text-sm text-green-700 dark:text-green-300">
                                as {codebuddyAuthStatus.email}
                              </span>
                            )}
                          </div>
                        ) : (
                          <Badge variant="secondary" className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300">
                            未连接
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-green-900 dark:text-green-100">
                            CodeBuddy HTTP API
                          </div>
                          <div className="text-sm text-green-700 dark:text-green-300">
                            {codebuddyAuthStatus.authenticated
                              ? 'HTTP API 服务正在运行'
                              : '启动 CodeBuddy HTTP API 服务器以启用 AI 功能'}
                          </div>
                        </div>
                        <Button
                          onClick={handleCodeBuddyLogin}
                          className="bg-green-600 hover:bg-green-700 text-white"
                          size="sm"
                        >
                          <LogIn className="w-4 h-4 mr-2" />
                          连接
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Installation Instructions */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Terminal className="w-5 h-5 text-green-500" />
                    <h3 className="text-lg font-medium text-foreground">
                      安装和设置
                    </h3>
                  </div>
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                    <div className="space-y-4">
                      <div>
                        <div className="font-medium text-green-900 dark:text-green-100 mb-2">
                          1. 安装 CodeBuddy
                        </div>
                        <code className="block bg-green-100 dark:bg-green-800 px-3 py-2 rounded text-sm">
                          npm install -g @tencent-ai/codebuddy-code
                        </code>
                      </div>
                      
                      <div>
                        <div className="font-medium text-green-900 dark:text-green-100 mb-2">
                          2. Start HTTP API Server
                        </div>
                        <code className="block bg-green-100 dark:bg-green-800 px-3 py-2 rounded text-sm">
                          codebuddy --serve --port 8080
                        </code>
                        <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                          The HTTP API service will run at http://127.0.0.1:8080
                        </p>
                      </div>

                      <div>
                        <div className="font-medium text-green-900 dark:text-green-100 mb-2">
                          3. Configure API Endpoint (Optional)
                        </div>
                        <p className="text-sm text-green-700 dark:text-green-300">
                          Default endpoint: <code className="bg-green-100 dark:bg-green-800 px-1 rounded">http://127.0.0.1:8080</code>
                        </p>
                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                          You can change this in environment variables if needed
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* API Features */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Server className="w-5 h-5 text-green-500" />
                    <h3 className="text-lg font-medium text-foreground">
                      CodeBuddy Features
                    </h3>
                  </div>
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                    <ul className="text-sm text-green-800 dark:text-green-200 space-y-2">
                      <li className="flex items-start gap-2">
                        <span className="text-green-500">✓</span>
                        <span><strong>HTTP API Integration:</strong> Direct HTTP API calls without CLI wrapper</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-green-500">✓</span>
                        <span><strong>SSE Streaming:</strong> Real-time streaming responses via Server-Sent Events</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-green-500">✓</span>
                        <span><strong>Session Management:</strong> Resume and manage multiple chat sessions</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-green-500">✓</span>
                        <span><strong>Enterprise Features:</strong> Sandbox execution, custom plugins, and proxy support</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-green-500">✓</span>
                        <span><strong>Project Context:</strong> Dynamic project directory support via <code className="bg-green-100 dark:bg-green-800 px-1 rounded">cwd</code> parameter</span>
                      </li>
                    </ul>
                  </div>
                </div>

                {/* Help Section */}
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                  <h4 className="font-medium text-green-900 dark:text-green-100 mb-2">
                    CodeBuddy Integration Details:
                  </h4>
                  <ul className="text-sm text-green-800 dark:text-green-200 space-y-1">
                    <li><strong>Architecture:</strong> Global single HTTP service + multi-project support</li>
                    <li><strong>API Endpoint:</strong> <code className="bg-green-100 dark:bg-green-800 px-1 rounded">POST /agent</code> for queries</li>
                    <li><strong>Streaming:</strong> JSON-stream output format with Server-Sent Events</li>
                    <li><strong>Session Resume:</strong> Use <code className="bg-green-100 dark:bg-green-800 px-1 rounded">resume</code> parameter with session ID</li>
                  </ul>
                </div>
              </div>
            )}
              </div>
            )}

            {/* API & Tokens Tab */}
            {activeTab === 'api' && (
              <div className="space-y-6 md:space-y-8">
                <CredentialsSettings />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 md:p-6 border-t border-border flex-shrink-0 gap-3 pb-safe-area-inset-bottom">
          <div className="flex items-center justify-center sm:justify-start gap-2 order-2 sm:order-1">
            {saveStatus === 'success' && (
              <div className="text-green-600 dark:text-green-400 text-sm flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                设置保存成功！
              </div>
            )}
            {saveStatus === 'error' && (
              <div className="text-red-600 dark:text-red-400 text-sm flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                保存设置失败
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 order-1 sm:order-2">
            <Button 
              variant="outline" 
              onClick={onClose} 
              disabled={isSaving}
              className="flex-1 sm:flex-none h-10 touch-manipulation"
            >
              取消
            </Button>
            <Button 
              onClick={saveSettings} 
              disabled={isSaving}
              className="flex-1 sm:flex-none h-10 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 touch-manipulation"
            >
              {isSaving ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  保存中...
                </div>
              ) : (
                '保存设置'
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Login Modal */}
      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        provider={loginProvider}
        project={selectedProject}
        onComplete={handleLoginComplete}
      />
    </div>
    </>
  );
}

export default Settings;

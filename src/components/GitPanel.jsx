import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GitBranch, GitCommit, Plus, Minus, RefreshCw, Check, X, ChevronDown, ChevronRight, Info, History, FileText, Mic, MicOff, Sparkles, Download, RotateCcw, Trash2, AlertTriangle, Upload, CloudDownload, GitPullRequest, List, FolderTree, Folder } from 'lucide-react';
import { MicButton } from './MicButton.jsx';
import { authenticatedFetch, getProjectId } from '../utils/api';
import DiffViewer from './DiffViewer.jsx';

function GitPanel({ selectedProject, isMobile, onFileOpen }) {
  const [gitStatus, setGitStatus] = useState(null);
  const [gitDiff, setGitDiff] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [expandedFiles, setExpandedFiles] = useState(new Set());
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [isCommitting, setIsCommitting] = useState(false);
  const [currentBranch, setCurrentBranch] = useState('');
  const [branches, setBranches] = useState([]);
  const [wrapText, setWrapText] = useState(true);
  const [showLegend, setShowLegend] = useState(false);
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [showNewBranchModal, setShowNewBranchModal] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [activeView, setActiveView] = useState('changes'); // 'changes', 'stash', or 'history'
  const [recentCommits, setRecentCommits] = useState([]);
  const [expandedCommits, setExpandedCommits] = useState(new Set());
  const [commitDiffs, setCommitDiffs] = useState({});
  const [isGeneratingMessage, setIsGeneratingMessage] = useState(false);
  const [remoteStatus, setRemoteStatus] = useState(null);
  const [isFetching, setIsFetching] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastFetchTime, setLastFetchTime] = useState(0); // Track last fetch time for throttling
  const [isCommitAreaCollapsed, setIsCommitAreaCollapsed] = useState(isMobile); // Collapsed by default on mobile
  const [confirmAction, setConfirmAction] = useState(null); // { type: 'discard|commit|pull|push|sync', file?: string, message?: string }
  const [isCreatingInitialCommit, setIsCreatingInitialCommit] = useState(false);
  const [viewMode, setViewMode] = useState('flat'); // 'flat' or 'tree'
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  // Stash related states
  const [stashList, setStashList] = useState([]);
  const [isLoadingStash, setIsLoadingStash] = useState(false);
  const [stashMessage, setStashMessage] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [expandedStash, setExpandedStash] = useState(null);
  const [stashDiff, setStashDiff] = useState(null);
  const textareaRef = useRef(null);
  const dropdownRef = useRef(null);

  // Get current provider from localStorage (same as ChatInterface does)
  const [provider, setProvider] = useState(() => {
    return localStorage.getItem('selected-provider') || 'claude';
  });

  // Listen for provider changes in localStorage
  useEffect(() => {
    const handleStorageChange = () => {
      const newProvider = localStorage.getItem('selected-provider') || 'claude';
      setProvider(newProvider);
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  useEffect(() => {
    if (selectedProject) {
      fetchGitStatus();
      fetchBranches();
      fetchRemoteStatus();
      // Auto fetch on page load (with throttle check - only auto fetch has 30s limit)
      autoFetchOnLoad();
      if (activeView === 'history') {
        fetchRecentCommits();
      }
      if (activeView === 'stash') {
        fetchStashList();
      }
    }
  }, [selectedProject, activeView]);

  // Auto fetch on load - only if 30 seconds have passed since last fetch
  const autoFetchOnLoad = async () => {
    const now = Date.now();
    const timeSinceLastFetch = now - lastFetchTime;
    const FETCH_THROTTLE_MS = 30 * 1000; // 30 seconds
    
    if (timeSinceLastFetch >= FETCH_THROTTLE_MS) {
      await handleFetch(true); // silent auto fetch
    }
  };

  // Handle click outside dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowBranchDropdown(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchGitStatus = async () => {
    if (!selectedProject) return;
    
    
    setIsLoading(true);
    try {
      const response = await authenticatedFetch(`/api/git/status?project=${encodeURIComponent(getProjectId(selectedProject))}`);
      const data = await response.json();
      
      
      if (data.error) {
        console.error('Git status error:', data.error);
        setGitStatus({ error: data.error, details: data.details });
      } else {
        setGitStatus(data);
        setCurrentBranch(data.branch || 'main');
        
        // Auto-select all changed files
        const allFiles = new Set([
          ...(data.modified || []),
          ...(data.added || []),
          ...(data.deleted || []),
          ...(data.untracked || [])
        ]);
        setSelectedFiles(allFiles);
      }
    } catch (error) {
      console.error('Error fetching git status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchBranches = async () => {
    try {
      const response = await authenticatedFetch(`/api/git/branches?project=${encodeURIComponent(getProjectId(selectedProject))}`);
      const data = await response.json();
      
      if (!data.error && data.branches) {
        setBranches(data.branches);
      }
    } catch (error) {
      console.error('Error fetching branches:', error);
    }
  };

  const fetchRemoteStatus = async () => {
    if (!selectedProject) return;
    
    try {
      const response = await authenticatedFetch(`/api/git/remote-status?project=${encodeURIComponent(getProjectId(selectedProject))}`);
      const data = await response.json();
      
      if (!data.error) {
        setRemoteStatus(data);
      } else {
        setRemoteStatus(null);
      }
    } catch (error) {
      console.error('Error fetching remote status:', error);
      setRemoteStatus(null);
    }
  };

  const switchBranch = async (branchName) => {
    try {
      const response = await authenticatedFetch('/api/git/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: getProjectId(selectedProject),
          branch: branchName
        })
      });
      
      const data = await response.json();
      if (data.success) {
        setCurrentBranch(branchName);
        setShowBranchDropdown(false);
        fetchGitStatus(); // Refresh status after branch switch
      } else {
        console.error('Failed to switch branch:', data.error);
      }
    } catch (error) {
      console.error('Error switching branch:', error);
    }
  };

  const createBranch = async () => {
    if (!newBranchName.trim()) return;
    
    setIsCreatingBranch(true);
    try {
      const response = await authenticatedFetch('/api/git/create-branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: getProjectId(selectedProject),
          branch: newBranchName.trim()
        })
      });
      
      const data = await response.json();
      if (data.success) {
        setCurrentBranch(newBranchName.trim());
        setShowNewBranchModal(false);
        setShowBranchDropdown(false);
        setNewBranchName('');
        fetchBranches(); // Refresh branch list
        fetchGitStatus(); // Refresh status
      } else {
        console.error('Failed to create branch:', data.error);
      }
    } catch (error) {
      console.error('Error creating branch:', error);
    } finally {
      setIsCreatingBranch(false);
    }
  };

  const handleFetch = async (silent = false) => {
    setIsFetching(true);
    try {
      const response = await authenticatedFetch('/api/git/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: getProjectId(selectedProject)
        })
      });
      
      const data = await response.json();
      if (data.success) {
        setLastFetchTime(Date.now()); // Update last fetch time on success
        // Only refresh remote status (ahead/behind), not file list
        fetchRemoteStatus();
      } else {
        if (!silent) {
          console.error('Fetch failed:', data.error);
        }
      }
    } catch (error) {
      if (!silent) {
        console.error('Error fetching from remote:', error);
      }
    } finally {
      setIsFetching(false);
    }
  };

  const handlePull = async () => {
    setIsPulling(true);
    try {
      const response = await authenticatedFetch('/api/git/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: getProjectId(selectedProject)
        })
      });
      
      const data = await response.json();
      if (data.success) {
        // Refresh status after successful pull
        fetchGitStatus();
        fetchRemoteStatus();
      } else {
        console.error('Pull failed:', data.error);
        // TODO: Show user-friendly error message
      }
    } catch (error) {
      console.error('Error pulling from remote:', error);
    } finally {
      setIsPulling(false);
    }
  };

  const handlePush = async () => {
    setIsPushing(true);
    try {
      const response = await authenticatedFetch('/api/git/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: getProjectId(selectedProject)
        })
      });
      
      const data = await response.json();
      if (data.success) {
        // Refresh status after successful push
        fetchGitStatus();
        fetchRemoteStatus();
      } else {
        console.error('Push failed:', data.error);
        // TODO: Show user-friendly error message
      }
    } catch (error) {
      console.error('Error pushing to remote:', error);
    } finally {
      setIsPushing(false);
    }
  };

  const handlePublish = async () => {
    setIsPublishing(true);
    try {
      const response = await authenticatedFetch('/api/git/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: getProjectId(selectedProject),
          branch: currentBranch
        })
      });
      
      const data = await response.json();
      if (data.success) {
        // Refresh status after successful publish
        fetchGitStatus();
        fetchRemoteStatus();
      } else {
        console.error('Publish failed:', data.error);
        // TODO: Show user-friendly error message
      }
    } catch (error) {
      console.error('Error publishing branch:', error);
    } finally {
      setIsPublishing(false);
    }
  };

  // Sync: Pull first, then Push
  const handleSync = async () => {
    setIsSyncing(true);
    try {
      // Step 1: Pull
      const pullResponse = await authenticatedFetch('/api/git/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: getProjectId(selectedProject)
        })
      });
      
      const pullData = await pullResponse.json();
      if (!pullData.success) {
        console.error('Sync failed at pull:', pullData.error);
        return;
      }
      
      // Step 2: Push
      const pushResponse = await authenticatedFetch('/api/git/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: getProjectId(selectedProject)
        })
      });
      
      const pushData = await pushResponse.json();
      if (pushData.success) {
        // Refresh status after successful sync
        fetchGitStatus();
        fetchRemoteStatus();
      } else {
        console.error('Sync failed at push:', pushData.error);
      }
    } catch (error) {
      console.error('Error syncing:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  const discardChanges = async (filePath) => {
    try {
      const response = await authenticatedFetch('/api/git/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: getProjectId(selectedProject),
          file: filePath
        })
      });
      
      const data = await response.json();
      if (data.success) {
        // Remove from selected files and refresh status
        setSelectedFiles(prev => {
          const newSet = new Set(prev);
          newSet.delete(filePath);
          return newSet;
        });
        fetchGitStatus();
      } else {
        console.error('Discard failed:', data.error);
      }
    } catch (error) {
      console.error('Error discarding changes:', error);
    }
  };

  const deleteUntrackedFile = async (filePath) => {
    try {
      const response = await authenticatedFetch('/api/git/delete-untracked', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: getProjectId(selectedProject),
          file: filePath
        })
      });
      
      const data = await response.json();
      if (data.success) {
        // Remove from selected files and refresh status
        setSelectedFiles(prev => {
          const newSet = new Set(prev);
          newSet.delete(filePath);
          return newSet;
        });
        fetchGitStatus();
      } else {
        console.error('Delete failed:', data.error);
      }
    } catch (error) {
      console.error('Error deleting untracked file:', error);
    }
  };

  const confirmAndExecute = async () => {
    if (!confirmAction) return;

    const { type, file, message } = confirmAction;
    setConfirmAction(null);

    try {
      switch (type) {
        case 'discard':
          await discardChanges(file);
          break;
        case 'delete':
          await deleteUntrackedFile(file);
          break;
        case 'commit':
          await handleCommit();
          break;
        case 'pull':
          await handlePull();
          break;
        case 'push':
          await handlePush();
          break;
        case 'publish':
          await handlePublish();
          break;
        case 'sync':
          await handleSync();
          break;
      }
    } catch (error) {
      console.error(`Error executing ${type}:`, error);
    }
  };

  const fetchFileDiff = async (filePath) => {
    try {
      const response = await authenticatedFetch(`/api/git/diff?project=${encodeURIComponent(getProjectId(selectedProject))}&file=${encodeURIComponent(filePath)}`);
      const data = await response.json();

      if (!data.error && data.diff) {
        setGitDiff(prev => ({
          ...prev,
          [filePath]: data.diff
        }));
      }
    } catch (error) {
      console.error('Error fetching file diff:', error);
    }
  };

  const handleFileOpen = async (filePath) => {
    if (!onFileOpen) return;

    try {
      // Fetch file content with diff information
      const response = await authenticatedFetch(`/api/git/file-with-diff?project=${encodeURIComponent(getProjectId(selectedProject))}&file=${encodeURIComponent(filePath)}`);
      const data = await response.json();

      if (data.error) {
        console.error('Error fetching file with diff:', data.error);
        // Fallback: open without diff info
        onFileOpen(filePath);
        return;
      }

      // Create diffInfo object for CodeEditor
      const diffInfo = {
        old_string: data.oldContent || '',
        new_string: data.currentContent || ''
      };

      // Open file with diff information
      onFileOpen(filePath, diffInfo);
    } catch (error) {
      console.error('Error opening file:', error);
      // Fallback: open without diff info
      onFileOpen(filePath);
    }
  };

  const fetchRecentCommits = async () => {
    try {
      const response = await authenticatedFetch(`/api/git/commits?project=${encodeURIComponent(getProjectId(selectedProject))}&limit=10`);
      const data = await response.json();
      
      if (!data.error && data.commits) {
        setRecentCommits(data.commits);
      }
    } catch (error) {
      console.error('Error fetching commits:', error);
    }
  };

  // Stash functions
  const fetchStashList = async () => {
    setIsLoadingStash(true);
    try {
      const response = await authenticatedFetch(`/api/git/stash/list?project=${encodeURIComponent(getProjectId(selectedProject))}`);
      const data = await response.json();
      
      if (!data.error && data.stashes) {
        setStashList(data.stashes);
      }
    } catch (error) {
      console.error('Error fetching stash list:', error);
    } finally {
      setIsLoadingStash(false);
    }
  };

  const handleStashPush = async () => {
    try {
      const response = await authenticatedFetch('/api/git/stash/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: getProjectId(selectedProject),
          message: stashMessage || undefined,
          includeUntracked
        })
      });
      const data = await response.json();
      
      if (data.error) {
        alert(data.error);
      } else {
        setStashMessage('');
        fetchStashList();
        fetchGitStatus(); // Refresh changes view
      }
    } catch (error) {
      console.error('Error creating stash:', error);
      alert('Failed to create stash');
    }
  };

  const handleStashApply = async (index) => {
    try {
      const response = await authenticatedFetch('/api/git/stash/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: getProjectId(selectedProject),
          index
        })
      });
      const data = await response.json();
      
      if (data.error) {
        alert(data.error);
      } else {
        fetchGitStatus(); // Refresh changes view
      }
    } catch (error) {
      console.error('Error applying stash:', error);
      alert('Failed to apply stash');
    }
  };

  const handleStashPop = async (index) => {
    try {
      const response = await authenticatedFetch('/api/git/stash/pop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: getProjectId(selectedProject),
          index
        })
      });
      const data = await response.json();
      
      if (data.error) {
        alert(data.error);
      } else {
        fetchStashList();
        fetchGitStatus(); // Refresh changes view
      }
    } catch (error) {
      console.error('Error popping stash:', error);
      alert('Failed to pop stash');
    }
  };

  const handleStashDrop = async (index) => {
    if (!confirm(`确定要删除 stash@{${index}} 吗？此操作不可撤销。`)) {
      return;
    }
    
    try {
      const response = await authenticatedFetch('/api/git/stash/drop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: getProjectId(selectedProject),
          index
        })
      });
      const data = await response.json();
      
      if (data.error) {
        alert(data.error);
      } else {
        fetchStashList();
        if (expandedStash === index) {
          setExpandedStash(null);
          setStashDiff(null);
        }
      }
    } catch (error) {
      console.error('Error dropping stash:', error);
      alert('Failed to drop stash');
    }
  };

  const handleStashShow = async (index) => {
    if (expandedStash === index) {
      setExpandedStash(null);
      setStashDiff(null);
      return;
    }
    
    try {
      const response = await authenticatedFetch(`/api/git/stash/show?project=${encodeURIComponent(getProjectId(selectedProject))}&index=${index}`);
      const data = await response.json();
      
      if (data.error) {
        alert(data.error);
      } else {
        setExpandedStash(index);
        setStashDiff(data);
      }
    } catch (error) {
      console.error('Error showing stash:', error);
      alert('Failed to show stash');
    }
  };

  // Stage/Unstage functions
  const handleStageFiles = async (files) => {
    try {
      const response = await authenticatedFetch('/api/git/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: getProjectId(selectedProject),
          files: Array.isArray(files) ? files : [files]
        })
      });
      const data = await response.json();
      
      if (data.error) {
        alert(data.error);
      } else {
        fetchGitStatus();
      }
    } catch (error) {
      console.error('Error staging files:', error);
      alert('Failed to stage files');
    }
  };

  const handleUnstageFiles = async (files) => {
    try {
      const response = await authenticatedFetch('/api/git/unstage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: getProjectId(selectedProject),
          files: Array.isArray(files) ? files : [files]
        })
      });
      const data = await response.json();
      
      if (data.error) {
        alert(data.error);
      } else {
        fetchGitStatus();
      }
    } catch (error) {
      console.error('Error unstaging files:', error);
      alert('Failed to unstage files');
    }
  };

  const handleStageAll = async () => {
    try {
      const response = await authenticatedFetch('/api/git/stage-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: getProjectId(selectedProject)
        })
      });
      const data = await response.json();
      
      if (data.error) {
        alert(data.error);
      } else {
        fetchGitStatus();
      }
    } catch (error) {
      console.error('Error staging all files:', error);
      alert('Failed to stage all files');
    }
  };

  const handleUnstageAll = async () => {
    try {
      const response = await authenticatedFetch('/api/git/unstage-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: getProjectId(selectedProject)
        })
      });
      const data = await response.json();
      
      if (data.error) {
        alert(data.error);
      } else {
        fetchGitStatus();
      }
    } catch (error) {
      console.error('Error unstaging all files:', error);
      alert('Failed to unstage all files');
    }
  };

  const fetchCommitDiff = async (commitHash) => {
    try {
      const response = await authenticatedFetch(`/api/git/commit-diff?project=${encodeURIComponent(getProjectId(selectedProject))}&commit=${commitHash}`);
      const data = await response.json();
      
      if (!data.error && data.files) {
        setCommitDiffs(prev => ({
          ...prev,
          [commitHash]: data.files
        }));
      }
    } catch (error) {
      console.error('Error fetching commit diff:', error);
    }
  };

  const generateCommitMessage = async () => {
    // Check if there are staged files
    const stagedCount = (gitStatus?.staged?.modified?.length || 0) + 
                        (gitStatus?.staged?.added?.length || 0) + 
                        (gitStatus?.staged?.deleted?.length || 0);
    
    if (stagedCount === 0) {
      alert('No staged files. Please stage files before generating commit message.');
      return;
    }
    
    setIsGeneratingMessage(true);
    try {
      const response = await authenticatedFetch('/api/git/generate-commit-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: getProjectId(selectedProject),
          provider: provider // Pass the current provider (claude or cursor)
        })
      });

      const data = await response.json();
      if (data.message) {
        setCommitMessage(data.message);
      } else {
        console.error('Failed to generate commit message:', data.error);
        alert('Failed to generate commit message: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error generating commit message:', error);
      alert('Error generating commit message: ' + error.message);
    } finally {
      setIsGeneratingMessage(false);
    }
  };

  const toggleFileExpanded = (filePath) => {
    setExpandedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(filePath)) {
        newSet.delete(filePath);
      } else {
        newSet.add(filePath);
      }
      return newSet;
    });
  };

  const toggleCommitExpanded = (commitHash) => {
    setExpandedCommits(prev => {
      const newSet = new Set(prev);
      if (newSet.has(commitHash)) {
        newSet.delete(commitHash);
      } else {
        newSet.add(commitHash);
        // Fetch diff for this commit if not already fetched
        if (!commitDiffs[commitHash]) {
          fetchCommitDiff(commitHash);
        }
      }
      return newSet;
    });
  };

  const toggleFileSelected = (filePath) => {
    setSelectedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(filePath)) {
        newSet.delete(filePath);
      } else {
        newSet.add(filePath);
      }
      return newSet;
    });
  };

  const handleCommit = async () => {
    // Check if there are staged changes
    const stagedCount = (gitStatus?.staged?.modified?.length || 0) + 
                        (gitStatus?.staged?.added?.length || 0) + 
                        (gitStatus?.staged?.deleted?.length || 0);
    
    if (!commitMessage.trim() || stagedCount === 0) return;

    setIsCommitting(true);
    try {
      const response = await authenticatedFetch('/api/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: getProjectId(selectedProject),
          message: commitMessage
        })
      });

      const data = await response.json();
      if (data.success) {
        // Reset state after successful commit
        setCommitMessage('');
        setSelectedFiles(new Set());
        fetchGitStatus();
        fetchRemoteStatus();
      } else {
        console.error('Commit failed:', data.error);
        // Show error to user
        alert(data.error + (data.details ? '\n\n' + data.details : ''));
      }
    } catch (error) {
      console.error('Error committing changes:', error);
      alert('Failed to commit changes: ' + error.message);
    } finally {
      setIsCommitting(false);
    }
  };

  const createInitialCommit = async () => {
    setIsCreatingInitialCommit(true);
    try {
      const response = await authenticatedFetch('/api/git/initial-commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: getProjectId(selectedProject)
        })
      });

      const data = await response.json();
      if (data.success) {
        fetchGitStatus();
        fetchRemoteStatus();
      } else {
        console.error('Initial commit failed:', data.error);
        alert(data.error || 'Failed to create initial commit');
      }
    } catch (error) {
      console.error('Error creating initial commit:', error);
      alert('Failed to create initial commit');
    } finally {
      setIsCreatingInitialCommit(false);
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'M': return '已修改';
      case 'A': return '已添加';
      case 'D': return '已删除';
      case 'U': return '未跟踪';
      default: return status;
    }
  };

  // Open commit file diff in full screen (reuse onFileOpen with diffInfo)
  const openCommitFileDiff = async (commitHash, filename) => {
    if (!onFileOpen) return;
    
    try {
      const response = await authenticatedFetch(
        `/api/git/commit-file-diff?project=${encodeURIComponent(getProjectId(selectedProject))}&commit=${commitHash}&file=${encodeURIComponent(filename)}&withContent=true`
      );
      const data = await response.json();
      
      if (!data.error) {
        // Create diffInfo object for CodeEditor
        const diffInfo = {
          old_string: data.oldContent || '',
          new_string: data.newContent || ''
        };
        // Open file with diff information
        onFileOpen(filename, diffInfo);
      } else {
        console.error('Error fetching commit file diff:', data.error);
      }
    } catch (error) {
      console.error('Error opening commit file:', error);
    }
  };

  // Open stash file diff in full screen
  const openStashFileDiff = async (stashIndex, filename) => {
    if (!onFileOpen) return;
    
    try {
      const response = await authenticatedFetch(
        `/api/git/stash/file-diff?project=${encodeURIComponent(getProjectId(selectedProject))}&index=${stashIndex}&file=${encodeURIComponent(filename)}`
      );
      const data = await response.json();
      
      if (!data.error) {
        // Create diffInfo object for CodeEditor
        const diffInfo = {
          old_string: data.oldContent || '',
          new_string: data.newContent || ''
        };
        // Open file with diff information
        onFileOpen(filename, diffInfo);
      } else {
        console.error('Error fetching stash file diff:', data.error);
      }
    } catch (error) {
      console.error('Error opening stash file:', error);
    }
  };

  const renderCommitItem = (commit) => {
    const isExpanded = expandedCommits.has(commit.hash);
    const files = commitDiffs[commit.hash]; // Now it's an array of files
    
    return (
      <div key={commit.hash} className="border-b border-gray-200 dark:border-gray-700 last:border-0">
        <div 
          className="flex items-start p-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
          onClick={() => toggleCommitExpanded(commit.hash)}
        >
          <div className="mr-2 mt-1 p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded">
            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {commit.message}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {commit.author} • {commit.date}
                </p>
              </div>
              <span className="text-xs font-mono text-gray-400 dark:text-gray-500 flex-shrink-0">
                {commit.hash.substring(0, 7)}
              </span>
            </div>
          </div>
        </div>
        {isExpanded && (
          <div className="bg-gray-50 dark:bg-gray-900">
            {/* File list */}
            <div className="max-h-64 overflow-y-auto">
              {files && files.length > 0 ? (
                files.map((file, index) => (
                  <div 
                    key={index} 
                    className="flex items-center justify-between px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer border-b border-gray-100 dark:border-gray-800 last:border-0"
                    onClick={() => openCommitFileDiff(commit.hash, file.filename)}
                    title="Click to view diff"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {/* Status badge */}
                      <span 
                        className={`inline-flex items-center justify-center w-5 h-5 rounded text-xs font-bold flex-shrink-0 ${
                          file.status === 'M' ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' :
                          file.status === 'A' ? 'bg-green-500/20 text-green-600 dark:text-green-400' :
                          file.status === 'D' ? 'bg-red-500/20 text-red-600 dark:text-red-400' :
                          file.status === 'R' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' :
                          'bg-gray-500/20 text-gray-600 dark:text-gray-400'
                        }`}
                      >
                        {file.status}
                      </span>
                      {/* Filename */}
                      <span className="truncate text-sm text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400">
                        {file.filename}
                      </span>
                    </div>
                    {/* Line changes */}
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2 text-xs font-mono">
                      {file.additions > 0 && (
                        <span className="text-green-600 dark:text-green-400">+{file.additions}</span>
                      )}
                      {file.deletions > 0 && (
                        <span className="text-red-600 dark:text-red-400">-{file.deletions}</span>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                  <RefreshCw className="w-4 h-4 animate-spin inline-block mr-2" />
                  Loading files...
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderFileItem = (filePath, status, isStaged = false) => {
    const isSelected = selectedFiles.has(filePath);
    const stats = gitStatus?.fileStats?.[filePath];
    
    return (
      <div key={`${filePath}-${isStaged ? 'staged' : 'unstaged'}`} className="border-b border-gray-200 dark:border-gray-700 last:border-0">
        <div className={`flex items-center hover:bg-gray-50 dark:hover:bg-gray-800 ${isMobile ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleFileSelected(filePath)}
            onClick={(e) => e.stopPropagation()}
            className={`rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-800 dark:checked:bg-blue-600 ${isMobile ? 'mr-1.5' : 'mr-2'}`}
          />
          <span
            className={`flex-1 truncate ${isMobile ? 'text-xs' : 'text-sm'} cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 hover:underline`}
            onClick={(e) => {
              e.stopPropagation();
              handleFileOpen(filePath);
            }}
            title="Click to open file"
          >
            {filePath}
          </span>
          <div className="flex items-center gap-1">
            {/* Line change stats */}
            {stats && (stats.additions > 0 || stats.deletions > 0) && (
              <span className="flex items-center gap-1 text-xs font-mono mr-1">
                {stats.additions > 0 && (
                  <span className="text-green-600 dark:text-green-400">+{stats.additions}</span>
                )}
                {stats.deletions > 0 && (
                  <span className="text-red-600 dark:text-red-400">-{stats.deletions}</span>
                )}
              </span>
            )}
            {/* Stage/Unstage button */}
            {isStaged ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleUnstageFiles(filePath);
                }}
                className="p-1 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 rounded text-yellow-600 dark:text-yellow-400"
                title="Unstage file"
              >
                <Minus className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleStageFiles(filePath);
                }}
                className="p-1 hover:bg-green-100 dark:hover:bg-green-900/30 rounded text-green-600 dark:text-green-400"
                title={status === 'U' ? "Stage untracked file" : "Stage file"}
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
            {/* Discard/Delete button - only for unstaged files */}
            {!isStaged && (status === 'M' || status === 'D') && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmAction({ 
                    type: 'discard', 
                    file: filePath,
                    message: `Discard all changes to "${filePath}"? This action cannot be undone.` 
                  });
                }}
                className="p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded text-red-600 dark:text-red-400"
                title="Discard changes"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
            {!isStaged && status === 'U' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmAction({ 
                    type: 'delete', 
                    file: filePath,
                    message: `Delete untracked file "${filePath}"? This action cannot be undone.` 
                  });
                }}
                className="p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded text-red-600 dark:text-red-400"
                title="Delete untracked file"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <span 
              className={`inline-flex items-center justify-center w-5 h-5 text-xs font-bold ${
                status === 'M' ? 'text-yellow-600 dark:text-yellow-400' :
                status === 'A' ? 'text-green-600 dark:text-green-400' :
                status === 'D' ? 'text-red-600 dark:text-red-400' :
                'text-gray-500 dark:text-gray-400'
              }`}
              title={getStatusLabel(status)}
            >
              {status}
            </span>
          </div>
        </div>
      </div>
    );
  };

  // Build directory tree from file list
  const buildFileTree = (files, statusMap) => {
    const tree = {};
    
    files.forEach(filePath => {
      const parts = filePath.split('/');
      let current = tree;
      
      parts.forEach((part, index) => {
        if (index === parts.length - 1) {
          // It's a file
          current[part] = { 
            type: 'file', 
            path: filePath, 
            status: statusMap[filePath] 
          };
        } else {
          // It's a directory
          if (!current[part]) {
            current[part] = { type: 'dir', children: {} };
          }
          current = current[part].children;
        }
      });
    });
    
    return tree;
  };

  // Toggle directory expansion
  const toggleDirExpanded = (dirPath) => {
    setExpandedDirs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(dirPath)) {
        newSet.delete(dirPath);
      } else {
        newSet.add(dirPath);
      }
      return newSet;
    });
  };

  // Get all files under a directory
  const getFilesInDir = (tree, prefix = '') => {
    const files = [];
    Object.entries(tree).forEach(([name, node]) => {
      const path = prefix ? `${prefix}/${name}` : name;
      if (node.type === 'file') {
        files.push(path);
      } else if (node.type === 'dir') {
        files.push(...getFilesInDir(node.children, path));
      }
    });
    return files;
  };

  // Render directory tree item
  const renderTreeItem = (name, node, path, depth, isStaged) => {
    if (node.type === 'file') {
      const isSelected = selectedFiles.has(node.path);
      const status = node.status;
      const stats = gitStatus?.fileStats?.[node.path];
      
      return (
        <div key={`${node.path}-${isStaged ? 'staged' : 'unstaged'}`} className="border-b border-gray-200 dark:border-gray-700 last:border-0">
          <div 
            className={`flex items-center hover:bg-gray-50 dark:hover:bg-gray-800 ${isMobile ? 'px-2 py-1.5' : 'px-3 py-2'}`}
            style={{ paddingLeft: `${(depth * 16) + (isMobile ? 8 : 12)}px` }}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggleFileSelected(node.path)}
              onClick={(e) => e.stopPropagation()}
              className={`rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-800 dark:checked:bg-blue-600 ${isMobile ? 'mr-1.5' : 'mr-2'}`}
            />
            <span
              className={`flex-1 truncate ${isMobile ? 'text-xs' : 'text-sm'} cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 hover:underline`}
              onClick={(e) => {
                e.stopPropagation();
                handleFileOpen(node.path);
              }}
              title={node.path}
            >
              {name}
            </span>
            <div className="flex items-center gap-1">
              {/* Line change stats */}
              {stats && (stats.additions > 0 || stats.deletions > 0) && (
                <span className="flex items-center gap-1 text-xs font-mono mr-1">
                  {stats.additions > 0 && (
                    <span className="text-green-600 dark:text-green-400">+{stats.additions}</span>
                  )}
                  {stats.deletions > 0 && (
                    <span className="text-red-600 dark:text-red-400">-{stats.deletions}</span>
                  )}
                </span>
              )}
              {isStaged ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUnstageFiles(node.path);
                  }}
                  className="p-1 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 rounded text-yellow-600 dark:text-yellow-400"
                  title="Unstage file"
                >
                  <Minus className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStageFiles(node.path);
                  }}
                  className="p-1 hover:bg-green-100 dark:hover:bg-green-900/30 rounded text-green-600 dark:text-green-400"
                  title={status === 'U' ? "Stage untracked file" : "Stage file"}
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
              {!isStaged && (status === 'M' || status === 'D') && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmAction({ 
                      type: 'discard', 
                      file: node.path,
                      message: `Discard all changes to "${node.path}"? This action cannot be undone.` 
                    });
                  }}
                  className="p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded text-red-600 dark:text-red-400"
                  title="Discard changes"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}
              {!isStaged && status === 'U' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmAction({ 
                      type: 'delete', 
                      file: node.path,
                      message: `Delete untracked file "${node.path}"? This action cannot be undone.` 
                    });
                  }}
                  className="p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded text-red-600 dark:text-red-400"
                  title="Delete untracked file"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <span 
                className={`inline-flex items-center justify-center w-5 h-5 text-xs font-bold ${
                  status === 'M' ? 'text-yellow-600 dark:text-yellow-400' :
                  status === 'A' ? 'text-green-600 dark:text-green-400' :
                  status === 'D' ? 'text-red-600 dark:text-red-400' :
                  'text-gray-500 dark:text-gray-400'
                }`}
                title={getStatusLabel(status)}
              >
                {status}
              </span>
            </div>
          </div>
        </div>
      );
    } else {
      // Directory
      const isExpanded = expandedDirs.has(path);
      const filesInDir = getFilesInDir(node.children, path);
      const allSelected = filesInDir.every(f => selectedFiles.has(f));
      const someSelected = filesInDir.some(f => selectedFiles.has(f));
      
      return (
        <div key={`dir-${path}-${isStaged ? 'staged' : 'unstaged'}`}>
          <div 
            className={`flex items-center hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer ${isMobile ? 'px-2 py-1.5' : 'px-3 py-2'}`}
            style={{ paddingLeft: `${(depth * 16) + (isMobile ? 8 : 12)}px` }}
            onClick={() => toggleDirExpanded(path)}
          >
            <input
              type="checkbox"
              checked={allSelected}
              ref={el => {
                if (el) el.indeterminate = someSelected && !allSelected;
              }}
              onChange={(e) => {
                e.stopPropagation();
                if (allSelected) {
                  // Deselect all files in this directory
                  setSelectedFiles(prev => {
                    const newSet = new Set(prev);
                    filesInDir.forEach(f => newSet.delete(f));
                    return newSet;
                  });
                } else {
                  // Select all files in this directory
                  setSelectedFiles(prev => {
                    const newSet = new Set(prev);
                    filesInDir.forEach(f => newSet.add(f));
                    return newSet;
                  });
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className={`rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-800 dark:checked:bg-blue-600 ${isMobile ? 'mr-1.5' : 'mr-2'}`}
            />
            <ChevronRight className={`w-3 h-3 mr-1 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            <Folder className={`w-4 h-4 mr-1.5 ${isExpanded ? 'text-blue-500' : 'text-gray-400'}`} />
            <span className={`flex-1 truncate ${isMobile ? 'text-xs' : 'text-sm'} font-medium`}>
              {name}
            </span>
            <span className="text-xs text-gray-400 mr-2">
              {filesInDir.length}
            </span>
            {!isStaged && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleStageFiles(filesInDir);
                }}
                className="p-1 hover:bg-green-100 dark:hover:bg-green-900/30 rounded text-green-600 dark:text-green-400"
                title="Stage all files in directory"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
            {isStaged && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleUnstageFiles(filesInDir);
                }}
                className="p-1 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 rounded text-yellow-600 dark:text-yellow-400"
                title="Unstage all files in directory"
              >
                <Minus className="w-4 h-4" />
              </button>
            )}
          </div>
          {isExpanded && (
            <div>
              {Object.entries(node.children)
                .sort(([, a], [, b]) => {
                  // Directories first, then files
                  if (a.type === 'dir' && b.type !== 'dir') return -1;
                  if (a.type !== 'dir' && b.type === 'dir') return 1;
                  return 0;
                })
                .map(([childName, childNode]) => 
                  renderTreeItem(childName, childNode, `${path}/${childName}`, depth + 1, isStaged)
                )}
            </div>
          )}
        </div>
      );
    }
  };

  // Render file tree
  const renderFileTree = (files, statusMap, isStaged) => {
    const tree = buildFileTree(files, statusMap);
    
    return Object.entries(tree)
      .sort(([, a], [, b]) => {
        // Directories first, then files
        if (a.type === 'dir' && b.type !== 'dir') return -1;
        if (a.type !== 'dir' && b.type === 'dir') return 1;
        return 0;
      })
      .map(([name, node]) => renderTreeItem(name, node, name, 0, isStaged));
  };

  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 dark:text-gray-400">
        <p>选择项目以查看源代码管理</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className={`flex items-center justify-between border-b border-gray-200 dark:border-gray-700 ${isMobile ? 'px-3 py-2' : 'px-4 py-3'}`}>
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowBranchDropdown(!showBranchDropdown)}
            className={`flex items-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors ${isMobile ? 'space-x-1 px-2 py-1' : 'space-x-2 px-3 py-1.5'}`}
          >
            <GitBranch className={`text-gray-600 dark:text-gray-400 ${isMobile ? 'w-3 h-3' : 'w-4 h-4'}`} />
            <span className={`font-medium ${isMobile ? 'text-xs' : 'text-sm'}`}>{currentBranch}</span>
            <ChevronDown className={`w-3 h-3 text-gray-500 transition-transform ${showBranchDropdown ? 'rotate-180' : ''}`} />
          </button>
          
          {/* Branch Dropdown */}
          {showBranchDropdown && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50">
              <div className="py-1 max-h-64 overflow-y-auto">
                {branches.map(branch => (
                  <button
                    key={branch}
                    onClick={() => switchBranch(branch)}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      branch === currentBranch ? 'bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      {branch === currentBranch && <Check className="w-3 h-3 text-green-600 dark:text-green-400" />}
                      <span className={branch === currentBranch ? 'font-medium' : ''}>{branch}</span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="border-t border-gray-200 dark:border-gray-700 py-1">
                <button
                  onClick={() => {
                    setShowNewBranchModal(true);
                    setShowBranchDropdown(false);
                  }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center space-x-2"
                >
                  <Plus className="w-3 h-3" />
                  <span>Create new branch</span>
                </button>
              </div>
            </div>
          )}
        </div>
        
        <div className={`flex items-center ${isMobile ? 'gap-1' : 'gap-2'}`}>
          {/* Remote sync controls - VS Code style */}
          {remoteStatus?.hasRemote && (
            <>
              {/* Publish button - show when branch doesn't exist on remote */}
              {!remoteStatus?.hasUpstream && (
                <button
                  onClick={() => setConfirmAction({ 
                    type: 'publish', 
                    message: `Publish branch "${currentBranch}" to ${remoteStatus.remoteName}?` 
                  })}
                  disabled={isPublishing}
                  className="px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 rounded flex items-center gap-1 text-gray-600 dark:text-gray-400"
                  title={`Publish branch "${currentBranch}" to ${remoteStatus.remoteName}`}
                >
                  <Upload className={`w-3.5 h-3.5 ${isPublishing ? 'animate-pulse' : ''}`} />
                  <span className="text-xs">Publish</span>
                </button>
              )}
              
              {/* Sync status indicator + action buttons */}
              {remoteStatus?.hasUpstream && (
                <div className="flex items-center gap-1">
                  {/* Status indicator */}
                  <span 
                    className={`font-mono text-xs px-1.5 py-0.5 rounded ${
                      remoteStatus.isUpToDate 
                        ? 'text-gray-500 dark:text-gray-400' 
                        : 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30'
                    }`}
                    title={
                      remoteStatus.isUpToDate 
                        ? 'Up to date with remote' 
                        : `${remoteStatus.behind} behind, ${remoteStatus.ahead} ahead`
                    }
                  >
                    ↓{remoteStatus.behind} ↑{remoteStatus.ahead}
                  </span>
                  
                  {/* Sync button - Pull then Push */}
                  <button
                    onClick={() => setConfirmAction({ 
                      type: 'sync', 
                      message: `Sync with ${remoteStatus.remoteName}? (Pull first, then Push)`
                    })}
                    disabled={isSyncing || isPulling || isPushing}
                    className={`p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded ${
                      !remoteStatus.isUpToDate 
                        ? 'text-blue-600 dark:text-blue-400' 
                        : 'text-gray-500 dark:text-gray-400'
                    }`}
                    title="Sync (Pull + Push)"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  </button>
                  
                  {/* Pull button */}
                  <button
                    onClick={() => setConfirmAction({ 
                      type: 'pull', 
                      message: remoteStatus.behind > 0 
                        ? `Pull ${remoteStatus.behind} commit${remoteStatus.behind !== 1 ? 's' : ''} from ${remoteStatus.remoteName}?`
                        : `Pull from ${remoteStatus.remoteName}? (Already up to date)`
                    })}
                    disabled={isPulling || isSyncing}
                    className={`p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded ${
                      remoteStatus.behind > 0 
                        ? 'text-green-600 dark:text-green-400' 
                        : 'text-gray-400 dark:text-gray-500'
                    }`}
                    title={`Pull from ${remoteStatus.remoteName}`}
                  >
                    <Download className={`w-3.5 h-3.5 ${isPulling ? 'animate-bounce' : ''}`} />
                  </button>
                  
                  {/* Fetch button */}
                  <button
                    onClick={() => handleFetch(false)}
                    disabled={isFetching || isSyncing}
                    className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-600 dark:text-gray-400"
                    title={`Fetch from ${remoteStatus.remoteName}`}
                  >
                    <CloudDownload className={`w-3.5 h-3.5 ${isFetching ? 'animate-pulse' : ''}`} />
                  </button>
                </div>
              )}
            </>
          )}
          
          <button
            onClick={() => {
              fetchGitStatus();
              fetchBranches();
              fetchRemoteStatus();
            }}
            disabled={isLoading}
            className={`hover:bg-gray-100 dark:hover:bg-gray-800 rounded ${isMobile ? 'p-1' : 'p-1.5'}`}
            title="Refresh"
          >
            <RefreshCw className={`${isLoading ? 'animate-spin' : ''} ${isMobile ? 'w-3 h-3' : 'w-4 h-4'}`} />
          </button>
        </div>
      </div>

      {/* Git Repository Not Found Message */}
      {gitStatus?.error ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 dark:text-gray-400 px-6 py-12">
          <GitBranch className="w-20 h-20 mb-6 opacity-30" />
          <h3 className="text-xl font-medium mb-3 text-center">{gitStatus.error}</h3>
          {gitStatus.details && (
            <p className="text-sm text-center leading-relaxed mb-6 max-w-md">{gitStatus.details}</p>
          )}
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 max-w-md">
            <p className="text-sm text-blue-700 dark:text-blue-300 text-center">
              <strong>Tip:</strong> Run <code className="bg-blue-100 dark:bg-blue-900 px-2 py-1 rounded font-mono text-xs">git init</code> in your project directory to initialize git source control.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Tab Navigation - Only show when git is available and no files expanded */}
          <div className={`flex border-b border-gray-200 dark:border-gray-700 transition-all duration-300 ease-in-out ${
            expandedFiles.size === 0 
              ? 'max-h-16 opacity-100 translate-y-0' 
              : 'max-h-0 opacity-0 -translate-y-2 overflow-hidden'
          }`}>
            <button
              onClick={() => setActiveView('changes')}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                activeView === 'changes'
                  ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <FileText className="w-4 h-4" />
                <span>Changes</span>
              </div>
            </button>
            <button
              onClick={() => setActiveView('stash')}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                activeView === 'stash'
                  ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <Download className="w-4 h-4" />
                <span>Stash</span>
              </div>
            </button>
            <button
              onClick={() => setActiveView('history')}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                activeView === 'history'
                  ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <History className="w-4 h-4" />
                <span>History</span>
              </div>
            </button>
          </div>

          {/* Changes View */}
          {activeView === 'changes' && (
            <>
              {/* Mobile Commit Toggle Button / Desktop Always Visible - Hide when files expanded */}
              <div className={`transition-all duration-300 ease-in-out ${
                expandedFiles.size === 0 
                  ? 'max-h-96 opacity-100 translate-y-0' 
                  : 'max-h-0 opacity-0 -translate-y-2 overflow-hidden'
              }`}>
                {isMobile && isCommitAreaCollapsed ? (
                  <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                      <button
                        onClick={() => setIsCommitAreaCollapsed(false)}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                      >
                        <GitCommit className="w-4 h-4" />
                        <span>Commit {((gitStatus?.staged?.modified?.length || 0) + (gitStatus?.staged?.added?.length || 0) + (gitStatus?.staged?.deleted?.length || 0))} staged file{(((gitStatus?.staged?.modified?.length || 0) + (gitStatus?.staged?.added?.length || 0) + (gitStatus?.staged?.deleted?.length || 0)) !== 1) ? 's' : ''}</span>
                        <ChevronDown className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                <>
                  {/* Commit Message Input */}
                  <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    {/* Mobile collapse button */}
                    {isMobile && (
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">Commit Changes</span>
                        <button
                          onClick={() => setIsCommitAreaCollapsed(true)}
                          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                        >
                          <ChevronDown className="w-4 h-4 rotate-180" />
                        </button>
                      </div>
                    )}
                    
                    <div className="relative">
                      <textarea
                        ref={textareaRef}
                        value={commitMessage}
                        onChange={(e) => setCommitMessage(e.target.value)}
                        placeholder="Message (Ctrl+Enter to commit)"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 resize-none pr-20"
                        rows="3"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            handleCommit();
                          }
                        }}
                      />
                      <div className="absolute right-2 top-2 flex gap-1">
                        <button
                          onClick={generateCommitMessage}
                          disabled={((gitStatus?.staged?.modified?.length || 0) + (gitStatus?.staged?.added?.length || 0) + (gitStatus?.staged?.deleted?.length || 0)) === 0 || isGeneratingMessage}
                          className="p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Generate commit message"
                        >
                          {isGeneratingMessage ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Sparkles className="w-4 h-4" />
                          )}
                        </button>
                        <div style={{ display: 'none' }}>
                          <MicButton
                            onTranscript={(transcript) => setCommitMessage(transcript)}
                            mode="default"
                            className="p-1.5"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-gray-500">
                        {((gitStatus?.staged?.modified?.length || 0) + (gitStatus?.staged?.added?.length || 0) + (gitStatus?.staged?.deleted?.length || 0))} staged file{(((gitStatus?.staged?.modified?.length || 0) + (gitStatus?.staged?.added?.length || 0) + (gitStatus?.staged?.deleted?.length || 0)) !== 1) ? 's' : ''}
                      </span>
                      <button
                        onClick={() => {
                          const stagedCount = (gitStatus?.staged?.modified?.length || 0) + 
                                            (gitStatus?.staged?.added?.length || 0) + 
                                            (gitStatus?.staged?.deleted?.length || 0);
                          setConfirmAction({ 
                            type: 'commit', 
                            message: `Commit ${stagedCount} staged file${stagedCount !== 1 ? 's' : ''} with message: "${commitMessage.trim()}"?` 
                          });
                        }}
                        disabled={!commitMessage.trim() || ((gitStatus?.staged?.modified?.length || 0) + (gitStatus?.staged?.added?.length || 0) + (gitStatus?.staged?.deleted?.length || 0)) === 0 || isCommitting}
                        className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1"
                      >
                        <Check className="w-3 h-3" />
                        <span>{isCommitting ? 'Committing...' : 'Commit'}</span>
                      </button>
                    </div>
                  </div>
                  </>
                  )}
              </div>
            </>
          )}

          {/* File Selection Controls - Only show in changes view and when git is working */}
          {activeView === 'changes' && gitStatus && !gitStatus.error && (
            <div className={`border-b border-gray-200 dark:border-gray-700 flex items-center justify-between ${isMobile ? 'px-3 py-1.5' : 'px-4 py-2'}`}>
              <span className={`text-gray-600 dark:text-gray-400 ${isMobile ? 'text-xs' : 'text-xs'}`}>
                {selectedFiles.size} of {(gitStatus?.staged?.modified?.length || 0) + (gitStatus?.staged?.added?.length || 0) + (gitStatus?.staged?.deleted?.length || 0) + (gitStatus?.unstaged?.modified?.length || 0) + (gitStatus?.unstaged?.deleted?.length || 0) + (gitStatus?.untracked?.length || 0)} {isMobile ? '' : 'files'}
              </span>
              <div className={`flex items-center ${isMobile ? 'gap-1' : 'gap-2'}`}>
                {/* View mode toggle */}
                <button
                  onClick={() => setViewMode(viewMode === 'flat' ? 'tree' : 'flat')}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-500 dark:text-gray-400"
                  title={viewMode === 'flat' ? 'Switch to tree view' : 'Switch to flat view'}
                >
                  {viewMode === 'flat' ? <FolderTree className="w-4 h-4" /> : <List className="w-4 h-4" />}
                </button>
                <span className="text-gray-300 dark:text-gray-600">|</span>
                <button
                  onClick={() => {
                    const allFiles = new Set([
                      ...(gitStatus?.staged?.modified || []),
                      ...(gitStatus?.staged?.added || []),
                      ...(gitStatus?.staged?.deleted || []),
                      ...(gitStatus?.unstaged?.modified || []),
                      ...(gitStatus?.unstaged?.deleted || []),
                      ...(gitStatus?.untracked || [])
                    ]);
                    setSelectedFiles(allFiles);
                  }}
                  className={`text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 ${isMobile ? 'text-xs' : 'text-xs'}`}
                >
                  {isMobile ? 'All' : 'Select All'}
                </button>
                <span className="text-gray-300 dark:text-gray-600">|</span>
                <button
                  onClick={() => setSelectedFiles(new Set())}
                  className={`text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 ${isMobile ? 'text-xs' : 'text-xs'}`}
                >
                  {isMobile ? 'None' : 'Deselect All'}
                </button>
              </div>
            </div>
          )}

          {/* Status Legend Toggle - Hide on mobile by default */}
          {!gitStatus?.error && !isMobile && (
            <div className="border-b border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setShowLegend(!showLegend)}
                className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 text-xs text-gray-600 dark:text-gray-400 flex items-center justify-center gap-1"
              >
                <Info className="w-3 h-3" />
                <span>File Status Guide</span>
                {showLegend ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
              
              {showLegend && (
                <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 text-xs">
                  <div className={`${isMobile ? 'grid grid-cols-2 gap-3 justify-items-center' : 'flex justify-center gap-6'}`}>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-5 h-5 bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 rounded border border-yellow-200 dark:border-yellow-800 font-bold text-xs">
                        M
                      </span>
                      <span className="text-gray-600 dark:text-gray-400 italic">Modified</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-5 h-5 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 rounded border border-green-200 dark:border-green-800 font-bold text-xs">
                        A
                      </span>
                      <span className="text-gray-600 dark:text-gray-400 italic">Added</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-5 h-5 bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 rounded border border-red-200 dark:border-red-800 font-bold text-xs">
                        D
                      </span>
                      <span className="text-gray-600 dark:text-gray-400 italic">Deleted</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-5 h-5 bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 rounded border border-gray-300 dark:border-gray-600 font-bold text-xs">
                        U
                      </span>
                      <span className="text-gray-600 dark:text-gray-400 italic">Untracked</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* File List - Changes View - Only show when git is available */}
      {activeView === 'changes' && !gitStatus?.error && (
        <div className={`flex-1 overflow-y-auto ${isMobile ? 'pb-mobile-nav' : ''}`}>
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : gitStatus?.hasCommits === false ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <GitBranch className="w-16 h-16 mb-4 opacity-30 text-gray-400 dark:text-gray-500" />
              <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-white">No commits yet</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-md">
                This repository doesn't have any commits yet. Create your first commit to start tracking changes.
              </p>
              <button
                onClick={createInitialCommit}
                disabled={isCreatingInitialCommit}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isCreatingInitialCommit ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Creating Initial Commit...</span>
                  </>
                ) : (
                  <>
                    <GitCommit className="w-4 h-4" />
                    <span>Create Initial Commit</span>
                  </>
                )}
              </button>
            </div>
          ) : !gitStatus || (!gitStatus.staged?.modified?.length && !gitStatus.staged?.added?.length && !gitStatus.staged?.deleted?.length && !gitStatus.unstaged?.modified?.length && !gitStatus.unstaged?.deleted?.length && !gitStatus.untracked?.length) ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500 dark:text-gray-400">
              <GitCommit className="w-12 h-12 mb-2 opacity-50" />
              <p className="text-sm">No changes detected</p>
            </div>
          ) : (
            <div className={isMobile ? 'pb-4' : ''}>
              {/* Staged Changes Section */}
              {(gitStatus.staged?.modified?.length > 0 || gitStatus.staged?.added?.length > 0 || gitStatus.staged?.deleted?.length > 0) && (
                <div className="border-b border-gray-200 dark:border-gray-700">
                  <div className={`flex items-center justify-between py-2 bg-green-50 dark:bg-green-900/20 ${isMobile ? 'px-2' : 'px-3'}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-green-700 dark:text-green-300">
                        Staged Changes
                      </span>
                      <span className="text-xs text-green-600 dark:text-green-400">
                        ({(gitStatus.staged?.modified?.length || 0) + (gitStatus.staged?.added?.length || 0) + (gitStatus.staged?.deleted?.length || 0)})
                      </span>
                    </div>
                    <button
                      onClick={handleUnstageAll}
                      className="text-xs text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300"
                    >
                      Unstage All
                    </button>
                  </div>
                  <div>
                    {viewMode === 'flat' ? (
                      <>
                        {gitStatus.staged?.added?.map(file => renderFileItem(file, 'A', true))}
                        {gitStatus.staged?.modified?.map(file => renderFileItem(file, 'M', true))}
                        {gitStatus.staged?.deleted?.map(file => renderFileItem(file, 'D', true))}
                      </>
                    ) : (
                      renderFileTree(
                        [
                          ...(gitStatus.staged?.added || []),
                          ...(gitStatus.staged?.modified || []),
                          ...(gitStatus.staged?.deleted || [])
                        ],
                        {
                          ...(gitStatus.staged?.added || []).reduce((acc, f) => ({ ...acc, [f]: 'A' }), {}),
                          ...(gitStatus.staged?.modified || []).reduce((acc, f) => ({ ...acc, [f]: 'M' }), {}),
                          ...(gitStatus.staged?.deleted || []).reduce((acc, f) => ({ ...acc, [f]: 'D' }), {})
                        },
                        true
                      )
                    )}
                  </div>
                </div>
              )}

              {/* Unstaged Changes Section */}
              {(gitStatus.unstaged?.modified?.length > 0 || gitStatus.unstaged?.deleted?.length > 0 || gitStatus.untracked?.length > 0) && (
                <div>
                  <div className={`flex items-center justify-between py-2 bg-yellow-50 dark:bg-yellow-900/20 border-b border-gray-200 dark:border-gray-700 ${isMobile ? 'px-2' : 'px-3'}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-yellow-700 dark:text-yellow-300">
                        Changes
                      </span>
                      <span className="text-xs text-yellow-600 dark:text-yellow-400">
                        ({(gitStatus.unstaged?.modified?.length || 0) + (gitStatus.unstaged?.deleted?.length || 0) + (gitStatus.untracked?.length || 0)})
                      </span>
                    </div>
                    <button
                      onClick={handleStageAll}
                      className="text-xs text-yellow-600 dark:text-yellow-400 hover:text-yellow-700 dark:hover:text-yellow-300"
                    >
                      Stage All
                    </button>
                  </div>
                  <div>
                    {viewMode === 'flat' ? (
                      <>
                        {gitStatus.unstaged?.modified?.map(file => renderFileItem(file, 'M', false))}
                        {gitStatus.unstaged?.deleted?.map(file => renderFileItem(file, 'D', false))}
                        {gitStatus.untracked?.map(file => renderFileItem(file, 'U', false))}
                      </>
                    ) : (
                      renderFileTree(
                        [
                          ...(gitStatus.unstaged?.modified || []),
                          ...(gitStatus.unstaged?.deleted || []),
                          ...(gitStatus.untracked || [])
                        ],
                        {
                          ...(gitStatus.unstaged?.modified || []).reduce((acc, f) => ({ ...acc, [f]: 'M' }), {}),
                          ...(gitStatus.unstaged?.deleted || []).reduce((acc, f) => ({ ...acc, [f]: 'D' }), {}),
                          ...(gitStatus.untracked || []).reduce((acc, f) => ({ ...acc, [f]: 'U' }), {})
                        },
                        false
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Stash View */}
      {activeView === 'stash' && !gitStatus?.error && (
        <div className={`flex-1 overflow-y-auto ${isMobile ? 'pb-mobile-nav' : ''}`}>
          {/* Stash Creation Area */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="space-y-3">
              <input
                type="text"
                value={stashMessage}
                onChange={(e) => setStashMessage(e.target.value)}
                placeholder="Stash message (optional)"
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <input
                    type="checkbox"
                    checked={includeUntracked}
                    onChange={(e) => setIncludeUntracked(e.target.checked)}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  Include untracked files
                </label>
                <button
                  onClick={handleStashPush}
                  disabled={!gitStatus?.modified?.length && !gitStatus?.staged?.length && !(includeUntracked && gitStatus?.untracked?.length)}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Stash Changes
                </button>
              </div>
            </div>
          </div>

          {/* Stash List */}
          {isLoadingStash ? (
            <div className="flex items-center justify-center h-32">
              <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : stashList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500 dark:text-gray-400">
              <Download className="w-12 h-12 mb-2 opacity-50" />
              <p className="text-sm">No stashed changes</p>
            </div>
          ) : (
            <div className={isMobile ? 'pb-4' : ''}>
              {stashList.map((stash) => (
                <div key={stash.ref} className="border-b border-gray-200 dark:border-gray-700 last:border-0">
                  <div
                    className="flex items-start p-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                    onClick={() => handleStashShow(stash.index)}
                  >
                    <div className="mr-2 mt-1 p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded">
                      {expandedStash === stash.index ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {stash.message}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {new Date(stash.date).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleStashApply(stash.index); }}
                            className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                            title="Apply (keep stash)"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleStashPop(stash.index); }}
                            className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded"
                            title="Pop (apply and remove)"
                          >
                            <Upload className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleStashDrop(stash.index); }}
                            className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                            title="Drop (delete)"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <span className="text-xs font-mono text-gray-400 dark:text-gray-500 ml-1">
                            {stash.ref}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Stash Files */}
                  {expandedStash === stash.index && stashDiff && (
                    <div className="bg-gray-50 dark:bg-gray-900">
                      <div className="max-h-64 overflow-y-auto">
                        {stashDiff.files && stashDiff.files.length > 0 ? (
                          stashDiff.files.map((file, index) => (
                            <div 
                              key={index} 
                              className="flex items-center justify-between px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer border-b border-gray-100 dark:border-gray-800 last:border-0"
                              onClick={() => openStashFileDiff(stash.index, file.filename)}
                              title="Click to view diff"
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                {/* Status badge */}
                                <span 
                                  className={`inline-flex items-center justify-center w-5 h-5 rounded text-xs font-bold flex-shrink-0 ${
                                    file.status === 'M' ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' :
                                    file.status === 'A' ? 'bg-green-500/20 text-green-600 dark:text-green-400' :
                                    file.status === 'D' ? 'bg-red-500/20 text-red-600 dark:text-red-400' :
                                    'bg-gray-500/20 text-gray-600 dark:text-gray-400'
                                  }`}
                                >
                                  {file.status}
                                </span>
                                {/* Filename */}
                                <span className="truncate text-sm text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400">
                                  {file.filename}
                                </span>
                              </div>
                              {/* Line changes */}
                              <div className="flex items-center gap-2 flex-shrink-0 ml-2 text-xs font-mono">
                                {file.additions > 0 && (
                                  <span className="text-green-600 dark:text-green-400">+{file.additions}</span>
                                )}
                                {file.deletions > 0 && (
                                  <span className="text-red-600 dark:text-red-400">-{file.deletions}</span>
                                )}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                            <RefreshCw className="w-4 h-4 animate-spin inline-block mr-2" />
                            Loading files...
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* History View - Only show when git is available */}
      {activeView === 'history' && !gitStatus?.error && (
        <div className={`flex-1 overflow-y-auto ${isMobile ? 'pb-mobile-nav' : ''}`}>
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : recentCommits.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500 dark:text-gray-400">
              <History className="w-12 h-12 mb-2 opacity-50" />
              <p className="text-sm">No commits found</p>
            </div>
          ) : (
            <div className={isMobile ? 'pb-4' : ''}>
              {recentCommits.map(commit => renderCommitItem(commit))}
            </div>
          )}
        </div>
      )}

      {/* New Branch Modal */}
      {showNewBranchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowNewBranchModal(false)} />
          <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4">Create New Branch</h3>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Branch Name
                </label>
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isCreatingBranch) {
                      createBranch();
                    }
                  }}
                  placeholder="feature/new-feature"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                This will create a new branch from the current branch ({currentBranch})
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowNewBranchModal(false);
                    setNewBranchName('');
                  }}
                  className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
                >
                  Cancel
                </button>
                <button
                  onClick={createBranch}
                  disabled={!newBranchName.trim() || isCreatingBranch}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {isCreatingBranch ? (
                    <>
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3 h-3" />
                      <span>Create Branch</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setConfirmAction(null)} />
          <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center mb-4">
                <div className={`p-2 rounded-full mr-3 ${
                  (confirmAction.type === 'discard' || confirmAction.type === 'delete') ? 'bg-red-100 dark:bg-red-900' : 'bg-yellow-100 dark:bg-yellow-900'
                }`}>
                  <AlertTriangle className={`w-5 h-5 ${
                    (confirmAction.type === 'discard' || confirmAction.type === 'delete') ? 'text-red-600 dark:text-red-400' : 'text-yellow-600 dark:text-yellow-400'
                  }`} />
                </div>
                <h3 className="text-lg font-semibold">
                  {confirmAction.type === 'discard' ? 'Discard Changes' : 
                   confirmAction.type === 'delete' ? 'Delete File' :
                   confirmAction.type === 'commit' ? 'Confirm Commit' : 
                   confirmAction.type === 'pull' ? 'Confirm Pull' : 
                   confirmAction.type === 'publish' ? 'Publish Branch' :
                   confirmAction.type === 'sync' ? 'Sync with Remote' : 'Confirm Push'}
                </h3>
              </div>
              
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                {confirmAction.message}
              </p>
              
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setConfirmAction(null)}
                  className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmAndExecute}
                  className={`px-4 py-2 text-sm text-white rounded-md ${
                    (confirmAction.type === 'discard' || confirmAction.type === 'delete')
                      ? 'bg-red-600 hover:bg-red-700' 
                      : confirmAction.type === 'commit'
                      ? 'bg-blue-600 hover:bg-blue-700'
                      : confirmAction.type === 'pull'
                      ? 'bg-green-600 hover:bg-green-700'
                      : confirmAction.type === 'publish'
                      ? 'bg-purple-600 hover:bg-purple-700'
                      : confirmAction.type === 'sync'
                      ? 'bg-blue-600 hover:bg-blue-700'
                      : 'bg-orange-600 hover:bg-orange-700'
                  } flex items-center space-x-2`}
                >
                  {confirmAction.type === 'discard' ? (
                    <>
                      <Trash2 className="w-4 h-4" />
                      <span>Discard</span>
                    </>
                  ) : confirmAction.type === 'delete' ? (
                    <>
                      <Trash2 className="w-4 h-4" />
                      <span>Delete</span>
                    </>
                  ) : confirmAction.type === 'commit' ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Commit</span>
                    </>
                  ) : confirmAction.type === 'pull' ? (
                    <>
                      <Download className="w-4 h-4" />
                      <span>Pull</span>
                    </>
                  ) : confirmAction.type === 'publish' ? (
                    <>
                      <Upload className="w-4 h-4" />
                      <span>Publish</span>
                    </>
                  ) : confirmAction.type === 'sync' ? (
                    <>
                      <RefreshCw className="w-4 h-4" />
                      <span>Sync</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      <span>Push</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GitPanel;
/*
 * App.jsx - Main Application Component with Session Protection System
 * 
 * SESSION PROTECTION SYSTEM OVERVIEW:
 * ===================================
 * 
 * Problem: Automatic project updates from WebSocket would refresh the sidebar and clear chat messages
 * during active conversations, creating a poor user experience.
 * 
 * Solution: Track "active sessions" and pause project updates during conversations.
 * 
 * How it works:
 * 1. When user sends message → session marked as "active" 
 * 2. Project updates are skipped while session is active
 * 3. When conversation completes/aborts → session marked as "inactive"
 * 4. Project updates resume normally
 * 
 * Handles both existing sessions (with real IDs) and new sessions (with temporary IDs).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { Settings as SettingsIcon, Sparkles } from 'lucide-react';
import Sidebar from './components/Sidebar';
import MainContent from './components/MainContent';
import MobileNav from './components/MobileNav';
import Settings from './components/Settings';
import QuickSettingsPanel from './components/QuickSettingsPanel';
import DirectoryPickerModal from './components/DirectoryPickerModal';
import TerminalDetailView from './components/TerminalDetailView';

import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { TasksSettingsProvider } from './contexts/TasksSettingsContext';
import { WebSocketProvider, useWebSocketContext } from './contexts/WebSocketContext';
import ProtectedRoute from './components/ProtectedRoute';

import useLocalStorage from './hooks/useLocalStorage';
import { useBackClose, skipNextHistoryBack } from './hooks/useBackClose';
import { api, authenticatedFetch } from './utils/api';


// Main App component with routing
function AppContent() {
  const navigate = useNavigate();
  const { sessionId } = useParams();
  
  
  
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  
  // Remember last selected project (especially for mobile)
  const [lastSelectedProjectId, setLastSelectedProjectId] = useLocalStorage('lastSelectedProjectId', null);
  // Remember last selected session to restore on app restart
  const [lastSelectedSessionId, setLastSelectedSessionId] = useLocalStorage('lastSelectedSessionId', null);
  const hasRestoredProjectRef = React.useRef(false); // Track if we've already restored the project
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' or 'files'
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('appearance');
  const [showQuickSettings, setShowQuickSettings] = useState(false);
  const [autoExpandTools, setAutoExpandTools] = useLocalStorage('autoExpandTools', false);
  const [showRawParameters, setShowRawParameters] = useLocalStorage('showRawParameters', false);
  const [showThinking, setShowThinking] = useLocalStorage('showThinking', true);
  const [autoScrollToBottom, setAutoScrollToBottom] = useLocalStorage('autoScrollToBottom', true);
  const [sendByCtrlEnter, setSendByCtrlEnter] = useLocalStorage('sendByCtrlEnter', false);
  const [sidebarVisible, setSidebarVisible] = useLocalStorage('sidebarVisible', true);
  
  // Support closing sidebar via browser back button on mobile
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  useBackClose(sidebarOpen && isMobile, closeSidebar, 'sidebar');
  
  // Quick Terminals State
  const [showDirectoryPicker, setShowDirectoryPicker] = useState(false);
  const [selectedTerminal, setSelectedTerminal] = useState(null);
  
  // Session Protection System: Track sessions with active conversations to prevent
  // automatic project updates from interrupting ongoing chats. When a user sends
  // a message, the session is marked as "active" and project updates are paused
  // until the conversation completes or is aborted.
  const [activeSessions, setActiveSessions] = useState(new Set()); // Track sessions with active conversations

  // Processing Sessions: Track which sessions are currently thinking/processing
  // This allows us to restore the "Thinking..." banner when switching back to a processing session
  const [processingSessions, setProcessingSessions] = useState(new Set());

  // External Message Update Trigger: Incremented when external CLI modifies current session's JSONL
  // Triggers ChatInterface to reload messages without switching sessions
  const [externalMessageUpdate, setExternalMessageUpdate] = useState(0);

  // Recently Completed Sessions: Track sessions that just completed to ignore immediate file watcher updates
  // Format: Map<sessionId, {provider, timestamp}>
  const [recentlyCompletedSessions, setRecentlyCompletedSessions] = useState(new Map());

  // Track last processed message index to avoid re-processing when useEffect re-runs
  const lastProcessedMessageIndexRef = React.useRef(-1);

  const { ws, sendMessage, messages, getProjectTasks, clearMessages } = useWebSocketContext();
  
  // Detect if running as PWA
  const [isPWA, setIsPWA] = useState(false);
  
  useEffect(() => {
    // Check if running in standalone mode (PWA)
    const checkPWA = () => {
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                          window.navigator.standalone ||
                          document.referrer.includes('android-app://');
      setIsPWA(isStandalone);
        document.addEventListener('touchstart', {});

      // Add class to html and body for CSS targeting
      if (isStandalone) {
        document.documentElement.classList.add('pwa-mode');
        document.body.classList.add('pwa-mode');
      } else {
        document.documentElement.classList.remove('pwa-mode');
        document.body.classList.remove('pwa-mode');
      }
    };
    
    checkPWA();
    
    // Listen for changes
    window.matchMedia('(display-mode: standalone)').addEventListener('change', checkPWA);
    
    return () => {
      window.matchMedia('(display-mode: standalone)').removeEventListener('change', checkPWA);
    };
  }, []);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    // Fetch projects on component mount
    fetchProjects();
  }, []);

  // Helper function to determine if an update is purely additive (new sessions/projects)
  // vs modifying existing selected items that would interfere with active conversations
  const isUpdateAdditive = (currentProjects, updatedProjects, selectedProject, selectedSession) => {
    if (!selectedProject || !selectedSession) {
      // No active session to protect, allow all updates
      return true;
    }

    // Find the selected project in both current and updated data
    const currentSelectedProject = currentProjects?.find(p => p.name === selectedProject.name);
    const updatedSelectedProject = updatedProjects?.find(p => p.name === selectedProject.name);

    if (!currentSelectedProject || !updatedSelectedProject) {
      // Project structure changed significantly, not purely additive
      return false;
    }

    // Find the selected session in both current and updated project data
    const currentSelectedSession = currentSelectedProject.sessions?.find(s => s.id === selectedSession.id);
    const updatedSelectedSession = updatedSelectedProject.sessions?.find(s => s.id === selectedSession.id);

    if (!currentSelectedSession || !updatedSelectedSession) {
      // Selected session was deleted or significantly changed, not purely additive
      return false;
    }

    // Check if the selected session's content has changed (modification vs addition)
    // Compare key fields that would affect the loaded chat interface
    const sessionUnchanged = 
      currentSelectedSession.id === updatedSelectedSession.id &&
      currentSelectedSession.title === updatedSelectedSession.title &&
      currentSelectedSession.created_at === updatedSelectedSession.created_at &&
      currentSelectedSession.updated_at === updatedSelectedSession.updated_at;

    // This is considered additive if the selected session is unchanged
    // (new sessions may have been added elsewhere, but active session is protected)
    return sessionUnchanged;
  };

  // Handle WebSocket messages for real-time project updates
  useEffect(() => {
    if (messages.length > 0) {
      const latestMessageIndex = messages.length - 1;
      const latestMessage = messages[latestMessageIndex];
      
      // Log all incoming messages for debugging
      console.log('[App] WebSocket message:', latestMessage.type, {
        index: latestMessageIndex,
        lastProcessed: lastProcessedMessageIndexRef.current,
        sessionId: latestMessage.sessionId
      });
      
      // Skip if we've already processed this message
      if (latestMessageIndex <= lastProcessedMessageIndexRef.current) {
        console.log('[App] Skipping already processed message');
        return;
      }
      
      // Handle session title update from CodeBuddy
      if (latestMessage.type === 'session-title-update') {
        // Mark as processed immediately to prevent re-processing
        lastProcessedMessageIndexRef.current = latestMessageIndex;
        
        const newTitle = latestMessage.title;
        const targetSessionId = latestMessage.sessionId;
        
        if (newTitle && targetSessionId) {
          // Update selectedSession if it matches - only if title actually changed
          if (selectedSession && selectedSession.id === targetSessionId) {
            const currentTitle = selectedSession.title;
            
            // Only update if title is different to avoid triggering message reload
            if (currentTitle !== newTitle) {
              setSelectedSession(prev => {
                if (!prev) return prev;
                return { ...prev, title: newTitle };
              });
            }
          }
          
          // Also update the session in projects list for sidebar display
          // Only update if we actually find and modify a session to avoid unnecessary re-renders
          setProjects(prevProjects => {
            let hasChanges = false;
            const updatedProjects = prevProjects.map(project => {
              let projectChanged = false;
              
              // Check and update sessions (Claude)
              const updatedSessions = project.sessions?.map(s => {
                if (s.id === targetSessionId && s.title !== newTitle) {
                  projectChanged = true;
                  return { ...s, title: newTitle };
                }
                return s;
              });
              
              // Check and update codebuddySessions
              const updatedCodebuddySessions = project.codebuddySessions?.map(s => {
                if (s.id === targetSessionId && s.title !== newTitle) {
                  projectChanged = true;
                  return { ...s, title: newTitle };
                }
                return s;
              });
              
              // Check and update cursorSessions
              const updatedCursorSessions = project.cursorSessions?.map(s => {
                if (s.id === targetSessionId && s.title !== newTitle) {
                  projectChanged = true;
                  return { ...s, title: newTitle };
                }
                return s;
              });
              
              if (projectChanged) {
                hasChanges = true;
                return {
                  ...project,
                  sessions: updatedSessions,
                  codebuddySessions: updatedCodebuddySessions,
                  cursorSessions: updatedCursorSessions,
                };
              }
              return project;
            });
            
            // Only return new array if something actually changed
            return hasChanges ? updatedProjects : prevProjects;
          });
        }
        return;
      }
      
      if (latestMessage.type === 'projects_updated') {
        // Mark as processed immediately to prevent re-processing
        lastProcessedMessageIndexRef.current = latestMessageIndex;
        
        console.log('[App] projects_updated received:', {
          pendingSessionId: sessionStorage.getItem('pendingSessionId'),
          selectedSession: selectedSession?.id,
          activeSessions: Array.from(activeSessions),
          projectsCount: latestMessage.projects?.length
        });
        
        // CRITICAL: Check for pending session (synchronous check via sessionStorage)
        // This catches the race condition where session-created has fired but React state hasn't updated yet
        const pendingSessionId = sessionStorage.getItem('pendingSessionId');
        if (pendingSessionId) {
          console.log('[App] Skipping update: pendingSessionId exists:', pendingSessionId);
          return;
        }

        // Check if this update is for a recently completed session (within 3 seconds)
        // If so, skip the update to prevent immediate refresh after completion
        if (latestMessage.changedFile && latestMessage.provider) {
          const changedFileParts = latestMessage.changedFile.split('/');
          if (changedFileParts.length >= 2) {
            const filename = changedFileParts[changedFileParts.length - 1];
            const changedSessionId = filename.replace('.jsonl', '');
            
            // Check if this session was recently completed
            const recentCompletion = recentlyCompletedSessions.get(changedSessionId);
            if (recentCompletion && recentCompletion.provider === latestMessage.provider) {
              const timeSinceCompletion = Date.now() - recentCompletion.timestamp;
              if (timeSinceCompletion < 3000) { // 3 seconds window
                console.log('[App] Skipping update: recently completed session:', changedSessionId);
                return;
              } else {
                // Clean up old entry
                setRecentlyCompletedSessions(prev => {
                  const updated = new Map(prev);
                  updated.delete(changedSessionId);
                  return updated;
                });
              }
            }
          }
        }

        // External Session Update Detection: Check if the changed file is the current session's JSONL
        // If so, and the session is not active, trigger a message reload in ChatInterface
        if (latestMessage.changedFile && selectedSession && selectedProject) {
          // Extract session ID from changedFile (format: "project-name/session-id.jsonl")
          const changedFileParts = latestMessage.changedFile.split('/');
          if (changedFileParts.length >= 2) {
            const filename = changedFileParts[changedFileParts.length - 1];
            const changedSessionId = filename.replace('.jsonl', '');

            // Check if this is the currently-selected session
            if (changedSessionId === selectedSession.id) {
              const isSessionActive = activeSessions.has(selectedSession.id);

              if (!isSessionActive) {
                // Session is not active - safe to reload messages
                setExternalMessageUpdate(prev => prev + 1);
              }
            }
          }
        }

        // Session Protection Logic: Allow additions but prevent changes during active conversations
        // This allows new sessions/projects to appear in sidebar while protecting active chat messages
        // We check for two types of active sessions:
        // 1. Existing sessions: selectedSession.id exists in activeSessions
        // 2. New sessions: temporary "new-session-*" identifiers in activeSessions (before real session ID is received)
        const hasActiveSession = (selectedSession && activeSessions.has(selectedSession.id)) ||
                                 (activeSessions.size > 0 && Array.from(activeSessions).some(id => id.startsWith('new-session-')));
        
        // Also check if we have a real session ID in activeSessions (for CodeBuddy/Cursor new sessions)
        const hasActiveRealSession = activeSessions.size > 0 && 
                                     Array.from(activeSessions).some(id => !id.startsWith('new-session-'));
        
        console.log('[App] Session protection check:', {
          hasActiveSession,
          hasActiveRealSession,
          selectedSession: selectedSession?.id
        });
        
        if (hasActiveSession || hasActiveRealSession) {
          // For new sessions (no selectedSession yet), we still want to update the sidebar
          // to show the new session, but we should NOT change selectedProject/selectedSession
          // which would cause interface refresh
          if (!selectedSession && (hasActiveSession || hasActiveRealSession)) {
            // Update projects list for sidebar display, but skip selectedProject/selectedSession updates
            console.log('[App] Updating projects for new session (sidebar only)');
            const updatedProjects = latestMessage.projects;
            setProjects(updatedProjects);
            return;
          }
          
          // Allow updates but be selective: permit additions, prevent changes to existing items
          const updatedProjects = latestMessage.projects;
          const currentProjects = projects;
          
          // Check if this is purely additive (new sessions/projects) vs modification of existing ones
          const isAdditiveUpdate = isUpdateAdditive(currentProjects, updatedProjects, selectedProject, selectedSession);
          
          console.log('[App] isAdditiveUpdate:', isAdditiveUpdate);
          
          if (!isAdditiveUpdate) {
            // Skip updates that would modify existing selected session/project
            console.log('[App] Skipping non-additive update');
            return;
          }
          // Continue with additive updates below
        }
        
        // Update projects state with the new data from WebSocket
        console.log('[App] Updating projects state');
        const updatedProjects = latestMessage.projects;
        setProjects(updatedProjects);

        // Update selected project if it exists in the updated projects
        if (selectedProject) {
          const updatedSelectedProject = updatedProjects.find(p => p.name === selectedProject.name);
          if (updatedSelectedProject) {
            // Only update selected project if it actually changed - prevents flickering
            if (JSON.stringify(updatedSelectedProject) !== JSON.stringify(selectedProject)) {
              setSelectedProject(updatedSelectedProject);
            }

            // Update selected session only if it was deleted - avoid unnecessary reloads
            if (selectedSession) {
              const updatedSelectedSession = updatedSelectedProject.sessions?.find(s => s.id === selectedSession.id);
              if (!updatedSelectedSession) {
                // Session was deleted
                setSelectedSession(null);
              }
              // Don't update if session still exists with same ID - prevents reload
            }
          }
        }
      }
    }
  }, [messages, selectedProject, selectedSession, activeSessions]);

  const fetchProjects = async () => {
    try {
      setIsLoadingProjects(true);
      const response = await api.projects();
      const data = await response.json();
      
      // 简化：直接使用数据库返回的数据，不再额外请求 Cursor sessions
      setProjects(prevProjects => {
        // If no previous projects, just set the new data
        if (prevProjects.length === 0) {
          console.log('[App] fetchProjects: No previous projects, setting new data');
          return data;
        }
        
        // Check if the projects data has actually changed
        const hasChanges = data.some((newProject, index) => {
          const prevProject = prevProjects.find(p => p.id === newProject.id);
          if (!prevProject) return true;
          
          // Compare sessions count and meta
          const sessionsChanged = 
            newProject.sessions?.length !== prevProject.sessions?.length ||
            JSON.stringify(newProject.sessionMeta) !== JSON.stringify(prevProject.sessionMeta);
          
          return (
            newProject.displayName !== prevProject.displayName ||
            newProject.path !== prevProject.path ||
            sessionsChanged
          );
        }) || data.length !== prevProjects.length;
        
        console.log('[App] fetchProjects: hasChanges =', hasChanges, 'projects:', data.length);
        
        // Only update if there are actual changes
        return hasChanges ? data : prevProjects;
      });
      
      // Don't auto-select any project - user should choose manually
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  // Expose fetchProjects globally for component access
  window.refreshProjects = fetchProjects;

  // Restore last selected session/project after projects are loaded
  // Only run once when projects first load and no session is being loaded from URL
  useEffect(() => {
    // Skip if already restored or if loading a session from URL
    if (hasRestoredProjectRef.current || sessionId) {
      return;
    }
    
    // Wait for projects to load
    if (projects.length > 0) {
      // First try to restore last session
      if (lastSelectedSessionId) {
        // Find the session across all projects
        for (const project of projects) {
          const session = project.sessions?.find(s => s.id === lastSelectedSessionId) ||
                         project.codebuddySessions?.find(s => s.id === lastSelectedSessionId) ||
                         project.cursorSessions?.find(s => s.id === lastSelectedSessionId);
          if (session) {
            console.log('[App] Restoring last selected session:', lastSelectedSessionId);
            hasRestoredProjectRef.current = true;
            // Navigate to the session URL - the URL-based loading effect will handle the rest
            navigate(`/session/${lastSelectedSessionId}`);
            return;
          }
        }
        // Session not found, clear it
        console.log('[App] Last session not found, clearing:', lastSelectedSessionId);
        setLastSelectedSessionId(null);
      }
      
      // Fall back to restoring just the project
      if (lastSelectedProjectId) {
        const lastProject = projects.find(p => p.id === lastSelectedProjectId);
        if (lastProject) {
          console.log('[App] Restoring last selected project:', lastSelectedProjectId);
          setSelectedProject(lastProject);
          hasRestoredProjectRef.current = true;
        }
      }
    }
  }, [projects, sessionId, lastSelectedProjectId, lastSelectedSessionId, navigate]);

  // Expose openSettings function globally for component access
  window.openSettings = useCallback((tab = 'tools') => {
    setSettingsInitialTab(tab);
    setShowSettings(true);
  }, []);

  // Handle URL-based session loading
  useEffect(() => {
    if (sessionId && projects.length > 0) {
      // Skip if already viewing this session - prevents unnecessary state updates
      if (selectedSession?.id === sessionId) {
        return;
      }
      // Only switch tabs on initial load, not on every project update
      const shouldSwitchTab = !selectedSession || selectedSession.id !== sessionId;
      // Find the session across all projects
      for (const project of projects) {
        let session = project.sessions?.find(s => s.id === sessionId);
        if (session) {
          setSelectedProject(project);
          // Save last selected project to localStorage (use hook setter for proper JSON format)
          setLastSelectedProjectId(project?.id || null);
          // Use session.provider if available, otherwise default to 'claude'
          const provider = session.provider || 'claude';
          setSelectedSession({ ...session, provider, __provider: provider });
          // Only switch to chat tab if we're loading a different session
          if (shouldSwitchTab) {
            setActiveTab('chat');
          }
          return;
        }
        // Also check CodeBuddy sessions
        const cbSession = project.codebuddySessions?.find(s => s.id === sessionId);
        if (cbSession) {
          setSelectedProject(project);
          // Save last selected project to localStorage (use hook setter for proper JSON format)
          setLastSelectedProjectId(project?.id || null);
          const provider = cbSession.provider || 'codebuddy';
          setSelectedSession({ ...cbSession, provider, __provider: provider });
          if (shouldSwitchTab) {
            setActiveTab('chat');
          }
          return;
        }
        // Also check Cursor sessions
        const cSession = project.cursorSessions?.find(s => s.id === sessionId);
        if (cSession) {
          setSelectedProject(project);
          // Save last selected project to localStorage (use hook setter for proper JSON format)
          setLastSelectedProjectId(project?.id || null);
          const provider = cSession.provider || 'cursor';
          setSelectedSession({ ...cSession, provider, __provider: provider });
          if (shouldSwitchTab) {
            setActiveTab('chat');
          }
          return;
        }
      }
      
      // If session not found, it might be a newly created session
      // Just navigate to it and it will be found when the sidebar refreshes
      // Don't redirect to home, let the session load naturally
    }
  }, [sessionId, projects]);

  const handleProjectSelect = (project) => {
    setSelectedProject(project);
    setSelectedSession(null);
    // Save last selected project to localStorage (use hook setter for proper JSON format)
    setLastSelectedProjectId(project?.id || null);
    navigate('/');
    if (isMobile) {
      skipNextHistoryBack();
      setSidebarOpen(false);
    }
  };

  const handleSessionSelect = (session) => {
    // Clear WebSocket message queue to prevent cross-session message pollution
    clearMessages();
    
    setSelectedSession(session);
    // Save last selected session to localStorage for restoration on app restart
    setLastSelectedSessionId(session.id);
    // Only switch to chat tab when user explicitly selects a session
    // This prevents tab switching during automatic updates
    if (activeTab !== 'git' && activeTab !== 'preview') {
      setActiveTab('chat');
    }

    // For Cursor sessions, we need to set the session ID differently
    // since they're persistent and not created by Claude
    const provider = localStorage.getItem('selected-provider') || 'claude';
    if (provider === 'cursor') {
      // Cursor sessions have persistent IDs
      sessionStorage.setItem('cursorSessionId', session.id);
    }

    // Navigate first, then close sidebar
    // Skip history.back() when closing sidebar to prevent URL from reverting
    navigate(`/session/${session.id}`);

    // Only close sidebar on mobile if switching to a different project
    if (isMobile) {
      const sessionProjectName = session.__projectName;
      const currentProjectName = selectedProject?.name;

      // Close sidebar if clicking a session from a different project
      // Keep it open if clicking a session from the same project
      if (sessionProjectName !== currentProjectName) {
        skipNextHistoryBack();
        setSidebarOpen(false);
      }
    }
  };

  const handleNewSession = (project) => {
    setSelectedProject(project);
    setSelectedSession(null);
    // Save last selected project to localStorage (use hook setter for proper JSON format)
    setLastSelectedProjectId(project?.id || null);
    // Clear last session since we're starting a new one
    setLastSelectedSessionId(null);
    setActiveTab('chat');
    navigate('/');
    if (isMobile) {
      skipNextHistoryBack();
      setSidebarOpen(false);
    }
  };

  const handleSessionDelete = (sessionId) => {
    // If the deleted session was currently selected, clear it
    if (selectedSession?.id === sessionId) {
      setSelectedSession(null);
      navigate('/');
    }
    
    // Clear last selected session if it was deleted
    if (lastSelectedSessionId === sessionId) {
      setLastSelectedSessionId(null);
    }
    
    // Update projects state locally - filter all session types
    setProjects(prevProjects => 
      prevProjects.map(project => ({
        ...project,
        sessions: project.sessions?.filter(session => session.id !== sessionId) || [],
        cursorSessions: project.cursorSessions?.filter(session => session.id !== sessionId) || [],
        codebuddySessions: project.codebuddySessions?.filter(session => session.id !== sessionId) || [],
        sessionMeta: {
          ...project.sessionMeta,
          total: Math.max(0, (project.sessionMeta?.total || 0) - 1)
        }
      }))
    );
  };



  const handleSidebarRefresh = async () => {
    // Refresh only the sessions for all projects, don't change selected state
    try {
      // First sync with Claude/CodeBuddy directories
      try {
        await api.db.sync();
      } catch (syncError) {
        console.warn('Sync failed (non-critical):', syncError);
      }
      
      const response = await api.projects();
      const freshProjects = await response.json();
      
      // Optimize to preserve object references and minimize re-renders
      setProjects(prevProjects => {
        // Check if projects data has actually changed
        const hasChanges = freshProjects.some((newProject, index) => {
          const prevProject = prevProjects[index];
          if (!prevProject) return true;
          
          return (
            newProject.name !== prevProject.name ||
            newProject.displayName !== prevProject.displayName ||
            newProject.path !== prevProject.path ||
            JSON.stringify(newProject.sessionMeta) !== JSON.stringify(prevProject.sessionMeta) ||
            JSON.stringify(newProject.sessions) !== JSON.stringify(prevProject.sessions)
          );
        }) || freshProjects.length !== prevProjects.length;
        
        return hasChanges ? freshProjects : prevProjects;
      });
      
      // If we have a selected project, make sure it's still selected after refresh
      if (selectedProject) {
        const refreshedProject = freshProjects.find(p => p.name === selectedProject.name);
        if (refreshedProject) {
          // Only update selected project if it actually changed
          if (JSON.stringify(refreshedProject) !== JSON.stringify(selectedProject)) {
            setSelectedProject(refreshedProject);
          }
          
          // If we have a selected session, try to find it in the refreshed project
          if (selectedSession) {
            const refreshedSession = refreshedProject.sessions?.find(s => s.id === selectedSession.id);
            if (refreshedSession && JSON.stringify(refreshedSession) !== JSON.stringify(selectedSession)) {
              setSelectedSession(refreshedSession);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error refreshing sidebar:', error);
    }
  };

  const handleProjectDelete = (projectName) => {
    // If the deleted project was currently selected, clear it
    if (selectedProject?.name === projectName) {
      setSelectedProject(null);
      setSelectedSession(null);
      // Clear last selected project from localStorage (use hook setter)
      setLastSelectedProjectId(null);
      navigate('/');
    }
    
    // Update projects state locally instead of full refresh
    setProjects(prevProjects => 
      prevProjects.filter(project => project.name !== projectName)
    );
  };

  // Session Protection Functions: Manage the lifecycle of active sessions
  
  // markSessionAsActive: Called when user sends a message to mark session as protected
  // This includes both real session IDs and temporary "new-session-*" identifiers
  const markSessionAsActive = useCallback((sessionId) => {
    if (sessionId) {
      setActiveSessions(prev => new Set([...prev, sessionId]));
    }
  }, []);

  // markSessionAsInactive: Called when conversation completes/aborts to re-enable project updates
  const markSessionAsInactive = useCallback((sessionId) => {
    if (sessionId) {
      setActiveSessions(prev => {
        const newSet = new Set(prev);
        newSet.delete(sessionId);
        return newSet;
      });
    }
  }, []);

  // Processing Session Functions: Track which sessions are currently thinking/processing

  // markSessionAsProcessing: Called when Claude starts thinking/processing
  const markSessionAsProcessing = useCallback((sessionId) => {
    if (sessionId) {
      setProcessingSessions(prev => new Set([...prev, sessionId]));
    }
  }, []);

  // markSessionAsNotProcessing: Called when Claude finishes thinking/processing
  const markSessionAsNotProcessing = useCallback((sessionId) => {
    if (sessionId) {
      setProcessingSessions(prev => {
        const newSet = new Set(prev);
        newSet.delete(sessionId);
        return newSet;
      });
    }
  }, []);

  // Mark a session as recently completed to prevent immediate updates
  const markSessionAsCompleted = useCallback((sessionId, provider) => {
     setRecentlyCompletedSessions(prev => {
      const newMap = new Map(prev);
      newMap.set(sessionId, {
        provider,
        timestamp: Date.now()
      });
      return newMap;
    });
    
    // Auto-cleanup after 5 seconds to prevent memory leaks
    setTimeout(() => {
      setRecentlyCompletedSessions(prev => {
        const newMap = new Map(prev);
        if (newMap.has(sessionId)) {
          newMap.delete(sessionId);
        }
        return newMap;
      });
    }, 5000);
  }, []);

  // Handle session title update from MainContent
  const handleSessionTitleUpdate = useCallback((sessionId, newTitle) => {
    if (!sessionId || !newTitle) return;
    
    // Update selectedSession if it matches
    if (selectedSession && selectedSession.id === sessionId) {
      setSelectedSession(prev => {
        if (!prev) return prev;
        return { ...prev, title: newTitle };
      });
    }
    
    // Update the session in projects list for sidebar display
    setProjects(prevProjects => {
      return prevProjects.map(project => {
        // Update sessions (Claude)
        const updatedSessions = project.sessions?.map(s => {
          if (s.id === sessionId) {
            return { ...s, title: newTitle };
          }
          return s;
        });
        
        // Update codebuddySessions
        const updatedCodebuddySessions = project.codebuddySessions?.map(s => {
          if (s.id === sessionId) {
            return { ...s, title: newTitle };
          }
          return s;
        });
        
        // Update cursorSessions
        const updatedCursorSessions = project.cursorSessions?.map(s => {
          if (s.id === sessionId) {
            return { ...s, title: newTitle };
          }
          return s;
        });
        
        return {
          ...project,
          sessions: updatedSessions,
          codebuddySessions: updatedCodebuddySessions,
          cursorSessions: updatedCursorSessions
        };
      });
    });
  }, [selectedSession]);

  // replaceTemporarySession: Called when WebSocket provides real session ID for new sessions
  // Removes temporary "new-session-*" identifiers and adds the real session ID
  // This maintains protection continuity during the transition from temporary to real session
  const replaceTemporarySession = useCallback((realSessionId) => {
    if (realSessionId && selectedProject) {
      console.log('[App] replaceTemporarySession called with:', realSessionId);
      setActiveSessions(prev => {
        const newSet = new Set();
        // Keep all non-temporary sessions and add the real session ID
        for (const sessionId of prev) {
          if (!sessionId.startsWith('new-session-')) {
            newSet.add(sessionId);
          }
        }
        newSet.add(realSessionId);
        return newSet;
      });
      
      // NOTE: Do NOT update selectedSession here - it will trigger useChatSession to reload messages
      // and lose the current conversation. The ChatInterface manages currentSessionId internally.
      
      // Update only the sidebar's project sessions list
      const projectId = selectedProject.id;
      const projectPath = selectedProject.path;
      const sessionModel = selectedSession?.provider || selectedSession?.__provider || 'codebuddy';
      
      setProjects(prevProjects => 
        prevProjects.map(p => {
          if (p.id === projectId || p.path === projectPath) {
            // Check if session already exists using current project data
            const sessionExists = p.sessions?.some(s => s.id === realSessionId);
            if (sessionExists) {
              return p;
            }
            
            // Add new session to the beginning of the list
            const newSession = {
              id: realSessionId,
              provider: sessionModel,
              name: '新会话',
              summary: '新会话',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastActivity: new Date().toISOString()
            };
            
            return {
              ...p,
              sessions: [newSession, ...(p.sessions || [])],
              sessionMeta: {
                ...p.sessionMeta,
                total: (p.sessionMeta?.total || 0) + 1
              }
            };
          }
          return p;
        })
      );
    }
  }, [selectedProject, selectedSession]);

  // Quick Terminals Functions
  const handleCreateTerminal = useCallback(() => {
    setShowDirectoryPicker(true);
  }, []);

  const handleDirectorySelected = useCallback(async (workingDir) => {
    try {
      const token = localStorage.getItem('auth-token');
      const response = await fetch('/api/terminals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ workingDir })
      });

      if (response.ok) {
        const data = await response.json();
        setSelectedTerminal(data.terminal);
        setShowDirectoryPicker(false);
      } else {
        alert('创建终端失败');
      }
    } catch (error) {
      console.error('Create terminal error:', error);
      alert('创建终端失败');
    }
  }, []);

  const handleSelectTerminal = useCallback((terminal) => {
    setSelectedTerminal(terminal);
  }, []);

  const handleTerminalBack = useCallback(() => {
    setSelectedTerminal(null);
    setActiveTab('terminals');
  }, []);

  const handleUpdateTerminal = useCallback((updatedTerminal) => {
    setSelectedTerminal(updatedTerminal);
  }, []);

  const handleTerminalDelete = useCallback(async (terminalId) => {
    try {
      const token = localStorage.getItem('auth-token');
      await fetch(`/api/terminals/${terminalId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      setSelectedTerminal(null);
      setActiveTab('terminals');
    } catch (error) {
      console.error('Delete terminal error:', error);
      alert('删除失败');
    }
  }, []);

  const handleTerminalClone = useCallback(async (terminalId) => {
    try {
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`/api/terminals/${terminalId}/clone`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        // Clear current terminal first to disconnect Shell WebSocket
        setSelectedTerminal(null);
        // Then set the new cloned terminal after a small delay
        setTimeout(() => {
          setSelectedTerminal(data.terminal);
        }, 100);
      } else {
        alert('复制失败');
      }
    } catch (error) {
      console.error('Clone terminal error:', error);
      alert('复制失败');
    }
  }, []);

  

  return (
    <div className="fixed inset-0 flex bg-background">
      {/* Fixed Desktop Sidebar */}
      {!isMobile && (
        <div
          className={`h-full flex-shrink-0 border-r border-border bg-card transition-all duration-300 ${
            sidebarVisible ? 'w-80' : 'w-14'
          }`}
        >
          <div className="h-full overflow-hidden">
            {sidebarVisible ? (
              <Sidebar
                projects={projects}
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                onProjectSelect={handleProjectSelect}
                onSessionSelect={handleSessionSelect}
                onNewSession={handleNewSession}
                onSessionDelete={handleSessionDelete}
                onProjectDelete={handleProjectDelete}
                isLoading={isLoadingProjects}
                onRefresh={handleSidebarRefresh}
                onShowSettings={() => setShowSettings(true)}
                isPWA={isPWA}
                isMobile={isMobile}
                onToggleSidebar={() => setSidebarVisible(false)}
              />
            ) : (
              /* Collapsed Sidebar */
              <div className="h-full flex flex-col items-center py-4 gap-4">
                {/* Expand Button */}
                <button
                  onClick={() => setSidebarVisible(true)}
                  className="p-2 hover:bg-accent rounded-md transition-colors duration-200 group"
                  aria-label="Show sidebar"
                  title="Show sidebar"
                >
                  <svg
                    className="w-5 h-5 text-foreground group-hover:scale-110 transition-transform"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  </svg>
                </button>

                {/* Settings Icon */}
                <button
                  onClick={() => setShowSettings(true)}
                  className="p-2 hover:bg-accent rounded-md transition-colors duration-200"
                  aria-label="Settings"
                  title="Settings"
                >
                  <SettingsIcon className="w-5 h-5 text-muted-foreground hover:text-foreground transition-colors" />
                </button>

                
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile Sidebar Overlay */}
      {isMobile && (
        <div className={`fixed inset-0 z-50 flex transition-all duration-150 ease-out ${
          sidebarOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
        }`}>
          <button
            className="fixed inset-0 bg-background/80 backdrop-blur-sm transition-opacity duration-150 ease-out"
            onClick={(e) => {
              e.stopPropagation();
              setSidebarOpen(false);
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSidebarOpen(false);
            }}
            aria-label="Close sidebar"
          />
          <div
            className={`relative w-[85vw] max-w-sm sm:w-80 h-full bg-card border-r border-border transform transition-transform duration-150 ease-out ${
              sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <Sidebar
              projects={projects}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              onProjectSelect={handleProjectSelect}
              onSessionSelect={handleSessionSelect}
              onNewSession={handleNewSession}
              onSessionDelete={handleSessionDelete}
              onProjectDelete={handleProjectDelete}
              isLoading={isLoadingProjects}
              onRefresh={handleSidebarRefresh}
              onShowSettings={() => setShowSettings(true)}
              isPWA={isPWA}
              isMobile={isMobile}
              onToggleSidebar={() => setSidebarVisible(false)}
            />
          </div>
        </div>
      )}

      {/* Main Content Area - Flexible */}
      <div className={`flex-1 flex flex-col min-w-0 ${isMobile && !isInputFocused ? 'pb-mobile-nav' : ''}`}>
        {selectedTerminal ? (
          <TerminalDetailView
            terminal={selectedTerminal}
            onBack={handleTerminalBack}
            onDelete={handleTerminalDelete}
            onClone={handleTerminalClone}
            onUpdateTerminal={handleUpdateTerminal}
          />
        ) : (
          <MainContent
            selectedProject={selectedProject}
            selectedSession={selectedSession}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            ws={ws}
            sendMessage={sendMessage}
            messages={messages}
            isMobile={isMobile}
            isPWA={isPWA}
            onMenuClick={() => setSidebarOpen(true)}
            isLoading={isLoadingProjects}
            onInputFocusChange={setIsInputFocused}
            onSessionActive={markSessionAsActive}
            onSessionInactive={markSessionAsInactive}
            onSessionProcessing={markSessionAsProcessing}
            onSessionNotProcessing={markSessionAsNotProcessing}
            onSessionCompleted={markSessionAsCompleted}
            processingSessions={processingSessions}
            onReplaceTemporarySession={replaceTemporarySession}
            onNavigateToSession={(sessionId) => navigate(`/session/${sessionId}`)}
            onShowSettings={() => setShowSettings(true)}
            autoExpandTools={autoExpandTools}
            showRawParameters={showRawParameters}
            showThinking={showThinking}
            autoScrollToBottom={autoScrollToBottom}
            sendByCtrlEnter={sendByCtrlEnter}
            externalMessageUpdate={externalMessageUpdate}
            onToggleQuickSettings={() => setShowQuickSettings(prev => !prev)}
            onSelectTerminal={handleSelectTerminal}
            onCreateTerminal={handleCreateTerminal}
            getProjectTasks={getProjectTasks}
            onSessionTitleUpdate={handleSessionTitleUpdate}
          />
        )}
      </div>

      {/* Mobile Bottom Navigation */}
      {isMobile && (
        <MobileNav
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isInputFocused={isInputFocused}
          selectedProject={selectedProject}
        />
      )}
      {/* Quick Settings Panel - Only show on chat tab */}
      {activeTab === 'chat' && (
        <QuickSettingsPanel
          isOpen={showQuickSettings}
          onToggle={setShowQuickSettings}
          autoExpandTools={autoExpandTools}
          onAutoExpandChange={setAutoExpandTools}
          showRawParameters={showRawParameters}
          onShowRawParametersChange={setShowRawParameters}
          showThinking={showThinking}
          onShowThinkingChange={setShowThinking}
          autoScrollToBottom={autoScrollToBottom}
          onAutoScrollChange={setAutoScrollToBottom}
          sendByCtrlEnter={sendByCtrlEnter}
          onSendByCtrlEnterChange={setSendByCtrlEnter}
          isMobile={isMobile}
        />
      )}

      {/* Settings Modal */}
      <Settings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        projects={projects}
        initialTab={settingsInitialTab}
      />

      {/* Directory Picker Modal */}
      <DirectoryPickerModal
        isOpen={showDirectoryPicker}
        onClose={() => setShowDirectoryPicker(false)}
        onSelect={handleDirectorySelected}
        currentProject={selectedProject}
      />

      {/* Version Upgrade Modal */}
      
    </div>
  );
}

// Root App component with router
function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <WebSocketProvider>
          <TasksSettingsProvider>
            <ProtectedRoute>
              <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Routes>
                  <Route path="/" element={<AppContent />} />
                  <Route path="/session/:sessionId" element={<AppContent />} />
                </Routes>
              </Router>
            </ProtectedRoute>
          </TasksSettingsProvider>
        </WebSocketProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;

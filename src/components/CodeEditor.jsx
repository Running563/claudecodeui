import React, { useState, useEffect, useRef, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, ViewPlugin, lineNumbers } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { unifiedMergeView, getChunks, MergeView } from '@codemirror/merge';

import { X, Save, Download, Maximize2, Minimize2, Edit2 } from 'lucide-react';
import { api } from '../utils/api';

// Unified view bottom toolbar component
const UnifiedViewToolbar = ({ editorRef, isSidebar, isExpanded, onToggleExpand }) => {
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [chunkCount, setChunkCount] = useState(0);

  // Update chunk count when editor changes
  useEffect(() => {
    const updateChunks = () => {
      if (editorRef.current?.view) {
        const chunksData = getChunks(editorRef.current.view.state);
        const chunks = chunksData?.chunks || [];
        setChunkCount(chunks.length);
        if (currentChunkIndex >= chunks.length && chunks.length > 0) {
          setCurrentChunkIndex(chunks.length - 1);
        }
      }
    };
    
    // Initial update
    const timer = setTimeout(updateChunks, 100);
    return () => clearTimeout(timer);
  }, [editorRef, currentChunkIndex]);

  const navigateToChunk = (index) => {
    if (!editorRef.current?.view || chunkCount === 0) return;
    
    const chunksData = getChunks(editorRef.current.view.state);
    const chunks = chunksData?.chunks || [];
    if (index < 0 || index >= chunks.length) return;
    
    const chunk = chunks[index];
    setCurrentChunkIndex(index);
    
    editorRef.current.view.dispatch({
      effects: EditorView.scrollIntoView(chunk.fromB, { y: 'center' })
    });
  };

  const navigatePrevChunk = () => {
    const newIndex = currentChunkIndex > 0 ? currentChunkIndex - 1 : chunkCount - 1;
    navigateToChunk(newIndex);
  };

  const navigateNextChunk = () => {
    const newIndex = currentChunkIndex < chunkCount - 1 ? currentChunkIndex + 1 : 0;
    navigateToChunk(newIndex);
  };

  return (
    <div className="flex items-center justify-between px-2 py-2 border-t border-border bg-muted">
      {/* Left: navigation */}
      <div className="flex items-center gap-1">
        <button
          onClick={navigatePrevChunk}
          disabled={chunkCount === 0}
          className="p-2 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40 active:bg-gray-300 dark:active:bg-gray-600"
          title="Previous change"
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400 min-w-[40px] text-center">
          {chunkCount > 0 ? `${currentChunkIndex + 1}/${chunkCount}` : '0'} changes
        </span>
        <button
          onClick={navigateNextChunk}
          disabled={chunkCount === 0}
          className="p-2 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40 active:bg-gray-300 dark:active:bg-gray-600"
          title="Next change"
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
      
      {/* Right: action buttons */}
      <div className="flex items-center gap-1">
        {/* Settings button */}
        <button
          onClick={() => window.openSettings?.('appearance')}
          className="p-2 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 active:bg-gray-300 dark:active:bg-gray-600"
          title="Editor Settings"
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
        
        {/* Expand button (only in sidebar mode) */}
        {isSidebar && onToggleExpand && (
          <button
            onClick={onToggleExpand}
            className="p-2 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 active:bg-gray-300 dark:active:bg-gray-600"
            title={isExpanded ? 'Collapse editor' : 'Expand editor to full width'}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isExpanded ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              )}
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};

// Get language extension based on file extension (moved outside component for stability)
const getLanguageExtension = (filename) => {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return [javascript({ jsx: true, typescript: ext.includes('ts') })];
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

function CodeEditor({ file, onClose, projectPath, isSidebar = false, isExpanded = false, onToggleExpand = null }) {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState(''); // Store original content for cancel functionality
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const savedTheme = localStorage.getItem('codeEditorTheme');
    return savedTheme ? savedTheme === 'dark' : true;
  });
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showDiff, setShowDiff] = useState(!!file.diffInfo);
  const [diffViewMode, setDiffViewMode] = useState(() => {
    return localStorage.getItem('codeEditorDiffViewMode') || 'unified'; // 'unified' or 'split'
  });
  const [splitViewSide, setSplitViewSide] = useState('right'); // 'left' (original) or 'right' (modified) - for mobile
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0); // Current chunk index for mobile navigation
  const [chunkCount, setChunkCount] = useState(0); // Total number of chunks
  const [wordWrap, setWordWrap] = useState(() => {
    return localStorage.getItem('codeEditorWordWrap') === 'true';
  });

  const [showLineNumbers, setShowLineNumbers] = useState(() => {
    return localStorage.getItem('codeEditorLineNumbers') !== 'false';
  });
  const [fontSize, setFontSize] = useState(() => {
    return localStorage.getItem('codeEditorFontSize') || '14';
  });
  // Edit mode state - default to read-only (view mode)
  const [isEditMode, setIsEditMode] = useState(false);
  const editorRef = useRef(null);
  const mergeViewRef = useRef(null);
  const splitViewContainerRef = useRef(null);
  const scrollPositionRef = useRef({ ratio: 0 }); // Store scroll position ratio for mobile side switching

  // Detect mobile
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);



  // Create extension to scroll to first chunk on mount
  const scrollToFirstChunkExtension = useMemo(() => {
    if (!file.diffInfo || !showDiff) return [];

    return [
      ViewPlugin.fromClass(class {
        constructor(view) {
          // Delay to ensure merge view is fully initialized
          setTimeout(() => {
            const chunksData = getChunks(view.state);
            const chunks = chunksData?.chunks || [];

            if (chunks.length > 0) {
              const firstChunk = chunks[0];

              // Scroll to the first chunk
              view.dispatch({
                effects: EditorView.scrollIntoView(firstChunk.fromB, { y: 'center' })
              });
            }
          }, 100);
        }

        update() {}
        destroy() {}
      })
    ];
  }, [file.diffInfo, showDiff]);

  // Load file content
  useEffect(() => {
    const loadFileContent = async () => {
      try {
        setLoading(true);

        // If we have diffInfo with both old and new content, we can show the diff directly
        // This handles both GitPanel (full content) and ChatInterface (full content from API)
        if (file.diffInfo && file.diffInfo.new_string !== undefined && file.diffInfo.old_string !== undefined) {
          // Use the new_string as the content to display
          // The unifiedMergeView will compare it against old_string
          setContent(file.diffInfo.new_string);
          setOriginalContent(file.diffInfo.new_string);
          setLoading(false);
          return;
        }

        // Otherwise, load from disk
        const response = await api.readFile(file.projectId, file.path);

        if (!response.ok) {
          throw new Error(`Failed to load file: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        setContent(data.content);
        setOriginalContent(data.content);
      } catch (error) {
        console.error('Error loading file:', error);
        setContent(`// Error loading file: ${error.message}\n// File: ${file.name}\n// Path: ${file.path}`);
      } finally {
        setLoading(false);
      }
    };

    loadFileContent();
  }, [file, projectPath]);

  const handleSave = async () => {
    setSaving(true);
    try {
      console.log('Saving file:', {
        projectId: file.projectId,
        path: file.path,
        contentLength: content?.length
      });

      const response = await api.saveFile(file.projectId, file.path, content);

      console.log('Save response:', {
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get('content-type')
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Save failed: ${response.status}`);
        } else {
          const textError = await response.text();
          console.error('Non-JSON error response:', textError);
          throw new Error(`Save failed: ${response.status} ${response.statusText}`);
        }
      }

      const result = await response.json();
      console.log('Save successful:', result);

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);

    } catch (error) {
      console.error('Error saving file:', error);
      alert(`Error saving file: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  // Enter edit mode
  const handleEnterEditMode = () => {
    setIsEditMode(true);
  };

  // Cancel edit mode and restore original content
  const handleCancelEdit = () => {
    setContent(originalContent);
    setIsEditMode(false);
  };

  // Save and exit edit mode
  const handleSaveAndExit = async () => {
    await handleSave();
    setOriginalContent(content);
    setIsEditMode(false);
  };

  // Save theme preference to localStorage
  useEffect(() => {
    localStorage.setItem('codeEditorTheme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  // Save word wrap preference to localStorage
  useEffect(() => {
    localStorage.setItem('codeEditorWordWrap', wordWrap.toString());
  }, [wordWrap]);

  // Save diff view mode preference to localStorage
  useEffect(() => {
    localStorage.setItem('codeEditorDiffViewMode', diffViewMode);
  }, [diffViewMode]);

  // Listen for settings changes from the Settings modal
  useEffect(() => {
    const handleStorageChange = () => {
      const newTheme = localStorage.getItem('codeEditorTheme');
      if (newTheme) {
        setIsDarkMode(newTheme === 'dark');
      }

      const newWordWrap = localStorage.getItem('codeEditorWordWrap');
      if (newWordWrap !== null) {
        setWordWrap(newWordWrap === 'true');
      }

      const newShowLineNumbers = localStorage.getItem('codeEditorLineNumbers');
      if (newShowLineNumbers !== null) {
        setShowLineNumbers(newShowLineNumbers !== 'false');
      }

      const newFontSize = localStorage.getItem('codeEditorFontSize');
      if (newFontSize) {
        setFontSize(newFontSize);
      }
    };

    // Listen for storage events (changes from other tabs/windows)
    window.addEventListener('storage', handleStorageChange);

    // Custom event for same-window updates
    window.addEventListener('codeEditorSettingsChanged', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('codeEditorSettingsChanged', handleStorageChange);
    };
  }, []);

  // Initialize/update MergeView for split mode
  useEffect(() => {
    // Cleanup existing merge view when switching away from split mode
    if (!file.diffInfo || !showDiff || diffViewMode !== 'split') {
      if (mergeViewRef.current) {
        mergeViewRef.current.destroy();
        mergeViewRef.current = null;
      }
      return;
    }

    // Wait for container to be available
    if (!splitViewContainerRef.current) {
      return;
    }

    // Create MergeView for split view
    const container = splitViewContainerRef.current;
    container.innerHTML = '';

    const mergeView = new MergeView({
      a: {
        doc: file.diffInfo.old_string || '',
        extensions: [
          ...getLanguageExtension(file.name),
          lineNumbers(),
          EditorView.editable.of(false),
          ...(wordWrap ? [EditorView.lineWrapping] : []),
          ...(isDarkMode ? [oneDark] : []),
        ],
      },
      b: {
        doc: file.diffInfo.new_string || content,
        extensions: [
          ...getLanguageExtension(file.name),
          lineNumbers(),
          ...(wordWrap ? [EditorView.lineWrapping] : []),
          ...(isDarkMode ? [oneDark] : []),
          // Read-only control for right side (modified)
          ...(!isEditMode ? [
            EditorState.transactionFilter.of(tr => tr.docChanged ? [] : tr),
            EditorView.editable.of(false)
          ] : [
            // Listen for changes to sync with content state (only in edit mode)
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                setContent(update.state.doc.toString());
              }
            })
          ]),
        ],
      },
      parent: container,
      highlightChanges: true,
      gutter: !isMobile, // Hide gutter on mobile, use bottom toolbar instead
      revertControls: isEditMode && !isMobile ? 'b-to-a' : undefined, // Revert buttons only in edit mode (desktop only)
    });

    mergeViewRef.current = mergeView;

    // Setup scroll synchronization between the two editors
    let syncing = false;
    const syncScroll = (source, target) => {
      if (syncing) return;
      syncing = true;

      const sourceScroller = source.scrollDOM;
      const targetScroller = target.scrollDOM;

      // Calculate scroll ratio based on scrollable height
      const sourceScrollableHeight = sourceScroller.scrollHeight - sourceScroller.clientHeight;
      const targetScrollableHeight = targetScroller.scrollHeight - targetScroller.clientHeight;

      if (sourceScrollableHeight > 0 && targetScrollableHeight > 0) {
        const scrollRatio = sourceScroller.scrollTop / sourceScrollableHeight;
        targetScroller.scrollTop = scrollRatio * targetScrollableHeight;
      }

      requestAnimationFrame(() => {
        syncing = false;
      });
    };

    const handleScrollA = () => syncScroll(mergeView.a, mergeView.b);
    const handleScrollB = () => syncScroll(mergeView.b, mergeView.a);

    mergeView.a.scrollDOM.addEventListener('scroll', handleScrollA);
    mergeView.b.scrollDOM.addEventListener('scroll', handleScrollB);

    // Scroll to first change after a short delay and update chunk count
    setTimeout(() => {
      const chunks = getChunks(mergeView.b.state);
      const chunksArray = chunks?.chunks || [];
      setChunkCount(chunksArray.length);
      setCurrentChunkIndex(0);
      if (chunksArray.length > 0) {
        const firstChunk = chunksArray[0];
        mergeView.b.dispatch({
          effects: EditorView.scrollIntoView(firstChunk.fromB, { y: 'center' })
        });
      }
    }, 100);

    return () => {
      if (mergeViewRef.current) {
        mergeViewRef.current.a.scrollDOM.removeEventListener('scroll', handleScrollA);
        mergeViewRef.current.b.scrollDOM.removeEventListener('scroll', handleScrollB);
        mergeViewRef.current.destroy();
        mergeViewRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.diffInfo, showDiff, diffViewMode, isDarkMode, wordWrap, file.name, loading, isEditMode]);

  // Restore scroll position when switching sides on mobile
  useEffect(() => {
    if (!isMobile || !mergeViewRef.current) return;

    // Restore scroll position to the newly visible side
    requestAnimationFrame(() => {
      if (!mergeViewRef.current) return;
      const targetView = splitViewSide === 'left' ? mergeViewRef.current.a : mergeViewRef.current.b;
      const scroller = targetView.scrollDOM;
      const scrollableHeight = scroller.scrollHeight - scroller.clientHeight;
      if (scrollableHeight > 0) {
        scroller.scrollTop = scrollPositionRef.current.ratio * scrollableHeight;
      }
    });
  }, [splitViewSide, isMobile]);

  // Save scroll position before switching sides on mobile
  const saveScrollPosition = () => {
    if (mergeViewRef.current) {
      const currentView = splitViewSide === 'left' ? mergeViewRef.current.a : mergeViewRef.current.b;
      const scroller = currentView.scrollDOM;
      const scrollableHeight = scroller.scrollHeight - scroller.clientHeight;
      scrollPositionRef.current.ratio = scrollableHeight > 0 ? scroller.scrollTop / scrollableHeight : 0;
    }
  };

  // Mobile split view navigation functions
  const navigateToChunk = (index) => {
    if (!mergeViewRef.current || chunkCount === 0) return;

    const chunks = getChunks(mergeViewRef.current.b.state);
    const chunksArray = chunks?.chunks || [];
    if (index < 0 || index >= chunksArray.length) return;

    const chunk = chunksArray[index];
    setCurrentChunkIndex(index);

    // Scroll both views to the chunk
    const targetView = splitViewSide === 'left' ? mergeViewRef.current.a : mergeViewRef.current.b;
    const targetPos = splitViewSide === 'left' ? chunk.fromA : chunk.fromB;

    targetView.dispatch({
      effects: EditorView.scrollIntoView(targetPos, { y: 'center' })
    });
  };

  const navigatePrevChunk = () => {
    const newIndex = currentChunkIndex > 0 ? currentChunkIndex - 1 : chunkCount - 1;
    navigateToChunk(newIndex);
  };

  const navigateNextChunk = () => {
    const newIndex = currentChunkIndex < chunkCount - 1 ? currentChunkIndex + 1 : 0;
    navigateToChunk(newIndex);
  };

  const revertCurrentChunk = () => {
    if (!mergeViewRef.current || chunkCount === 0) return;

    const chunks = getChunks(mergeViewRef.current.b.state);
    const chunksArray = chunks?.chunks || [];
    if (currentChunkIndex < 0 || currentChunkIndex >= chunksArray.length) return;

    const chunk = chunksArray[currentChunkIndex];

    // Get the original text from view A
    const originalText = mergeViewRef.current.a.state.doc.sliceString(chunk.fromA, chunk.toA);

    // Replace in view B
    mergeViewRef.current.b.dispatch({
      changes: {
        from: chunk.fromB,
        to: chunk.toB,
        insert: originalText
      }
    });

    // Update chunk count after revert
    setTimeout(() => {
      const newChunks = getChunks(mergeViewRef.current.b.state);
      const newChunksArray = newChunks?.chunks || [];
      setChunkCount(newChunksArray.length);
      // Adjust current index if needed
      if (currentChunkIndex >= newChunksArray.length) {
        setCurrentChunkIndex(Math.max(0, newChunksArray.length - 1));
      }
    }, 50);
  };

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 's') {
          e.preventDefault();
          handleSave();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [content]);

  if (loading) {
    return (
      <>
        <style>
          {`
            .code-editor-loading {
              background-color: ${isDarkMode ? '#111827' : '#ffffff'} !important;
            }
            .code-editor-loading:hover {
              background-color: ${isDarkMode ? '#111827' : '#ffffff'} !important;
            }
          `}
        </style>
        {isSidebar ? (
          <div className="w-full h-full flex items-center justify-center bg-background">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              <span className="text-gray-900 dark:text-white">Loading {file.name}...</span>
            </div>
          </div>
        ) : (
          <div className="fixed inset-0 z-40 md:bg-black/50 md:flex md:items-center md:justify-center">
            <div className="code-editor-loading w-full h-full md:rounded-lg md:w-auto md:h-auto p-8 flex items-center justify-center">
              <div className="flex items-center gap-3">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                <span className="text-gray-900 dark:text-white">Loading {file.name}...</span>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <style>
        {`
          /* Light background for full line changes */
          .cm-deletedChunk {
            background-color: ${isDarkMode ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 235, 235, 1)'} !important;
            border-left: 3px solid ${isDarkMode ? 'rgba(239, 68, 68, 0.6)' : 'rgb(239, 68, 68)'} !important;
            padding-left: 4px !important;
          }

          .cm-insertedChunk {
            background-color: ${isDarkMode ? 'rgba(34, 197, 94, 0.15)' : 'rgba(230, 255, 237, 1)'} !important;
            border-left: 3px solid ${isDarkMode ? 'rgba(34, 197, 94, 0.6)' : 'rgb(34, 197, 94)'} !important;
            padding-left: 4px !important;
          }

          /* Override linear-gradient underline and use solid darker background for partial changes */
          .cm-editor.cm-merge-b .cm-changedText {
            background: ${isDarkMode ? 'rgba(34, 197, 94, 0.4)' : 'rgba(34, 197, 94, 0.3)'} !important;
            padding-top: 2px !important;
            padding-bottom: 2px !important;
            margin-top: -2px !important;
            margin-bottom: -2px !important;
          }

          .cm-editor .cm-deletedChunk .cm-changedText {
            background: ${isDarkMode ? 'rgba(239, 68, 68, 0.4)' : 'rgba(239, 68, 68, 0.3)'} !important;
            padding-top: 2px !important;
            padding-bottom: 2px !important;
            margin-top: -2px !important;
            margin-bottom: -2px !important;
          }

          /* Touch scrolling support for CodeMirror */
          .cm-editor,
          .cm-scroller {
            touch-action: pan-x pan-y !important;
            -webkit-overflow-scrolling: touch !important;
          }

          /* Split view (MergeView) styling */
          .cm-mergeView {
            height: 100%;
            display: flex;
            flex-direction: row;
            touch-action: pan-x pan-y !important;
          }

          .cm-mergeView > .cm-mergeViewEditors {
            display: flex;
            flex: 1;
            min-height: 0;
            overflow: hidden;
          }

          .cm-mergeView .cm-mergeViewEditor {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
          }

          .cm-mergeView .cm-editor {
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
          }

          .cm-mergeView .cm-scroller {
            flex: 1;
            overflow: auto !important;
            touch-action: pan-x pan-y !important;
            -webkit-overflow-scrolling: touch !important;
          }

          /* Ensure both editors share the same scroll container behavior */
          .cm-mergeView .cm-content {
            min-height: auto;
          }

          /* Split view gutter (middle connector with revert buttons) */
          .cm-mergeView .cm-mergeViewGutter {
            background-color: ${isDarkMode ? '#1f2937' : '#f3f4f6'};
            border-left: 1px solid ${isDarkMode ? '#374151' : '#e5e7eb'};
            border-right: 1px solid ${isDarkMode ? '#374151' : '#e5e7eb'};
            min-width: 24px;
            width: 24px;
          }

          /* Revert button styling in gutter */
          .cm-mergeView .cm-mergeViewGutter button {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            margin: 1px auto;
            padding: 0;
            border: none;
            border-radius: 3px;
            background-color: ${isDarkMode ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.2)'};
            color: ${isDarkMode ? '#60a5fa' : '#2563eb'};
            cursor: pointer;
            font-size: 11px;
            transition: all 0.15s ease;
          }

          .cm-mergeView .cm-mergeViewGutter button:hover {
            background-color: ${isDarkMode ? 'rgba(59, 130, 246, 0.5)' : 'rgba(59, 130, 246, 0.4)'};
          }

          .cm-mergeView .cm-mergeViewGutter button:active {
            transform: scale(0.95);
          }

          /* Split view change highlighting */
          .cm-mergeView .cm-changedLine {
            background-color: ${isDarkMode ? 'rgba(59, 130, 246, 0.1)' : 'rgba(59, 130, 246, 0.05)'};
          }

          .cm-mergeView .cm-deletedChunk {
            background-color: ${isDarkMode ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 235, 235, 1)'} !important;
          }

          .cm-mergeView .cm-insertedChunk {
            background-color: ${isDarkMode ? 'rgba(34, 197, 94, 0.15)' : 'rgba(230, 255, 237, 1)'} !important;
          }

          /* Remove underline/strikethrough effect from changed text in split view */
          .cm-mergeView .cm-changedText {
            background-image: none !important;
            text-decoration: none !important;
            background: ${isDarkMode ? 'rgba(239, 68, 68, 0.3)' : 'rgba(239, 68, 68, 0.2)'} !important;
          }

          /* Right side (new content) - green highlight for changed text */
          .cm-mergeView .cm-merge-b .cm-changedText {
            background: ${isDarkMode ? 'rgba(34, 197, 94, 0.3)' : 'rgba(34, 197, 94, 0.2)'} !important;
          }

          /* Mobile: single side view */
          ${isMobile ? `
            .cm-mergeView .cm-mergeViewGutter {
              display: none !important;
            }

            .cm-mergeView .cm-mergeViewEditor:first-child {
              display: ${splitViewSide === 'left' ? 'flex' : 'none'} !important;
              flex: 1;
            }

            .cm-mergeView .cm-mergeViewEditor:last-child {
              display: ${splitViewSide === 'right' ? 'flex' : 'none'} !important;
              flex: 1;
            }
          ` : ''}

          /* Mobile side toggle buttons */
          .side-toggle-btn-original {
            background-color: ${splitViewSide === 'left' ? '#ef4444' : '#ffffff'} !important;
            color: ${splitViewSide === 'left' ? '#ffffff' : '#6b7280'} !important;
            border-color: ${splitViewSide === 'left' ? '#ef4444' : '#d1d5db'} !important;
          }
          .side-toggle-btn-modified {
            background-color: ${splitViewSide === 'right' ? '#22c55e' : '#ffffff'} !important;
            color: ${splitViewSide === 'right' ? '#ffffff' : '#6b7280'} !important;
            border-color: ${splitViewSide === 'right' ? '#22c55e' : '#d1d5db'} !important;
          }
        `}
      </style>
      <div className={isSidebar ?
        'w-full h-full flex flex-col' :
        `fixed inset-0 z-[100] ${
          // Mobile: native fullscreen with solid bg, Desktop: modal with backdrop
          'bg-background md:bg-black/50 md:flex md:items-center md:justify-center md:p-4'
        } ${isFullscreen ? 'md:p-0' : ''}`}>
        <div className={isSidebar ?
          'bg-background flex flex-col w-full h-full' :
          `bg-background shadow-2xl flex flex-col ${
          // Mobile: always fullscreen, Desktop: modal sizing
          'w-full h-full md:rounded-lg md:shadow-2xl' +
          (isFullscreen ? ' md:w-full md:h-full md:rounded-none' : ' md:w-full md:max-w-6xl md:h-[80vh] md:max-h-[80vh]')
        }`}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0 min-w-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="font-medium text-gray-900 dark:text-white truncate">{file.name}</h3>
                {isEditMode && (
                  <span className="text-xs bg-yellow-100 dark:bg-yellow-900 text-yellow-600 dark:text-yellow-300 px-2 py-1 rounded whitespace-nowrap">
                    编辑中
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{file.path}</p>
            </div>
          </div>

          <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
            {/* Edit mode: only show cancel and save buttons */}
            {isEditMode ? (
              <>
                {/* Cancel button */}
                <button
                  onClick={handleCancelEdit}
                  className="p-2 rounded-md text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center gap-1 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0"
                  title="取消编辑"
                >
                  <svg className="w-5 h-5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span className="hidden md:inline text-sm">取消</span>
                </button>
                {/* Save button */}
                <button
                  onClick={handleSaveAndExit}
                  disabled={saving}
                  className={`p-2 rounded-md disabled:opacity-50 flex items-center justify-center gap-1 transition-colors min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 ${
                    saveSuccess
                      ? 'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30'
                      : 'text-white bg-blue-600 hover:bg-blue-700'
                  }`}
                  title="保存文件"
                >
                  {saveSuccess ? (
                    <svg className="w-5 h-5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <Save className="w-5 h-5 md:w-4 md:h-4" />
                  )}
                  <span className="hidden md:inline text-sm">保存</span>
                </button>
              </>
            ) : (
              <>
                {/* Diff view mode toggle - only show when in diff mode */}
                {file.diffInfo && showDiff && (
                  <button
                    onClick={() => setDiffViewMode(diffViewMode === 'unified' ? 'split' : 'unified')}
                    className="p-2 rounded-md text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center gap-1 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0"
                    title={diffViewMode === 'unified' ? '切换到左右对比' : '切换到统一视图'}
                  >
                    {diffViewMode === 'unified' ? (
                      /* Split view icon */
                      <svg className="w-5 h-5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                      </svg>
                    ) : (
                      /* Unified view icon */
                      <svg className="w-5 h-5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                    )}
                  </button>
                )}

                <button
                  onClick={handleDownload}
                  className="hidden md:flex p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 items-center justify-center"
                  title="Download file"
                >
                  <Download className="w-4 h-4" />
                </button>

                {/* Edit button */}
                <button
                  onClick={handleEnterEditMode}
                  className="p-2 rounded-md text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center gap-1 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0"
                  title="编辑文件"
                >
                  <Edit2 className="w-5 h-5 md:w-4 md:h-4" />
                  <span className="hidden md:inline text-sm">编辑</span>
                </button>

                {!isSidebar && (
                  <button
                    onClick={toggleFullscreen}
                    className="hidden md:flex p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 items-center justify-center"
                    title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                  >
                    {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                  </button>
                )}

                <button
                  onClick={onClose}
                  className="p-2 md:p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center"
                  title="Close"
                >
                  <X className="w-6 h-6 md:w-4 md:h-4" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Split view mode - side by side diff */}
          {file.diffInfo && showDiff && diffViewMode === 'split' ? (
            <div className="h-full flex flex-col">
              {/* Split view toolbar - desktop only */}
              {!isMobile && (
                <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted text-sm">
                  <div className="flex items-center gap-4">
                    <span className="text-red-600 dark:text-red-400 font-medium">Original</span>
                    <span className="text-gray-400">←→</span>
                    <span className="text-green-600 dark:text-green-400 font-medium">Modified</span>
                  </div>
                  <button
                    onClick={() => setDiffViewMode('unified')}
                    className="text-xs px-2 py-1 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                  >
                    Switch to Unified View
                  </button>
                </div>
              )}
              {/* MergeView container */}
              <div
                ref={splitViewContainerRef}
                className="flex-1 min-h-0"
                style={{ fontSize: `${fontSize}px` }}
              />
              {/* Mobile: bottom toolbar with revert + navigation on left, side toggle on right (2/3 width) */}
              {isMobile && (
                <div className="flex items-center px-2 py-2 border-t border-border bg-muted">
                  {/* Left: revert icon + navigation (1/3 width) */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        revertCurrentChunk();
                      }}
                      disabled={chunkCount === 0}
                      title="Revert current change"
                      className="p-2 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 disabled:opacity-40 active:bg-orange-200 dark:active:bg-orange-800/40"
                    >
                      <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigatePrevChunk();
                      }}
                      disabled={chunkCount === 0}
                      className="p-2 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40 active:bg-gray-300 dark:active:bg-gray-600"
                    >
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                    </button>
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400 min-w-[28px] text-center">
                      {chunkCount > 0 ? `${currentChunkIndex + 1}/${chunkCount}` : '0'}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigateNextChunk();
                      }}
                      disabled={chunkCount === 0}
                      className="p-2 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40 active:bg-gray-300 dark:active:bg-gray-600"
                    >
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                  {/* Right: side toggle buttons (flex-1 to take remaining ~2/3 space) */}
                  <div className="flex items-center flex-1 ml-2">
                    <button
                      onClick={() => {
                        saveScrollPosition();
                        setSplitViewSide('left');
                      }}
                      className="vk-btn side-toggle-btn-original flex-1 py-2.5 text-sm font-medium rounded-l border transition-colors"
                    >
                      Original
                    </button>
                    <button
                      onClick={() => {
                        saveScrollPosition();
                        setSplitViewSide('right');
                      }}
                      className="vk-btn side-toggle-btn-modified flex-1 py-2.5 text-sm font-medium rounded-r border transition-colors"
                    >
                      Modified
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Unified view mode - inline diff */
            <div className="h-full flex flex-col">
              <div className="flex-1 min-h-0">
                <CodeMirror
                  key={`editor-${isEditMode ? 'edit' : 'view'}`}
                  ref={editorRef}
                  value={content}
                  onChange={isEditMode ? setContent : undefined}
                  extensions={[
                    ...getLanguageExtension(file.name),
                    // Only show diff-related extensions when diff is enabled and in unified mode
                    ...(file.diffInfo && showDiff && diffViewMode === 'unified' && file.diffInfo.old_string !== undefined
                      ? [
                          unifiedMergeView({
                            original: file.diffInfo.old_string,
                            mergeControls: false,
                            highlightChanges: true,
                            syntaxHighlightDeletions: false,
                            gutter: true
                            // NOTE: NO collapseUnchanged - this shows the full file!
                          }),
                          ...scrollToFirstChunkExtension
                        ]
                      : []),
                    ...(wordWrap ? [EditorView.lineWrapping] : []),
                    // Force read-only: block all document changes when not in edit mode
                    ...(!isEditMode ? [
                      EditorState.transactionFilter.of(tr => tr.docChanged ? [] : tr),
                      EditorView.editable.of(false)
                    ] : []),
                  ]}
                  theme={isDarkMode ? oneDark : undefined}
                  height="100%"
                  style={{
                    fontSize: `${fontSize}px`,
                    height: '100%',
                  }}
                  basicSetup={{
                    lineNumbers: showLineNumbers,
                    foldGutter: true,
                    dropCursor: false,
                    allowMultipleSelections: false,
                    indentOnInput: true,
                    bracketMatching: true,
                    closeBrackets: true,
                    autocompletion: true,
                    highlightSelectionMatches: true,
                    searchKeymap: true,
                  }}
                />
              </div>
              {/* Unified view bottom toolbar - similar to split view */}
              {file.diffInfo && showDiff && (
                <UnifiedViewToolbar
                  editorRef={editorRef}
                  isSidebar={isSidebar}
                  isExpanded={isExpanded}
                  onToggleExpand={onToggleExpand}
                />
              )}
            </div>
          )}
        </div>

        {/* Footer - desktop only */}
        <div className="hidden md:flex items-center justify-between p-3 border-t border-border bg-muted flex-shrink-0">
          <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
            <span>Lines: {content.split('\n').length}</span>
            <span>Characters: {content.length}</span>
          </div>

          <div className="text-sm text-gray-500 dark:text-gray-400">
            Press Ctrl+S to save • Esc to close
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

export default CodeEditor;

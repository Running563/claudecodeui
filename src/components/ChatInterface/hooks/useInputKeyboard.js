/**
 * useInputKeyboard - Hook for managing keyboard interactions in chat input
 * 
 * Handles:
 * - Command menu navigation (arrow keys, tab, enter, escape)
 * - File dropdown navigation
 * - Permission mode cycling (Tab)
 * - Message submission (Enter/Ctrl+Enter)
 */

import { useCallback } from 'react';

/**
 * Custom hook for managing keyboard interactions
 */
export function useInputKeyboard({
  // Command menu state
  showCommandMenu,
  filteredCommands,
  selectedCommandIndex,
  setSelectedCommandIndex,
  closeCommandMenu,
  // File dropdown state
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,
  setSelectedFileIndex,
  selectFile,
  closeFileDropdown,
  // Command selection
  selectCommand,
  // Permission mode
  cyclePermissionMode,
  // Submit
  handleSubmit,
  sendByCtrlEnter
}) {
  const handleKeyDown = useCallback((e) => {
    // Handle command menu navigation
    if (showCommandMenu && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCommandIndex(prev =>
          prev < filteredCommands.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCommandIndex(prev =>
          prev > 0 ? prev - 1 : filteredCommands.length - 1
        );
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        if (selectedCommandIndex >= 0) {
          selectCommand(filteredCommands[selectedCommandIndex]);
        } else if (filteredCommands.length > 0) {
          selectCommand(filteredCommands[0]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCommandMenu();
        return;
      }
    }

    // Handle file dropdown navigation
    if (showFileDropdown && filteredFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedFileIndex(prev => 
          prev < filteredFiles.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedFileIndex(prev => 
          prev > 0 ? prev - 1 : filteredFiles.length - 1
        );
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        if (selectedFileIndex >= 0) {
          selectFile(filteredFiles[selectedFileIndex]);
        } else if (filteredFiles.length > 0) {
          selectFile(filteredFiles[0]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeFileDropdown();
        return;
      }
    }
    
    // Handle Tab key for mode switching (only when dropdowns are not showing)
    if (e.key === 'Tab' && !showFileDropdown && !showCommandMenu) {
      e.preventDefault();
      cyclePermissionMode();
      return;
    }
    
    // Handle Enter key: Cmd+Enter (Ctrl+Enter) sends, plain Enter creates new line
    if (e.key === 'Enter') {
      // If we're in composition, don't send message
      if (e.nativeEvent.isComposing) {
        return; // Let IME handle the Enter key
      }
      
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        // Ctrl+Enter or Cmd+Enter: Send message
        e.preventDefault();
        handleSubmit(e);
      }
      // Plain Enter or Shift+Enter: Allow default behavior (new line)
    }
  }, [
    showCommandMenu, filteredCommands, selectedCommandIndex, setSelectedCommandIndex,
    showFileDropdown, filteredFiles, selectedFileIndex, setSelectedFileIndex,
    selectFile, selectCommand, closeCommandMenu, closeFileDropdown,
    cyclePermissionMode, handleSubmit
  ]);

  return { handleKeyDown };
}

export default useInputKeyboard;

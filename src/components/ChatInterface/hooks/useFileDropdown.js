/**
 * useFileDropdown - Hook for @ file mention functionality
 * Handles file list fetching, filtering, and selection
 */

import { useState, useEffect, useCallback } from 'react';
import { api, getProjectId } from '../../../utils/api';

/**
 * Flatten file tree to get all file paths
 */
const flattenFileTree = (files, basePath = '') => {
  let result = [];
  for (const file of files) {
    const fullPath = basePath ? `${basePath}/${file.name}` : file.name;
    if (file.type === 'directory' && file.children) {
      result = result.concat(flattenFileTree(file.children, fullPath));
    } else if (file.type === 'file') {
      result.push({
        name: file.name,
        path: fullPath,
        relativePath: file.path
      });
    }
  }
  return result;
};

/**
 * Calculate match priority score for file search
 * Lower score = higher priority
 * 
 * Priority rules:
 * 1. Exact filename match (0)
 * 2. Filename starts with query (10)
 * 3. Filename contains query (100 + position)
 * 4. Path contains query (1000 + position)
 * 5. Add depth penalty (deeper files get lower priority)
 */
const calculateMatchScore = (file, query) => {
  if (!query) return 1000; // Empty query, keep original order
  
  const queryLower = query.toLowerCase();
  const nameLower = file.name.toLowerCase();
  const pathLower = file.path.toLowerCase();
  
  let score = 0;
  
  // 1. Exact filename match - highest priority
  if (nameLower === queryLower) {
    return 0;
  }
  
  // 2. Filename prefix match
  if (nameLower.startsWith(queryLower)) {
    score = 10;
  }
  // 3. Filename contains match (earlier position = higher priority)
  else if (nameLower.includes(queryLower)) {
    const position = nameLower.indexOf(queryLower);
    score = 100 + position;
  }
  // 4. Path contains match (earlier position = higher priority)
  else if (pathLower.includes(queryLower)) {
    const position = pathLower.indexOf(queryLower);
    score = 1000 + position;
  }
  // 5. No match (shouldn't happen after filter)
  else {
    return 10000;
  }
  
  // Add depth penalty: deeper files get slightly lower priority
  const depth = file.path.split('/').length;
  score += depth * 0.1; // Small penalty for depth
  
  return score;
};

/**
 * Hook for managing file dropdown (@ mentions)
 * @param {Object} params
 * @param {Object} params.selectedProject - Currently selected project
 * @param {string} params.input - Current input value
 * @param {number} params.cursorPosition - Current cursor position
 * @param {Function} params.setInput - Function to update input
 * @param {Function} params.setCursorPosition - Function to update cursor position
 * @param {React.RefObject} params.textareaRef - Ref to textarea element
 */
export function useFileDropdown({
  selectedProject,
  input,
  cursorPosition,
  setInput,
  setCursorPosition,
  textareaRef
}) {
  const [showFileDropdown, setShowFileDropdown] = useState(false);
  const [fileList, setFileList] = useState([]);
  const [filteredFiles, setFilteredFiles] = useState([]);
  const [selectedFileIndex, setSelectedFileIndex] = useState(-1);
  const [atSymbolPosition, setAtSymbolPosition] = useState(-1);

  // Track project ID to avoid unnecessary refetches
  const projectId = selectedProject ? getProjectId(selectedProject) : null;

  // Fetch project files when project ID changes (not on every selectedProject object change)
  useEffect(() => {
    const fetchProjectFiles = async () => {
      if (!projectId) return;
      
      try {
        // Fetch with depth=10 to get deep file tree for @ mentions
        const response = await api.getFiles(projectId, { depth: 10 });
        if (response.ok) {
          const files = await response.json();
          const flatFiles = flattenFileTree(files);
          setFileList(flatFiles);
        }
      } catch (error) {
        console.error('Error fetching files:', error);
      }
    };

    fetchProjectFiles();
  }, [projectId]);

  // Handle @ symbol detection and file filtering
  useEffect(() => {
    const textBeforeCursor = input.slice(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      // Check if there's a space after the @ symbol
      if (!textAfterAt.includes(' ')) {
        setAtSymbolPosition(lastAtIndex);
        setShowFileDropdown(true);
        
        // Filter and sort files with intelligent priority scoring
        const queryLower = textAfterAt.toLowerCase();
        const filtered = fileList
          .filter(file => 
            file.name.toLowerCase().includes(queryLower) ||
            file.path.toLowerCase().includes(queryLower)
          )
          .map(file => ({
            ...file,
            score: calculateMatchScore(file, textAfterAt)
          }))
          .sort((a, b) => {
            // Primary: sort by score (lower = higher priority)
            if (a.score !== b.score) {
              return a.score - b.score;
            }
            // Secondary: alphabetical order
            return a.name.localeCompare(b.name);
          })
          .slice(0, 10);
        
        setFilteredFiles(filtered);
        setSelectedFileIndex(-1);
      } else {
        setShowFileDropdown(false);
        setAtSymbolPosition(-1);
      }
    } else {
      setShowFileDropdown(false);
      setAtSymbolPosition(-1);
    }
  }, [input, cursorPosition, fileList]);

  // Select a file from dropdown
  const selectFile = useCallback((file) => {
    const textBeforeAt = input.slice(0, atSymbolPosition);
    const textAfterAtQuery = input.slice(atSymbolPosition);
    const spaceIndex = textAfterAtQuery.indexOf(' ');
    const textAfterQuery = spaceIndex !== -1 ? textAfterAtQuery.slice(spaceIndex) : '';
    
    const newInput = textBeforeAt + '@' + file.path + ' ' + textAfterQuery;
    const newCursorPos = textBeforeAt.length + 1 + file.path.length + 1;
    
    // Ensure focus is maintained
    if (textareaRef.current && !textareaRef.current.matches(':focus')) {
      textareaRef.current.focus();
    }
    
    setInput(newInput);
    setCursorPosition(newCursorPos);
    setShowFileDropdown(false);
    setAtSymbolPosition(-1);
    
    // Set cursor position
    if (textareaRef.current) {
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          if (!textareaRef.current.matches(':focus')) {
            textareaRef.current.focus();
          }
        }
      });
    }
  }, [input, atSymbolPosition, setInput, setCursorPosition, textareaRef]);

  // Close dropdown
  const closeDropdown = useCallback(() => {
    setShowFileDropdown(false);
    setAtSymbolPosition(-1);
  }, []);

  return {
    showFileDropdown,
    setShowFileDropdown,
    fileList,
    filteredFiles,
    selectedFileIndex,
    setSelectedFileIndex,
    atSymbolPosition,
    selectFile,
    closeDropdown
  };
}

export default useFileDropdown;

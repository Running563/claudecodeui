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

  // Fetch project files when project changes
  useEffect(() => {
    const fetchProjectFiles = async () => {
      if (!selectedProject) return;
      
      try {
        const response = await api.getFiles(getProjectId(selectedProject));
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
  }, [selectedProject]);

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
        
        // Filter files based on the text after @
        const filtered = fileList.filter(file => 
          file.name.toLowerCase().includes(textAfterAt.toLowerCase()) ||
          file.path.toLowerCase().includes(textAfterAt.toLowerCase())
        ).slice(0, 10);
        
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

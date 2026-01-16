/**
 * useInputManagement - Hook for managing chat input state
 * 
 * Handles:
 * - Input value and debouncing
 * - Cursor position tracking
 * - Textarea expansion state
 * - Draft persistence to localStorage
 * - Transcript handling (voice input)
 * - Keyboard navigation for dropdowns/menus
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { safeLocalStorage } from '../utils';

/**
 * Custom hook for managing chat input state and behavior
 */
export function useInputManagement({
  selectedProject,
  textareaRef,
  provider
}) {
  // Input state
  const [input, setInput] = useState(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      return safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
    }
    return '';
  });
  
  const [debouncedInput, setDebouncedInput] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);

  // Debounced input handling
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedInput(input);
    }, 150); // 150ms debounce
    
    return () => clearTimeout(timer);
  }, [input]);

  // Persist input draft to localStorage
  useEffect(() => {
    if (selectedProject && input !== '') {
      safeLocalStorage.setItem(`draft_input_${selectedProject.name}`, input);
    } else if (selectedProject && input === '') {
      safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
    }
  }, [input, selectedProject]);

  // Load saved input when project changes
  useEffect(() => {
    if (selectedProject) {
      const savedInput = safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
      if (savedInput !== input) {
        setInput(savedInput);
      }
    }
  }, [selectedProject?.name]);

  // Initial textarea setup - set to 2 rows height
  useEffect(() => {
    if (textareaRef.current) {
      const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight) || 21;
      const maxHeight = lineHeight * 10; // 最大 10 行
      
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.min(textareaRef.current.scrollHeight, maxHeight);
      textareaRef.current.style.height = newHeight + 'px';

      // Check if initially expanded
      const isExpanded = newHeight > lineHeight * 2;
      setIsTextareaExpanded(isExpanded);
    }
  }, []); // Only run once on mount

  // Reset textarea height when input is cleared programmatically
  useEffect(() => {
    if (textareaRef.current && !input.trim()) {
      textareaRef.current.style.height = 'auto';
      setIsTextareaExpanded(false);
    }
  }, [input, textareaRef]);

  // Handle voice transcript
  const handleTranscript = useCallback((text) => {
    if (text.trim()) {
      setInput(prevInput => {
        const newInput = prevInput.trim() ? `${prevInput} ${text}` : text;

        // Update textarea height after setting new content
        setTimeout(() => {
          if (textareaRef.current) {
            const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight) || 21;
            const maxHeight = lineHeight * 10; // 最大 10 行
            
            textareaRef.current.style.height = 'auto';
            const newHeight = Math.min(textareaRef.current.scrollHeight, maxHeight);
            textareaRef.current.style.height = newHeight + 'px';

            // Check if expanded after transcript
            const isExpanded = newHeight > lineHeight * 2;
            setIsTextareaExpanded(isExpanded);
          }
        }, 0);

        return newInput;
      });
    }
  }, [textareaRef]);

  // Handle textarea click to update cursor position
  const handleTextareaClick = useCallback((e) => {
    setCursorPosition(e.target.selectionStart);
  }, []);

  // Handle textarea input event for auto-resize (max 10 lines)
  const handleTextareaInput = useCallback((e) => {
    const lineHeight = parseInt(window.getComputedStyle(e.target).lineHeight) || 21;
    const maxHeight = lineHeight * 10; // 最大 10 行
    
    e.target.style.height = 'auto';
    const newHeight = Math.min(e.target.scrollHeight, maxHeight);
    e.target.style.height = newHeight + 'px';
    setCursorPosition(e.target.selectionStart);

    // Check if textarea is expanded (more than 2 lines worth of height)
    const isExpanded = newHeight > lineHeight * 2;
    setIsTextareaExpanded(isExpanded);
  }, []);

  // Clear input and reset textarea
  const clearInput = useCallback(() => {
    setInput('');
    setIsTextareaExpanded(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [textareaRef]);

  // Clear input button handler (prevents event propagation)
  const handleClearInput = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
    setIsTextareaExpanded(false);
  }, [textareaRef]);

  // Placeholder text based on provider
  const placeholderText = useMemo(() => {
    const providerName = provider === 'cursor' ? 'Cursor' : provider === 'codebuddy' ? 'CodeBuddy' : 'Claude';
    return `输入 / 执行命令、@ 选择文件,或向 ${providerName} 提问...`;
  }, [provider]);

  return {
    input,
    setInput,
    debouncedInput,
    cursorPosition,
    setCursorPosition,
    isTextareaExpanded,
    setIsTextareaExpanded,
    isInputFocused,
    setIsInputFocused,
    handleTranscript,
    handleTextareaClick,
    handleTextareaInput,
    clearInput,
    handleClearInput,
    placeholderText
  };
}

export default useInputManagement;

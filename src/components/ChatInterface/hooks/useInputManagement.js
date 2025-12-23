/**
 * useInputManagement - Hook for managing chat input state
 * 
 * Handles:
 * - Input value and debouncing
 * - Cursor position tracking
 * - Textarea expansion state
 * - Draft persistence to localStorage
 * - Transcript handling (voice input)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { safeLocalStorage } from '../utils';

/**
 * Custom hook for managing chat input state and behavior
 */
export function useInputManagement({
  selectedProject,
  textareaRef
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
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';

      // Check if initially expanded
      const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
      const isExpanded = textareaRef.current.scrollHeight > lineHeight * 2;
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
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';

            // Check if expanded after transcript
            const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
            const isExpanded = textareaRef.current.scrollHeight > lineHeight * 2;
            setIsTextareaExpanded(isExpanded);
          }
        }, 0);

        return newInput;
      });
    }
  }, [textareaRef]);

  // Handle input change with height adjustment
  const handleInputChange = useCallback((e, { closeCommandMenu, detectSlashCommand } = {}) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart;

    setInput(newValue);
    setCursorPosition(cursorPos);

    // Handle height reset when input becomes empty
    if (!newValue.trim()) {
      e.target.style.height = 'auto';
      setIsTextareaExpanded(false);
      if (closeCommandMenu) {
        closeCommandMenu();
      }
      return;
    }

    // Detect slash command at cursor position
    if (detectSlashCommand) {
      detectSlashCommand(newValue, cursorPos);
    }
  }, []);

  // Handle textarea click to update cursor position
  const handleTextareaClick = useCallback((e) => {
    setCursorPosition(e.target.selectionStart);
  }, []);

  // Handle textarea input event for auto-resize
  const handleTextareaInput = useCallback((e) => {
    e.target.style.height = 'auto';
    e.target.style.height = e.target.scrollHeight + 'px';
    setCursorPosition(e.target.selectionStart);

    // Check if textarea is expanded (more than 2 lines worth of height)
    const lineHeight = parseInt(window.getComputedStyle(e.target).lineHeight);
    const isExpanded = e.target.scrollHeight > lineHeight * 2;
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
    handleInputChange,
    handleTextareaClick,
    handleTextareaInput,
    clearInput
  };
}

export default useInputManagement;

/**
 * useCommandExecution - Hook for slash command execution
 * Sends commands as normal messages to CLI for processing
 */

import { useCallback, useRef } from 'react';

/**
 * Hook for managing command execution
 * @param {Object} params
 * @param {Function} params.setInput - Set input value
 * @param {Function} params.resetCommandMenu - Reset command menu state
 */
export function useCommandExecution({
  setInput,
  resetCommandMenu
}) {
  // Ref to store handleSubmit so we can call it
  const handleSubmitRef = useRef(null);

  // Execute a command - send it as a normal message to CLI
  const executeCommand = useCallback(async (command, input) => {
    if (!command) return;

    // Parse command and arguments from current input
    const commandMatch = input.match(new RegExp(`${command.name}\\s*(.*)`));
    const argsStr = commandMatch && commandMatch[1] ? commandMatch[1].trim() : '';
    
    // Build the full command string
    const fullCommand = argsStr ? `${command.name} ${argsStr}` : command.name;
    
    // Set the input and submit as normal message
    setInput(fullCommand);
    resetCommandMenu();
    
    // Wait for state to update, then directly call handleSubmit
    setTimeout(() => {
      if (handleSubmitRef.current) {
        const fakeEvent = { preventDefault: () => {} };
        handleSubmitRef.current(fakeEvent);
      }
    }, 50);
  }, [setInput, resetCommandMenu]);

  // Set the handleSubmit ref (to be called from parent component)
  const setHandleSubmitRef = useCallback((handleSubmit) => {
    handleSubmitRef.current = handleSubmit;
  }, []);

  return {
    executeCommand,
    setHandleSubmitRef,
    handleSubmitRef
  };
}

/**
 * useCommandExecution - Hook for slash command execution
 * Handles built-in and custom command execution
 */

import { useCallback, useRef } from 'react';
import { authenticatedFetch } from '../../../utils/api';

/**
 * Hook for managing command execution
 * @param {Object} params
 * @param {Object} params.selectedProject - Currently selected project
 * @param {string} params.currentSessionId - Current session ID
 * @param {string} params.provider - Current provider (claude/cursor/codebuddy)
 * @param {string} params.cursorModel - Current Cursor model
 * @param {Object} params.tokenBudget - Token budget info
 * @param {Function} params.setChatMessages - Set chat messages
 * @param {Function} params.setSessionMessages - Set session messages
 * @param {Function} params.setInput - Set input value
 * @param {Function} params.resetCommandMenu - Reset command menu state
 * @param {Function} params.onFileOpen - Callback to open file
 * @param {Function} params.onShowSettings - Callback to show settings
 */
export function useCommandExecution({
  selectedProject,
  currentSessionId,
  provider,
  cursorModel,
  tokenBudget,
  setChatMessages,
  setSessionMessages,
  setInput,
  resetCommandMenu,
  onFileOpen,
  onShowSettings
}) {
  // Ref to store handleSubmit so we can call it from handleCustomCommand
  const handleSubmitRef = useRef(null);

  // Handle built-in command actions
  const handleBuiltInCommand = useCallback((result) => {
    const { action, data } = result;

    switch (action) {
      case 'clear':
        // Clear conversation history
        setChatMessages([]);
        setSessionMessages([]);
        break;

      case 'help':
        // Show help content
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: data.content,
          timestamp: Date.now()
        }]);
        break;

      case 'model':
        // Show model information
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: `**Current Model**: ${data.current.model}\n\n**Available Models**:\n\nClaude: ${data.available.claude.join(', ')}\n\nCursor: ${data.available.cursor.join(', ')}`,
          timestamp: Date.now()
        }]);
        break;

      case 'cost': {
        const costMessage = `**Token Usage**: ${data.tokenUsage.used.toLocaleString()} / ${data.tokenUsage.total.toLocaleString()} (${data.tokenUsage.percentage}%)\n\n**Estimated Cost**:\n- Input: $${data.cost.input}\n- Output: $${data.cost.output}\n- **Total**: $${data.cost.total}\n\n**Model**: ${data.model}`;
        setChatMessages(prev => [...prev, { role: 'assistant', content: costMessage, timestamp: Date.now() }]);
        break;
      }

      case 'status': {
        const statusMessage = `**System Status**\n\n- Version: ${data.version}\n- Uptime: ${data.uptime}\n- Model: ${data.model}\n- Provider: ${data.provider}\n- Node.js: ${data.nodeVersion}\n- Platform: ${data.platform}`;
        setChatMessages(prev => [...prev, { role: 'assistant', content: statusMessage, timestamp: Date.now() }]);
        break;
      }

      case 'memory':
        // Show memory file info
        if (data.error) {
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: `⚠️ ${data.message}`,
            timestamp: Date.now()
          }]);
        } else {
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: `📝 ${data.message}\n\nPath: \`${data.path}\``,
            timestamp: Date.now()
          }]);
          // Optionally open file in editor
          if (data.exists && onFileOpen) {
            onFileOpen(data.path);
          }
        }
        break;

      case 'config':
        // Open settings
        if (onShowSettings) {
          onShowSettings();
        }
        break;

      case 'rewind':
        // Rewind conversation
        if (data.error) {
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: `⚠️ ${data.message}`,
            timestamp: Date.now()
          }]);
        } else {
          // Remove last N messages
          setChatMessages(prev => prev.slice(0, -data.steps * 2)); // Remove user + assistant pairs
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: `⏪ ${data.message}`,
            timestamp: Date.now()
          }]);
        }
        break;

      default:
        console.warn('Unknown built-in command action:', action);
    }
  }, [setChatMessages, setSessionMessages, onFileOpen, onShowSettings]);

  // Handle custom command execution
  const handleCustomCommand = useCallback(async (result, args) => {
    const { content, hasBashCommands } = result;

    // Show confirmation for bash commands
    if (hasBashCommands) {
      const confirmed = window.confirm(
        'This command contains bash commands that will be executed. Do you want to proceed?'
      );
      if (!confirmed) {
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: '❌ Command execution cancelled',
          timestamp: Date.now()
        }]);
        return;
      }
    }

    // Set the input to the command content
    setInput(content);

    // Wait for state to update, then directly call handleSubmit
    setTimeout(() => {
      if (handleSubmitRef.current) {
        // Create a fake event to pass to handleSubmit
        const fakeEvent = { preventDefault: () => {} };
        handleSubmitRef.current(fakeEvent);
      }
    }, 50);
  }, [setChatMessages, setInput]);

  // Execute a command
  const executeCommand = useCallback(async (command, input) => {
    if (!command || !selectedProject) return;

    try {
      // Parse command and arguments from current input
      const commandMatch = input.match(new RegExp(`${command.name}\\s*(.*)`));
      const args = commandMatch && commandMatch[1]
        ? commandMatch[1].trim().split(/\s+/)
        : [];

      // Prepare context for command execution
      const context = {
        projectPath: selectedProject.path,
        projectName: selectedProject.name,
        sessionId: currentSessionId,
        provider,
        model: provider === 'cursor' ? cursorModel : 'claude-sonnet-4.5',
        tokenUsage: tokenBudget
      };

      // Call the execute endpoint
      const response = await authenticatedFetch('/api/commands/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          commandName: command.name,
          commandPath: command.path,
          args,
          context
        })
      });

      if (!response.ok) {
        throw new Error('Failed to execute command');
      }

      const result = await response.json();

      // Handle built-in commands
      if (result.type === 'builtin') {
        handleBuiltInCommand(result);
      } else if (result.type === 'custom') {
        // Handle custom commands - inject as system message
        await handleCustomCommand(result, args);
      }

      // Clear the input after successful execution
      setInput('');
      resetCommandMenu();

    } catch (error) {
      console.error('Error executing command:', error);
      // Show error message to user
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error executing command: ${error.message}`,
        timestamp: Date.now()
      }]);
    }
  }, [selectedProject, currentSessionId, provider, cursorModel, tokenBudget, handleBuiltInCommand, handleCustomCommand, setInput, resetCommandMenu, setChatMessages]);

  // Set the handleSubmit ref (to be called from parent component)
  const setHandleSubmitRef = useCallback((handleSubmit) => {
    handleSubmitRef.current = handleSubmit;
  }, []);

  return {
    executeCommand,
    handleBuiltInCommand,
    handleCustomCommand,
    setHandleSubmitRef,
    handleSubmitRef
  };
}

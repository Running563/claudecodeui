/**
 * useSlashCommands - Hook for slash command functionality
 * Handles command fetching, filtering, and history tracking
 * Command execution is handled by the parent component due to deep state dependencies
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Fuse from 'fuse.js';
import { authenticatedFetch } from '../../../utils/api';
import { safeLocalStorage } from '../utils';

/**
 * Hook for managing slash commands state and filtering
 * @param {Object} params
 * @param {Object} params.selectedProject - Currently selected project
 */
export function useSlashCommands({ selectedProject }) {
  const [slashCommands, setSlashCommands] = useState([]);
  const [filteredCommands, setFilteredCommands] = useState([]);
  const [commandQuery, setCommandQuery] = useState('');
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(-1);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [slashPosition, setSlashPosition] = useState(-1);
  const commandQueryTimerRef = useRef(null);

  // Track project id to avoid unnecessary refetches
  const projectId = selectedProject?.id;

  // Fetch slash commands on mount and when project id changes
  useEffect(() => {
    const fetchCommands = async () => {
      if (!selectedProject?.path) return;

      try {
        const response = await authenticatedFetch('/api/commands/list', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            projectPath: selectedProject.path
          })
        });

        if (!response.ok) {
          throw new Error('Failed to fetch commands');
        }

        const data = await response.json();

        // Combine built-in and custom commands
        const allCommands = [
          ...(data.builtIn || []).map(cmd => ({ ...cmd, type: 'built-in' })),
          ...(data.custom || []).map(cmd => ({ ...cmd, type: 'custom' }))
        ];

        setSlashCommands(allCommands);

        // Load command history from localStorage
        const historyKey = `command_history_${selectedProject.name}`;
        const history = safeLocalStorage.getItem(historyKey);
        if (history) {
          try {
            const parsedHistory = JSON.parse(history);
            // Sort commands by usage frequency
            const sortedCommands = allCommands.sort((a, b) => {
              const aCount = parsedHistory[a.name] || 0;
              const bCount = parsedHistory[b.name] || 0;
              return bCount - aCount;
            });
            setSlashCommands(sortedCommands);
          } catch (e) {
            console.error('Error parsing command history:', e);
          }
        }
      } catch (error) {
        console.error('Error fetching slash commands:', error);
        setSlashCommands([]);
      }
    };

    fetchCommands();
  }, [projectId]);

  // Create Fuse instance for fuzzy search
  const fuse = useMemo(() => {
    if (!slashCommands.length) return null;

    return new Fuse(slashCommands, {
      keys: [
        { name: 'name', weight: 2 },
        { name: 'description', weight: 1 }
      ],
      threshold: 0.4,
      includeScore: true,
      minMatchCharLength: 1
    });
  }, [slashCommands]);

  // Filter commands based on query
  useEffect(() => {
    if (!commandQuery) {
      setFilteredCommands(slashCommands);
      return;
    }

    if (!fuse) {
      setFilteredCommands([]);
      return;
    }

    const results = fuse.search(commandQuery);
    setFilteredCommands(results.map(result => result.item));
  }, [commandQuery, slashCommands, fuse]);

  // Calculate frequently used commands
  const frequentCommands = useMemo(() => {
    if (!selectedProject || slashCommands.length === 0) return [];

    const historyKey = `command_history_${selectedProject.name}`;
    const history = safeLocalStorage.getItem(historyKey);

    if (!history) return [];

    try {
      const parsedHistory = JSON.parse(history);

      // Sort commands by usage count
      const commandsWithUsage = slashCommands
        .map(cmd => ({
          ...cmd,
          usageCount: parsedHistory[cmd.name] || 0
        }))
        .filter(cmd => cmd.usageCount > 0)
        .sort((a, b) => b.usageCount - a.usageCount)
        .slice(0, 5); // Top 5 most used

      return commandsWithUsage;
    } catch (e) {
      console.error('Error parsing command history:', e);
      return [];
    }
  }, [selectedProject, slashCommands]);

  // Update command history when a command is selected
  const updateCommandHistory = useCallback((command) => {
    if (!command || !selectedProject) return;

    const historyKey = `command_history_${selectedProject.name}`;
    const history = safeLocalStorage.getItem(historyKey);
    let parsedHistory = {};

    try {
      parsedHistory = history ? JSON.parse(history) : {};
    } catch (e) {
      console.error('Error parsing command history:', e);
    }

    parsedHistory[command.name] = (parsedHistory[command.name] || 0) + 1;
    safeLocalStorage.setItem(historyKey, JSON.stringify(parsedHistory));
  }, [selectedProject]);

  // Detect slash command in input
  const detectSlashCommand = useCallback((newValue, cursorPos) => {
    if (!newValue.trim()) {
      setShowCommandMenu(false);
      setSlashPosition(-1);
      setCommandQuery('');
      return;
    }

    const textBeforeCursor = newValue.slice(0, cursorPos);

    // Check if we're in a code block
    const backticksBefore = (textBeforeCursor.match(/```/g) || []).length;
    const inCodeBlock = backticksBefore % 2 === 1;

    if (inCodeBlock) {
      setShowCommandMenu(false);
      setSlashPosition(-1);
      setCommandQuery('');
      return;
    }

    // Find the last slash before cursor that could start a command
    const slashPattern = /(^|\s)\/(\S*)$/;
    const match = textBeforeCursor.match(slashPattern);

    if (match) {
      const slashPos = match.index + match[1].length;
      const query = match[2];

      setSlashPosition(slashPos);
      setShowCommandMenu(true);
      setSelectedCommandIndex(-1);

      // Debounce the command query update
      if (commandQueryTimerRef.current) {
        clearTimeout(commandQueryTimerRef.current);
      }

      commandQueryTimerRef.current = setTimeout(() => {
        setCommandQuery(query);
      }, 150);
    } else {
      setShowCommandMenu(false);
      setSlashPosition(-1);
      setCommandQuery('');

      if (commandQueryTimerRef.current) {
        clearTimeout(commandQueryTimerRef.current);
      }
    }
  }, []);

  // Close command menu
  const closeCommandMenu = useCallback(() => {
    setShowCommandMenu(false);
    setSlashPosition(-1);
    setCommandQuery('');
    setSelectedCommandIndex(-1);
    if (commandQueryTimerRef.current) {
      clearTimeout(commandQueryTimerRef.current);
    }
  }, []);

  // Toggle command menu
  const toggleCommandMenu = useCallback(() => {
    const isOpening = !showCommandMenu;
    setShowCommandMenu(isOpening);
    setCommandQuery('');
    setSelectedCommandIndex(-1);

    if (isOpening) {
      setFilteredCommands(slashCommands);
    }
  }, [showCommandMenu, slashCommands]);

  // Reset command menu state after command execution
  const resetCommandMenu = useCallback(() => {
    setShowCommandMenu(false);
    setSlashPosition(-1);
    setCommandQuery('');
    setSelectedCommandIndex(-1);
  }, []);

  return {
    slashCommands,
    filteredCommands,
    setFilteredCommands,
    commandQuery,
    setCommandQuery,
    selectedCommandIndex,
    setSelectedCommandIndex,
    showCommandMenu,
    setShowCommandMenu,
    slashPosition,
    setSlashPosition,
    frequentCommands,
    updateCommandHistory,
    detectSlashCommand,
    closeCommandMenu,
    toggleCommandMenu,
    resetCommandMenu,
    commandQueryTimerRef
  };
}

export default useSlashCommands;

/**
 * useProviderState - Hook for provider and model state management
 * Handles provider selection, model configuration, and permission modes
 */

import { useState, useEffect } from 'react';
import { authenticatedFetch } from '../../../utils/api';

/**
 * Hook for managing provider and model state
 * @param {Object} params
 * @param {Object} params.selectedSession - Currently selected session
 */
export function useProviderState({ selectedSession }) {
  const [provider, setProvider] = useState(() => {
    return localStorage.getItem('selected-provider') || 'claude';
  });
  
  const [cursorModel, setCursorModel] = useState(() => {
    return localStorage.getItem('cursor-model') || 'gpt-5';
  });
  
  const [codebuddyModel, setCodebuddyModel] = useState(() => {
    return localStorage.getItem('codebuddy-model') || 'default';
  });
  
  const [permissionMode, setPermissionMode] = useState('default');

  // Load permission mode for the current session
  useEffect(() => {
    if (selectedSession?.id) {
      const savedMode = localStorage.getItem(`permissionMode-${selectedSession.id}`);
      if (savedMode) {
        setPermissionMode(savedMode);
      } else {
        setPermissionMode('default');
      }
    }
  }, [selectedSession?.id]);

  // When selecting a session from Sidebar, auto-switch provider to match session's origin
  useEffect(() => {
    if (selectedSession && selectedSession.__provider && selectedSession.__provider !== provider) {
      setProvider(selectedSession.__provider);
      localStorage.setItem('selected-provider', selectedSession.__provider);
    }
  }, [selectedSession, provider]);

  // Load Cursor default model from config
  useEffect(() => {
    if (provider === 'cursor') {
      authenticatedFetch('/api/cursor/config')
        .then(res => res.json())
        .then(data => {
          if (data.success && data.config?.model?.modelId) {
            const modelMap = {
              'gpt-5': 'gpt-5',
              'claude-4-sonnet': 'sonnet-4',
              'sonnet-4': 'sonnet-4',
              'claude-4-opus': 'opus-4.1',
              'opus-4.1': 'opus-4.1'
            };
            const mappedModel = modelMap[data.config.model.modelId] || data.config.model.modelId;
            if (!localStorage.getItem('cursor-model')) {
              setCursorModel(mappedModel);
            }
          }
        })
        .catch(err => console.error('Error loading Cursor config:', err));
    }
  }, [provider]);

  // Switch permission mode
  const switchPermissionMode = (newMode) => {
    setPermissionMode(newMode);
    if (selectedSession?.id) {
      localStorage.setItem(`permissionMode-${selectedSession.id}`, newMode);
    }
  };

  // Cycle through permission modes
  const cyclePermissionMode = () => {
    const modes = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
    const currentIndex = modes.indexOf(permissionMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    switchPermissionMode(modes[nextIndex]);
  };

  // Update provider and save to localStorage
  const updateProvider = (newProvider) => {
    setProvider(newProvider);
    localStorage.setItem('selected-provider', newProvider);
  };

  // Update cursor model and save to localStorage
  const updateCursorModel = (newModel) => {
    setCursorModel(newModel);
    localStorage.setItem('cursor-model', newModel);
  };

  // Update codebuddy model and save to localStorage
  const updateCodebuddyModel = (newModel) => {
    setCodebuddyModel(newModel);
    localStorage.setItem('codebuddy-model', newModel);
  };

  return {
    provider,
    setProvider: updateProvider,
    cursorModel,
    setCursorModel: updateCursorModel,
    codebuddyModel,
    setCodebuddyModel: updateCodebuddyModel,
    permissionMode,
    setPermissionMode: switchPermissionMode,
    cyclePermissionMode
  };
}

export default useProviderState;

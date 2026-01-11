import { useEffect, useRef } from 'react';

// Global flag to prevent popstate handler from firing when we programmatically go back
let isGoingBack = false;

// Global flag to skip history.back() when closing - set this before closing a modal
// when you're about to navigate to a new URL
let skipHistoryBack = false;

/**
 * Skip the next history.back() call when a modal closes
 * Call this before closing a modal when you're about to navigate to a new URL
 */
export function skipNextHistoryBack() {
  skipHistoryBack = true;
  // Reset after a tick in case it's not consumed
  setTimeout(() => { skipHistoryBack = false; }, 100);
}


/**
 * Hook to close modal/dialog when browser back button is pressed (especially useful on mobile)
 * Uses history.pushState to add a state entry when modal opens, and listens for popstate to close
 * 
 * @param {boolean} isOpen - Whether the modal is open
 * @param {function} onClose - Function to call when modal should close
 * @param {string} [id] - Optional unique identifier for this modal (defaults to random id)
 */
export function useBackClose(isOpen, onClose, id) {
  const modalId = useRef(id || `modal-${Math.random().toString(36).slice(2, 9)}`);
  const pushedState = useRef(false);

  // Stable callback ref
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) {
      // When modal closes via UI (not back button), clean up the history state
      if (pushedState.current) {
        pushedState.current = false;
        // Skip history.back() if we're about to navigate (e.g., selecting a session)
        if (skipHistoryBack) {
          skipHistoryBack = false;
          return;
        }
        isGoingBack = true;
        window.history.back();
        // Reset flag after a tick
        setTimeout(() => { isGoingBack = false; }, 0);
      }
      return;
    }

    // Modal is opening - push a new history state
    const state = { __modalId: modalId.current };
    window.history.pushState(state, '');
    pushedState.current = true;

    const handlePopState = () => {
      // Ignore if we triggered this programmatically
      if (isGoingBack) return;
      
      // User pressed back button
      if (pushedState.current) {
        pushedState.current = false;
        onCloseRef.current();
      }
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isOpen]);
}

export default useBackClose;

// Cached audio context for notification sound
let cachedAudioContext = null;

/**
 * Get or create the audio context
 */
function getAudioContext() {
  if (cachedAudioContext && cachedAudioContext.state !== 'closed') {
    return cachedAudioContext;
  }
  
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      console.log('Web Audio API not supported');
      return null;
    }
    cachedAudioContext = new AudioContext();
    return cachedAudioContext;
  } catch (e) {
    console.log('Failed to create audio context:', e);
    return null;
  }
}

/**
 * Play a pleasant chime notification sound
 * Uses a soft, musical three-note chime (C-E-G major chord arpeggio)
 */
export function playNotificationSound() {
  try {
    const audioContext = getAudioContext();
    if (!audioContext) return;
    
    // Resume context if suspended (required by browsers)
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    
    const now = audioContext.currentTime;
    
    // Musical notes: C5, E5, G5 (major chord arpeggio) - pleasant and harmonious
    const notes = [
      { freq: 523.25, start: 0, duration: 0.15 },      // C5
      { freq: 659.25, start: 0.12, duration: 0.15 },   // E5
      { freq: 783.99, start: 0.24, duration: 0.25 },   // G5 (longer, final note)
    ];
    
    notes.forEach(({ freq, start, duration }) => {
      // Oscillator for the tone
      const oscillator = audioContext.createOscillator();
      oscillator.type = 'sine'; // Soft, pure tone
      oscillator.frequency.value = freq;
      
      // Gain node for envelope (attack/decay)
      const gainNode = audioContext.createGain();
      gainNode.gain.setValueAtTime(0, now + start);
      gainNode.gain.linearRampToValueAtTime(0.3, now + start + 0.02); // Quick attack
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + start + duration); // Smooth decay
      
      // Add slight reverb effect with a second, quieter oscillator
      const reverbOsc = audioContext.createOscillator();
      reverbOsc.type = 'sine';
      reverbOsc.frequency.value = freq * 2; // Octave higher, very quiet
      
      const reverbGain = audioContext.createGain();
      reverbGain.gain.setValueAtTime(0, now + start);
      reverbGain.gain.linearRampToValueAtTime(0.05, now + start + 0.02);
      reverbGain.gain.exponentialRampToValueAtTime(0.01, now + start + duration * 0.8);
      
      // Connect and play
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      reverbOsc.connect(reverbGain);
      reverbGain.connect(audioContext.destination);
      
      oscillator.start(now + start);
      oscillator.stop(now + start + duration + 0.1);
      reverbOsc.start(now + start);
      reverbOsc.stop(now + start + duration + 0.1);
    });
  } catch (e) {
    console.log('Audio play failed:', e);
  }
}

/**
 * Trigger vibration
 */
export function triggerVibration() {
  try {
    // Check for NativeApp bridge (Android WebView)
    if (window.NativeApp && typeof window.NativeApp.hasVibrator === 'function' && window.NativeApp.hasVibrator()) {
      // Pattern: short-pause-short vibration
      window.NativeApp.vibratePattern('[0, 100, 50, 100]');
    } else if (navigator.vibrate) {
      // Fallback to Web Vibration API
      navigator.vibrate([100, 50, 100]);
    }
  } catch (e) {
    console.log('Vibration failed:', e);
  }
}

/**
 * Trigger session completion notification (sound and/or vibration)
 * @param {string} mode - 'none', 'sound', 'vibrate', 'both'
 */
export function triggerCompletionNotification(mode) {
  if (!mode || mode === 'none') return;
  
  // Play sound
  if (mode === 'sound' || mode === 'both') {
    playNotificationSound();
  }
  
  // Trigger vibration
  if (mode === 'vibrate' || mode === 'both') {
    triggerVibration();
  }
}

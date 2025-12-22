/**
 * Calculate diff between two strings
 * Returns an array of diff lines with type ('added' or 'removed') and content
 * 
 * @param {string} oldStr - Original string
 * @param {string} newStr - New string
 * @returns {Array<{type: 'added'|'removed', content: string, lineNum: number}>}
 */
export const calculateDiff = (oldStr, newStr) => {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  
  // Simple diff algorithm - find common lines and differences
  const diffLines = [];
  let oldIndex = 0;
  let newIndex = 0;
  
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    const oldLine = oldLines[oldIndex];
    const newLine = newLines[newIndex];
    
    if (oldIndex >= oldLines.length) {
      // Only new lines remaining
      diffLines.push({ type: 'added', content: newLine, lineNum: newIndex + 1 });
      newIndex++;
    } else if (newIndex >= newLines.length) {
      // Only old lines remaining
      diffLines.push({ type: 'removed', content: oldLine, lineNum: oldIndex + 1 });
      oldIndex++;
    } else if (oldLine === newLine) {
      // Lines are the same - skip in diff view (or show as context)
      oldIndex++;
      newIndex++;
    } else {
      // Lines are different
      diffLines.push({ type: 'removed', content: oldLine, lineNum: oldIndex + 1 });
      diffLines.push({ type: 'added', content: newLine, lineNum: newIndex + 1 });
      oldIndex++;
      newIndex++;
    }
  }
  
  return diffLines;
};

/**
 * Create a memoized diff calculator with LRU cache
 * @param {number} maxCacheSize - Maximum number of cached results
 * @returns {function} Memoized diff function
 */
export const createMemoizedDiff = (maxCacheSize = 100) => {
  const cache = new Map();
  
  return (oldStr, newStr) => {
    const key = `${oldStr.length}-${newStr.length}-${oldStr.slice(0, 50)}`;
    if (cache.has(key)) {
      return cache.get(key);
    }
    
    const result = calculateDiff(oldStr, newStr);
    cache.set(key, result);
    
    // LRU eviction
    if (cache.size > maxCacheSize) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
    
    return result;
  };
};

export default calculateDiff;

/**
 * Image Utilities
 * 
 * Functions for handling image content extraction and detection.
 */

/**
 * Extracts base64 image data from tool result content
 * Handles both array format and string format
 * Supports both Claude and CodeBuddy formats
 * @param {any} content - Tool result content (can be array, string, or object)
 * @returns {string|null} - Base64 data URL or null if no image found
 */
export const extractBase64FromContent = (content) => {
  // Parse JSON string if needed
  if (typeof content === 'string') {
    try {
      if (content.startsWith('[') || content.startsWith('{')) {
        content = JSON.parse(content);
      }
    } catch (e) {
      // Not valid JSON, check if it's already a data URL
      const match = content.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/);
      return match ? match[0] : null;
    }
  }
  
  // Check if content is array with image object
  if (Array.isArray(content)) {
    // Claude format: { type: 'image', source: { type: 'base64', media_type: '...', data: '...' } }
    const imageItem = content.find(item => item?.type === 'image');
    if (imageItem?.source?.type === 'base64') {
      const mediaType = imageItem.source.media_type || 'image/png';
      return `data:${mediaType};base64,${imageItem.source.data}`;
    }
    
    // CodeBuddy format: { type: 'image_url', image_url: { url: 'data:image/png;base64,...' } }
    const imageUrlItem = content.find(item => item?.type === 'image_url');
    if (imageUrlItem?.image_url?.url) {
      return imageUrlItem.image_url.url;
    }
  }
  
  return null;
};

/**
 * Checks if tool result content contains image data
 * @param {any} content - Tool result content
 * @returns {boolean}
 */
export const hasImageContent = (content) => {
  return Array.isArray(content) && content.some(item => item?.type === 'image');
};

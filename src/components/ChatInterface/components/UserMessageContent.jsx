/**
 * UserMessageContent Component
 * 
 * Renders user message content with image path detection and display.
 */

import React, { useState, useEffect, memo } from 'react';
import { authenticatedFetch } from '../../../utils/api';

/**
 * Component to render user message content with image path detection
 * Handles both newly uploaded images and images from chat history
 */
const UserMessageContent = memo(({ message, selectedProject }) => {
  const [imagePaths, setImagePaths] = useState([]);
  const [displayContent, setDisplayContent] = useState(message.content);
  const [imageBlobs, setImageBlobs] = useState({});

  useEffect(() => {
    // Parse image paths from content like:
    // "[Images provided at the following paths:]\n1. /path/to/image.png"
    // Format from claude-sdk.js: `\n\n[Images provided at the following paths:]\n${paths.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
    const content = message.content || '';
    
    // Match the entire image section - more flexible regex
    // Supports with or without leading newlines
    const imagePathRegex = /\s*\[Images provided at the following paths:\]\s*([\s\S]*?)$/;
    const match = content.match(imagePathRegex);
    
    if (match) {
      // Extract paths from format "1. /path/to/image.png"
      const pathsText = match[1];
      // Find all absolute paths in the text
      const pathMatches = pathsText.match(/\/[^\s\n]+/g) || [];
      const paths = pathMatches.filter(p => p.includes('.tmp/images/'));
      
      setImagePaths(paths);
      // Remove the image paths section from display content
      setDisplayContent(content.replace(match[0], '').trim());
    } else {
      setImagePaths([]);
      setDisplayContent(content);
    }
  }, [message.content]);

  // Fetch images with authentication and create blob URLs
  useEffect(() => {
    if (imagePaths.length === 0) return;

    const loadImages = async () => {
      const blobs = {};
      for (const imagePath of imagePaths) {
        try {
          const response = await authenticatedFetch(`/api/temp-image?path=${encodeURIComponent(imagePath)}`);
          if (response.ok) {
            const blob = await response.blob();
            blobs[imagePath] = URL.createObjectURL(blob);
          }
        } catch (error) {
          // Silently ignore image loading errors
        }
      }
      setImageBlobs(blobs);
    };

    loadImages();

    // Cleanup blob URLs on unmount
    return () => {
      Object.values(imageBlobs).forEach(url => URL.revokeObjectURL(url));
    };
  }, [imagePaths]);

  // Build image URLs for paths (use temp-image API for .tmp/images paths)
  const getImageUrl = (imagePath) => {
    return imageBlobs[imagePath] || '';
  };

  return (
    <>
      <div className="text-sm whitespace-pre-wrap break-words">
        {displayContent}
      </div>
      {/* Show images from message.images (newly uploaded) */}
      {message.images && message.images.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {message.images.map((img, idx) => (
            <img
              key={idx}
              src={img.data}
              alt={img.name}
              className="rounded-lg max-w-full h-auto cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => window.open(img.data, '_blank')}
            />
          ))}
        </div>
      )}
      {/* Show images from parsed paths (from history) */}
      {imagePaths.length > 0 && !message.images?.length && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {imagePaths.map((imagePath, idx) => {
            const blobUrl = imageBlobs[imagePath];
            // Only render if blob URL is ready
            if (!blobUrl) return null;
            
            return (
              <img
                key={idx}
                src={blobUrl}
                alt={`Image ${idx + 1}`}
                className="rounded-lg max-w-full h-auto cursor-pointer hover:opacity-90 transition-opacity bg-blue-500/20"
                onClick={() => window.open(blobUrl, '_blank')}
              />
            );
          })}
        </div>
      )}
    </>
  );
});

UserMessageContent.displayName = 'UserMessageContent';

export default UserMessageContent;

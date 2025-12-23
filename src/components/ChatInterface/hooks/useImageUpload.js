/**
 * useImageUpload - Hook for image upload functionality
 * Handles image validation, drag & drop, clipboard paste, and upload state
 */

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';

/**
 * Hook for managing image uploads
 * @param {Object} params
 * @param {number} params.maxFiles - Maximum number of files allowed (default: 5)
 * @param {number} params.maxSize - Maximum file size in bytes (default: 5MB)
 */
export function useImageUpload({ maxFiles = 5, maxSize = 5 * 1024 * 1024 } = {}) {
  const [attachedImages, setAttachedImages] = useState([]);
  const [uploadingImages, setUploadingImages] = useState(new Map());
  const [imageErrors, setImageErrors] = useState(new Map());

  // Handle image files from drag & drop or file picker
  const handleImageFiles = useCallback((files) => {
    const validFiles = files.filter(file => {
      try {
        if (!file || typeof file !== 'object') {
          console.warn('Invalid file object:', file);
          return false;
        }

        if (!file.type || !file.type.startsWith('image/')) {
          return false;
        }

        if (!file.size || file.size > maxSize) {
          const fileName = file.name || 'Unknown file';
          setImageErrors(prev => {
            const newMap = new Map(prev);
            newMap.set(fileName, 'File too large (max 5MB)');
            return newMap;
          });
          return false;
        }

        return true;
      } catch (error) {
        console.error('Error validating file:', error, file);
        return false;
      }
    });

    if (validFiles.length > 0) {
      setAttachedImages(prev => [...prev, ...validFiles].slice(0, maxFiles));
    }
  }, [maxFiles, maxSize]);

  // Handle clipboard paste for images
  const handlePaste = useCallback((e) => {
    const items = Array.from(e.clipboardData.items);
    
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          handleImageFiles([file]);
        }
      }
    }
    
    // Fallback for some browsers/platforms
    if (items.length === 0 && e.clipboardData.files.length > 0) {
      const files = Array.from(e.clipboardData.files);
      const imageFiles = files.filter(f => f.type.startsWith('image/'));
      if (imageFiles.length > 0) {
        handleImageFiles(imageFiles);
      }
    }
  }, [handleImageFiles]);

  // Remove an image
  const removeImage = useCallback((index) => {
    setAttachedImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Clear all images
  const clearImages = useCallback(() => {
    setAttachedImages([]);
    setUploadingImages(new Map());
    setImageErrors(new Map());
  }, []);

  // Setup dropzone
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']
    },
    maxSize,
    maxFiles,
    onDrop: handleImageFiles,
    noClick: true,
    noKeyboard: true
  });

  return {
    attachedImages,
    setAttachedImages,
    uploadingImages,
    setUploadingImages,
    imageErrors,
    setImageErrors,
    handleImageFiles,
    handlePaste,
    removeImage,
    clearImages,
    getRootProps,
    getInputProps,
    isDragActive,
    openFilePicker: open
  };
}

export default useImageUpload;

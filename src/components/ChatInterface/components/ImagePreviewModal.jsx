import React from 'react';
import { useBackClose } from '../../../hooks/useBackClose';

/**
 * ImagePreviewModal - Modal for displaying full-size image preview
 * 
 * @param {Object} imagePreview - Image data with url and filename
 * @param {Function} onClose - Callback to close the modal
 */
const ImagePreviewModal = ({ imagePreview, onClose }) => {
  // Support closing via browser back button (especially useful on mobile)
  useBackClose(!!imagePreview, onClose, 'image-preview');

  if (!imagePreview) return null;

  const handleClose = () => {
    // Only revoke blob URLs, not data URLs
    if (imagePreview.url.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreview.url);
    }
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div className="relative max-w-[90vw] max-h-[90vh] flex flex-col">
        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleClose();
          }}
          className="absolute -top-10 right-0 text-white hover:text-gray-300 transition-colors"
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        
        {/* Filename */}
        <div className="text-white text-sm mb-2 text-center">{imagePreview.filename}</div>
        
        {/* Image */}
        <img
          src={imagePreview.url}
          alt={imagePreview.filename}
          className="max-w-full max-h-[80vh] object-contain rounded-lg"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
};

export default React.memo(ImagePreviewModal);

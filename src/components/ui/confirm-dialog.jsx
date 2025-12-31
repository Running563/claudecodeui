import React from 'react';
import { X } from 'lucide-react';
import { Button } from './button';
import { cn } from '../../lib/utils';

/**
 * Reusable confirmation dialog component
 * 
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether the dialog is visible
 * @param {Function} props.onClose - Callback when dialog is closed/cancelled
 * @param {Function} props.onConfirm - Callback when confirmed
 * @param {string} props.title - Dialog title
 * @param {string} props.message - Dialog message/description
 * @param {string} props.confirmText - Text for confirm button (default: "确认")
 * @param {string} props.cancelText - Text for cancel button (default: "取消")
 * @param {string} props.variant - Button variant: "default" | "destructive" (default: "destructive")
 * @param {boolean} props.loading - Whether confirm action is in progress
 */
function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title = '确认操作',
  message = '确定要执行此操作吗？',
  confirmText = '确认',
  cancelText = '取消',
  variant = 'destructive',
  loading = false
}) {
  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && !loading) {
      onClose();
    }
  };

  const handleConfirm = () => {
    if (!loading) {
      onConfirm();
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-sm animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">
            {title}
          </h3>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            aria-label="关闭"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-4">
          <p className="text-sm text-muted-foreground">
            {message}
          </p>
        </div>
        
        {/* Actions */}
        <div className="flex items-center justify-end gap-2 p-4 pt-0">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={loading}
          >
            {cancelText}
          </Button>
          <Button
            variant={variant}
            size="sm"
            onClick={handleConfirm}
            disabled={loading}
            className={cn(
              variant === 'destructive' && 'bg-red-600 hover:bg-red-700 text-white'
            )}
          >
            {loading ? (
              <div className="w-4 h-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              confirmText
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export { ConfirmDialog };

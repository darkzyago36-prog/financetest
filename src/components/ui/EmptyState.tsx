import React from 'react';
import { Icon } from '../Icon';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondaryAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon = 'receipt_long',
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondaryAction,
}) => {
  return (
    <div className="bg-surface-container-lowest rounded-xl p-8 text-center space-y-3 border border-surface-container/60">
      <div className="w-14 h-14 mx-auto rounded-full bg-surface-container-low text-primary flex items-center justify-center">
        <Icon name={icon} className="text-2xl" />
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-bold text-on-surface">{title}</h3>
        <p className="text-xs text-secondary max-w-md mx-auto leading-relaxed">{description}</p>
      </div>
      {(actionLabel || secondaryLabel) && (
        <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
            >
              {actionLabel}
            </button>
          )}
          {secondaryLabel && onSecondaryAction && (
            <button
              type="button"
              onClick={onSecondaryAction}
              className="px-4 py-2 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
            >
              {secondaryLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

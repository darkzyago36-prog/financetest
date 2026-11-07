import React, { useState } from 'react';
import { BRAND_LOGO_URL } from '../data/initialData';

interface IconProps {
  name: string;
  className?: string;
  filled?: boolean;
  title?: string;
}

export const Icon: React.FC<IconProps> = ({ name, className = 'text-xl', filled = false, title }) => {
  return (
    <span
      className={`material-symbols-outlined ${filled ? 'material-filled' : ''} ${className}`}
      title={title}
      aria-hidden="true"
    >
      {name}
    </span>
  );
};

interface BrandLogoProps {
  compact?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ compact = false }) => {
  const [imgError, setImgError] = useState(false);

  if (compact || imgError) {
    return (
      <div className="w-8 h-8 rounded-xl bg-primary-container flex items-center justify-center text-on-primary shrink-0 shadow-xs">
        <Icon name="account_balance_wallet" className="text-[19px]" />
      </div>
    );
  }

  return (
    <img
      src={BRAND_LOGO_URL}
      alt="FinanCerto Logo"
      referrerPolicy="no-referrer"
      onError={() => setImgError(true)}
      className="h-8 w-auto object-contain shrink-0"
    />
  );
};

interface SafeAvatarProps {
  src: string;
  name: string;
  className?: string;
}

export const SafeAvatar: React.FC<SafeAvatarProps> = ({ src, name, className = 'w-8 h-8' }) => {
  const [failed, setFailed] = useState(false);

  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  if (!src || failed) {
    return (
      <div
        className={`${className} rounded-full bg-primary-container text-on-primary font-bold flex items-center justify-center shrink-0 select-none`}
      >
        {initials || 'FC'}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${className} rounded-full object-cover shrink-0 bg-surface-container`}
    />
  );
};

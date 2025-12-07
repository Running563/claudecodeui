import React from 'react';

const CodeBuddyLogo = ({ size = 24, className = '' }) => {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* CodeBuddy Logo - Tencent style with code brackets */}
      <circle cx="12" cy="12" r="10" fill="#00A870" opacity="0.1"/>
      <path 
        d="M8 8L4 12L8 16M16 8L20 12L16 16M14 6L10 18" 
        stroke="#00A870" 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
    </svg>
  );
};

export default CodeBuddyLogo;

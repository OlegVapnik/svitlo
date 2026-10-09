import * as React from 'react';

// Simplified Tabs implementation for brevity
export const Tabs = ({ children, defaultValue, className }: any) => {
  const [active, setActive] = React.useState(defaultValue);
  return (
    <div className={className}>
      {React.Children.map(children, child => 
        React.cloneElement(child, { active, setActive })
      )}
    </div>
  );
};

export const TabsList = ({ children, active, setActive, className }: any) => (
  <div className={className || 'flex space-x-2 border-b mb-4'}>
    {React.Children.map(children, child => 
      React.cloneElement(child, { active, setActive })
    )}
  </div>
);

export const TabsTrigger = ({ children, value, active, setActive, className }: any) => (
  <button
    className={`px-4 py-2 ${active === value ? 'border-b-2 border-primary font-bold' : ''} ${className || ''}`}
    onClick={() => setActive(value)}
  >
    {children}
  </button>
);

export const TabsContent = ({ children, value, active, className }: any) => {
  if (value !== active) return null;
  return <div className={className}>{children}</div>;
};
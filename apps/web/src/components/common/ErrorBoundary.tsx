import React from 'react';
export class ErrorBoundary extends React.Component<any, { hasError: boolean }> {
  constructor(props: any) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  override render() {
    if (this.state.hasError) return <div><h1>Something went wrong.</h1><button onClick={() => window.location.reload()}>Retry</button></div>;
    return this.props['children'];
  }
}
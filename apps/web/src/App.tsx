import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { RegionProvider } from './context/RegionContext.js';
import { queryClient } from './api/query-client.js';
import { router } from './router';
import './i18n/config';

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RegionProvider>
          <RouterProvider router={router} />
        </RegionProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { RegionProvider } from './context/RegionContext.js';
import { router } from './router';
import './i18n/config';

const queryClient = new QueryClient();

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
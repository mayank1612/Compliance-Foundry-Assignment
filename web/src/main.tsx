/**
 * main.tsx — entry point: one Apollo Client for the app's lifetime, the session
 * (who we're acting as), then the app. StrictMode double-invokes effects in
 * development to surface missing cleanups.
 */
import { ApolloProvider } from '@apollo/client/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createApolloClient } from './apollo/client';
import { App } from './App';
import './index.css';
import { SessionProvider } from './session/SessionProvider';

const container = document.getElementById('root');
if (!container) throw new Error('index.html is missing <div id="root">');

createRoot(container).render(
  <StrictMode>
    <ApolloProvider client={createApolloClient()}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </ApolloProvider>
  </StrictMode>,
);

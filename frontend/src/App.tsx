import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from './components/layout/AppLayout';
import HomePage from './pages/HomePage';
import VideoPage from './pages/VideoPage';
import ChatPage from './pages/ChatPage';
import QuizPage from './pages/QuizPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<HomePage />} />
            <Route path="video/:videoId" element={<VideoPage />} />
            <Route path="video/:videoId/chat" element={<ChatPage />} />
            <Route path="video/:videoId/quiz" element={<QuizPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

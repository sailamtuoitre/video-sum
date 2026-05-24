import axios from 'axios';
import type {
  Video,
  Summary,
  ChatSession,
  ChatMessage,
  AskResponse,
  Quiz,
  CheckAnswerResult,
  QuizOption,
  Project,
  ProjectWithVideos,
} from '../types';

const client = axios.create({
  baseURL: '/',
  timeout: 120000,
});

client.interceptors.response.use(
  (res) => res,
  (error) => {
    const method = error.config?.method?.toUpperCase?.() ?? 'UNKNOWN';
    const url = error.config?.url ?? 'unknown-url';
    const message =
      error.response?.data?.message || error.message || 'Unknown error';

    console.error(`API Error: ${method} ${url}`, message);
    return Promise.reject(error);
  },
);

export const api = {
  // Videos
  createVideo: (url: string) =>
    client.post<{ video: Video }>('/videos', { url }).then((r) => r.data.video),

  getVideos: () =>
    client.get<Video[]>('/videos').then((r) => r.data),

  getVideo: (id: string) =>
    client.get<Video>(`/videos/${id}`).then((r) => r.data),

  deleteVideo: (id: string) =>
    client.delete(`/videos/${id}`).then((r) => r.data),

  // Summaries
  getSummary: (videoId: string) =>
    client.get<Summary[]>('/summaries', { params: { videoId } }).then((r) => {
      const data = r.data;
      return Array.isArray(data) ? data[0] ?? null : data;
    }),

  generateSummary: (videoId: string) =>
    client.post<Summary>(`/summaries/from-video/${videoId}`).then((r) => r.data),

  // Chat Sessions
  createSession: (videoId: string) =>
    client.post<ChatSession>('/chat-sessions', { videoId, title: 'New Chat' }).then((r) => r.data),

  getSessions: (videoId: string) =>
    client.get<ChatSession[]>('/chat-sessions', { params: { videoId } }).then((r) => r.data),

  // Chat Messages
  getMessages: (sessionId: string) =>
    client.get<ChatMessage[]>('/chat-messages', { params: { sessionId } }).then((r) => r.data),

  ask: (sessionId: string, content: string) =>
    client.post<AskResponse>('/chat-messages/ask', { sessionId, content }).then((r) => r.data),

  // Quizzes
  generateQuiz: (videoId: string) =>
    client.post<Quiz>(`/quizzes/from-video/${videoId}`).then((r) => r.data),

  getQuiz: (videoId: string) =>
    client.get<Quiz[]>('/quizzes', { params: { videoId } }).then((r) => {
      const data = r.data;
      return Array.isArray(data) ? data[0] ?? null : data;
    }),

  // Quiz Questions
  checkAnswer: (questionId: string, selectedOption: QuizOption) =>
    client.post<CheckAnswerResult>(`/quiz-questions/${questionId}/check-answer`, {
      selectedOption,
    }).then((r) => r.data),

  // Projects
  getProjects: () =>
    client.get<Project[]>('/projects').then((r) => r.data),

  getProject: (id: string) =>
    client.get<ProjectWithVideos>(`/projects/${id}`).then((r) => r.data),

  // Chunks
  getChunks: (videoId: string) =>
    client.get<unknown[]>('/chunks', { params: { videoId } }).then((r) => r.data),
};

export type VideoStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type MessageRole = 'user' | 'assistant';
export type QuizOption = 'A' | 'B' | 'C' | 'D';
export type CheckResult = 'correct' | 'incorrect';
export type RetrievedSource = 'chunk' | 'memory';

export interface Video {
  id: string;
  youtubeId: string;
  url: string;
  title: string | null;
  status: VideoStatus;
  language: string;
  durationSec: number | null;
  errorMessage: string | null;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Summary {
  id: string;
  videoId: string;
  keyPoints: string[];
  simplifiedText: string;
  mainTopics: string[];
  modelUsed: string;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  videoId: string | null;
  projectId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  retrievedChunks: RetrievedContext[] | null;
  promptTokens: number | null;
  completionTokens: number | null;
  createdAt: string;
}

export interface RetrievedContext {
  citationId: string;
  source: RetrievedSource;
  chunkId?: string;
  chunkIndex?: number;
  score: number;
  cosineScore: number;
  keywordScore: number;
  content: string;
  tokenCount?: number;
  startChar?: number | null;
  endChar?: number | null;
  memoryId?: string;
  sessionId?: string;
  projectId?: string | null;
  videoId?: string | null;
  turnIndex?: number;
  question?: string;
  answer?: string;
}

export interface AskResponse {
  sessionId: string;
  videoId: string | null;
  projectId: string | null;
  question: string;
  answer: string;
  modelUsed: string;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  retrievedChunks: RetrievedContext[];
}

export interface Quiz {
  id: string;
  videoId: string;
  title: string | null;
  totalQuestions: number;
  modelUsed: string | null;
  questions: QuizQuestion[];
  createdAt: string;
}

export interface QuizQuestion {
  id: string;
  quizId: string;
  questionText: string;
  options: Record<QuizOption, string>;
  correctOption: QuizOption;
  explanation: string | null;
  questionIndex: number;
  sourceChunkId: string | null;
}

export interface CheckAnswerResult {
  questionId: string;
  questionText: string;
  selectedOption: QuizOption;
  selectedAnswerText: string | null;
  correctOption: QuizOption;
  correctAnswerText: string | null;
  isCorrect: boolean;
  result: CheckResult;
  feedback: string;
  explanation: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectWithVideos extends Project {
  videos: Video[];
}

export interface Chunk {
  id: string;
  videoId: string;
  transcriptId: string;
  content: string;
  chunkIndex: number;
  tokenCount: number;
  startChar: number;
  endChar: number;
}

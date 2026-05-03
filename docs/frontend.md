# Frontend Architecture
## AI Video Learning Assistant

**Version:** 1.0.0  
**Date:** 2026-05-03  
**Framework:** React.js + TypeScript + Vite  

---

## Table of Contents

1. [Overview](#1-overview)
2. [Project Structure](#2-project-structure)
3. [Pages & Routing](#3-pages--routing)
4. [Component Tree](#4-component-tree)
5. [State Management](#5-state-management)
6. [API Integration](#6-api-integration)
7. [Feature UI Flows](#7-feature-ui-flows)
8. [Styling & Design System](#8-styling--design-system)
9. [Error Handling & Loading States](#9-error-handling--loading-states)

---

## 1. Overview

The frontend is a **React SPA** served by Vite on port `3000`. It communicates with the NestJS backend over REST. No SSR required — all rendering is client-side.

### Technology Stack

| Library | Version | Purpose |
|---|---|---|
| React | 18.x | UI framework |
| TypeScript | 5.x | Type safety |
| Vite | 5.x | Dev server + build |
| React Router | 6.x | Client-side routing |
| TanStack Query | 5.x | Server state, caching, loading |
| Zustand | 4.x | Global client state |
| Axios | 1.x | HTTP client |
| Tailwind CSS | 3.x | Utility-first styling |
| shadcn/ui | latest | Pre-built accessible components |
| Lucide React | latest | Icon set |

---

## 2. Project Structure

```
frontend/
├── public/
├── src/
│   ├── main.tsx                    ← App entry point
│   ├── App.tsx                     ← Router setup
│   │
│   ├── pages/
│   │   ├── HomePage.tsx            ← URL input + processed video list
│   │   ├── VideoPage.tsx           ← Learning hub per video
│   │   ├── ChatPage.tsx            ← RAG chatbot
│   │   ├── QuizPage.tsx            ← Quiz taking
│   │   └── FlashcardPage.tsx       ← Flashcard review
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx       ← Shell: sidebar + header + outlet
│   │   │   ├── Sidebar.tsx         ← Video history navigation
│   │   │   └── Header.tsx
│   │   │
│   │   ├── video/
│   │   │   ├── VideoInputForm.tsx  ← URL input form + submit
│   │   │   ├── VideoCard.tsx       ← Processed video list item
│   │   │   ├── ProcessingStatus.tsx ← Real-time status badge
│   │   │   └── SummaryCard.tsx     ← Key points + simplified text
│   │   │
│   │   ├── chat/
│   │   │   ├── ChatWindow.tsx      ← Message list + scroll
│   │   │   ├── MessageBubble.tsx   ← User / assistant message
│   │   │   ├── ChatInput.tsx       ← Text input + send button
│   │   │   └── SourceChips.tsx     ← Retrieved chunk references
│   │   │
│   │   ├── quiz/
│   │   │   ├── QuizContainer.tsx   ← Quiz orchestrator
│   │   │   ├── QuestionCard.tsx    ← Single MCQ card
│   │   │   ├── OptionButton.tsx    ← A/B/C/D option
│   │   │   └── QuizResult.tsx      ← Score summary
│   │   │
│   │   └── flashcard/
│   │       ├── FlashcardViewer.tsx ← Card navigation
│   │       ├── FlipCard.tsx        ← 3D flip animation
│   │       └── CardProgress.tsx    ← Current / total indicator
│   │
│   ├── hooks/
│   │   ├── useVideoProcessing.ts   ← Poll video status until complete
│   │   ├── useChat.ts              ← Send message, receive response
│   │   ├── useQuiz.ts              ← Quiz state machine
│   │   └── useFlashcard.ts         ← Card navigation state
│   │
│   ├── services/
│   │   └── api.ts                  ← All Axios API calls (typed)
│   │
│   ├── store/
│   │   └── useAppStore.ts          ← Zustand store
│   │
│   ├── types/
│   │   └── index.ts                ← Shared TypeScript types
│   │
│   └── lib/
│       └── utils.ts                ← cn(), formatters, etc.
│
├── index.html
├── vite.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

---

## 3. Pages & Routing

### Route Table

```tsx
// App.tsx
<Routes>
  <Route path="/" element={<AppLayout />}>
    <Route index element={<HomePage />} />
    <Route path="video/:videoId" element={<VideoPage />} />
    <Route path="video/:videoId/chat" element={<ChatPage />} />
    <Route path="video/:videoId/quiz" element={<QuizPage />} />
    <Route path="video/:videoId/flashcards" element={<FlashcardPage />} />
  </Route>
</Routes>
```

### Page Responsibilities

#### `HomePage`
- URL input form (validates YouTube URL format)
- POST to `/api/videos`, navigate to `/video/:id`
- List of all previously processed videos
- Status badges: `pending` | `processing` | `completed` | `failed`

#### `VideoPage`
- Displays video title, summary
- Navigation cards to Chat / Quiz / Flashcards
- Re-process button if `failed`

#### `ChatPage`
- Full-screen chat interface
- Auto-scrolls to latest message
- Shows source chunk references per AI reply
- "Thông tin này không có trong video" fallback display

#### `QuizPage`
- Generate quiz button (if not generated)
- One question at a time; progress bar
- Correct/incorrect feedback after each answer
- Final score screen with review option

#### `FlashcardPage`
- Generate flashcards button (if not generated)
- Flip card animation (CSS 3D transform)
- Previous / Next navigation
- Progress indicator (e.g., 3 / 15)

---

## 4. Component Tree

```
AppLayout
├── Sidebar
│   └── VideoCard × N
│
└── [page outlet]
    ├── HomePage
    │   ├── VideoInputForm
    │   └── VideoCard × N (with ProcessingStatus)
    │
    ├── VideoPage
    │   ├── ProcessingStatus
    │   ├── SummaryCard
    │   │   └── key_points list
    │   └── FeatureNav (Chat / Quiz / Flashcards)
    │
    ├── ChatPage
    │   ├── ChatWindow
    │   │   └── MessageBubble × N
    │   │       └── SourceChips (assistant only)
    │   └── ChatInput
    │
    ├── QuizPage
    │   └── QuizContainer
    │       ├── QuestionCard
    │       │   └── OptionButton × 4
    │       └── QuizResult (after completion)
    │
    └── FlashcardPage
        └── FlashcardViewer
            ├── CardProgress
            └── FlipCard
```

---

## 5. State Management

### Zustand Store (`useAppStore`)

```ts
interface AppStore {
  // Active video
  currentVideoId: string | null;
  setCurrentVideoId: (id: string) => void;

  // Active chat session
  currentSessionId: string | null;
  setCurrentSessionId: (id: string) => void;

  // Quiz state
  quizAnswers: Record<string, string>;   // questionId → selectedOption
  setQuizAnswer: (qId: string, opt: string) => void;
  resetQuiz: () => void;

  // Flashcard state
  currentCardIndex: number;
  setCardIndex: (i: number) => void;
  isCardFlipped: boolean;
  toggleFlip: () => void;
}
```

### TanStack Query Usage

```ts
// Fetch video details (auto-refetch until completed)
const { data: video } = useQuery({
  queryKey: ['video', videoId],
  queryFn: () => api.getVideo(videoId),
  refetchInterval: (data) =>
    data?.status === 'completed' ? false : 3000,  // poll every 3s
});

// Fetch summary
const { data: summary } = useQuery({
  queryKey: ['summary', videoId],
  queryFn: () => api.getSummary(videoId),
  enabled: video?.status === 'completed',
});

// Send chat message (mutation)
const sendMessage = useMutation({
  mutationFn: (content: string) =>
    api.sendMessage(sessionId, content),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
  },
});
```

---

## 6. API Integration

### `services/api.ts`

```ts
import axios from 'axios';

const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
  timeout: 30000,
});

export const api = {
  // Videos
  createVideo: (url: string) =>
    client.post<Video>('/videos', { url }).then(r => r.data),
  getVideo: (id: string) =>
    client.get<Video>(`/videos/${id}`).then(r => r.data),
  listVideos: () =>
    client.get<Video[]>('/videos').then(r => r.data),

  // Summary
  getSummary: (videoId: string) =>
    client.get<Summary>(`/videos/${videoId}/summary`).then(r => r.data),

  // Chat
  createSession: (videoId: string) =>
    client.post<ChatSession>('/chat/sessions', { videoId }).then(r => r.data),
  getMessages: (sessionId: string) =>
    client.get<Message[]>(`/chat/sessions/${sessionId}/messages`).then(r => r.data),
  sendMessage: (sessionId: string, content: string) =>
    client.post<Message>(`/chat/sessions/${sessionId}/messages`, { content })
      .then(r => r.data),

  // Quiz
  generateQuiz: (videoId: string) =>
    client.post<Quiz>(`/videos/${videoId}/quiz`).then(r => r.data),
  getQuiz: (videoId: string) =>
    client.get<Quiz>(`/videos/${videoId}/quiz`).then(r => r.data),

  // Flashcards
  generateFlashcards: (videoId: string) =>
    client.post<FlashcardSet>(`/videos/${videoId}/flashcards`).then(r => r.data),
  getFlashcards: (videoId: string) =>
    client.get<FlashcardSet>(`/videos/${videoId}/flashcards`).then(r => r.data),
};
```

---

## 7. Feature UI Flows

### 7.1 Video Input Flow

```
1. User types YouTube URL
2. Client validates: /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]{11}/
3. On valid: POST /api/videos
4. Show processing spinner with status polling
5. Status updates: pending → processing → completed
6. On complete: auto-navigate to /video/:id
```

### 7.2 Chat Flow

```
1. User lands on /video/:id/chat
2. Auto-create session if none exists (POST /chat/sessions)
3. Load prior messages (GET /chat/sessions/:id/messages)
4. User types question → POST /chat/sessions/:id/messages
5. Show typing indicator (optimistic update)
6. Receive AI response with source chunk IDs
7. Render SourceChips below assistant bubble
```

### 7.3 Quiz Flow

```
1. User lands on QuizPage
2. Check if quiz exists (GET /videos/:id/quiz)
3. If none: show "Generate Quiz" button → POST /videos/:id/quiz
4. Display questions one at a time
5. User selects option → highlight selection
6. On "Submit" → check against correct_option
7. Show ✓ or ✗ with explanation
8. Progress to next question
9. Final screen: score/total + correct answers review
```

### 7.4 Flashcard Flow

```
1. User lands on FlashcardPage
2. Check if set exists (GET /videos/:id/flashcards)
3. If none: show "Generate Flashcards" → POST /videos/:id/flashcards
4. Render first card (front = question)
5. User clicks card → flip animation (CSS 3D rotateY)
6. Back = answer
7. Next / Prev buttons navigate cards
8. Progress: "3 / 15"
```

---

## 8. Styling & Design System

### Tailwind Configuration

- Color palette: neutral grays + indigo primary + emerald success + rose error
- Typography: `font-sans` (Inter), `text-sm` base
- Dark mode: `class` strategy (toggle in header)

### Key UI Components (shadcn/ui)

| Component | Used For |
|---|---|
| `Button` | All action buttons |
| `Input` | URL input field |
| `Card` | Video cards, summary, quiz questions |
| `Badge` | Status badges (pending/processing/completed) |
| `Skeleton` | Loading placeholders |
| `Tooltip` | Source chunk previews |
| `Progress` | Quiz progress bar |
| `ScrollArea` | Chat message window |
| `Separator` | Section dividers |

### FlipCard CSS

```css
.flip-card { perspective: 1000px; }
.flip-card-inner {
  transition: transform 0.6s;
  transform-style: preserve-3d;
}
.flip-card.flipped .flip-card-inner {
  transform: rotateY(180deg);
}
.flip-card-front, .flip-card-back {
  backface-visibility: hidden;
}
.flip-card-back {
  transform: rotateY(180deg);
}
```

---

## 9. Error Handling & Loading States

### Error Strategy

```ts
// Global Axios interceptor
client.interceptors.response.use(
  (res) => res,
  (error) => {
    const message = error.response?.data?.message || 'Đã xảy ra lỗi';
    toast.error(message);
    return Promise.reject(error);
  }
);
```

### Loading State Patterns

| Scenario | UI |
|---|---|
| Video list loading | `<Skeleton />` cards |
| Processing in progress | Spinner + status text + progress % |
| Chat sending | Typing indicator bubble |
| Quiz generating | Full-page skeleton with "Đang tạo câu hỏi..." |
| API error | Toast notification + retry button |
| Video not found | 404 inline message with "Về trang chủ" link |

### Empty States

- No videos processed: prompt with "Nhập URL YouTube để bắt đầu"
- No quiz generated: "Chưa có bài kiểm tra — Tạo ngay"
- No flashcards: "Chưa có flashcard — Tạo ngay"
- Chat empty: "Hỏi bất kỳ điều gì về video này..."

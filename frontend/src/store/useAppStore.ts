import { create } from 'zustand';
import type { QuizOption } from '../types';

interface AppStore {
  currentVideoId: string | null;
  setCurrentVideoId: (id: string | null) => void;

  quizAnswers: Record<string, QuizOption>;
  setQuizAnswer: (questionId: string, option: QuizOption) => void;
  resetQuiz: () => void;

  currentCardIndex: number;
  setCardIndex: (i: number) => void;
  isCardFlipped: boolean;
  toggleFlip: () => void;
  setFlipped: (flipped: boolean) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  currentVideoId: null,
  setCurrentVideoId: (id) => set({ currentVideoId: id }),

  quizAnswers: {},
  setQuizAnswer: (questionId, option) =>
    set((state) => ({
      quizAnswers: { ...state.quizAnswers, [questionId]: option },
    })),
  resetQuiz: () => set({ quizAnswers: {} }),

  currentCardIndex: 0,
  setCardIndex: (i) => set({ currentCardIndex: i }),
  isCardFlipped: false,
  toggleFlip: () => set((state) => ({ isCardFlipped: !state.isCardFlipped })),
  setFlipped: (flipped) => set({ isCardFlipped: flipped }),
}));

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/videos': 'http://localhost:3000',
      '/summaries': 'http://localhost:3000',
      '/chat-sessions': 'http://localhost:3000',
      '/chat-messages': 'http://localhost:3000',
      '/quizzes': 'http://localhost:3000',
      '/quiz-questions': 'http://localhost:3000',
      '/flashcard-sets': 'http://localhost:3000',
      '/projects': 'http://localhost:3000',
      '/chunks': 'http://localhost:3000',
    },
  },
})

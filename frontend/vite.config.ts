import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/videos': 'http://127.0.0.1:3000',
      '/summaries': 'http://127.0.0.1:3000',
      '/chat-sessions': 'http://127.0.0.1:3000',
      '/chat-messages': 'http://127.0.0.1:3000',
      '/quizzes': 'http://127.0.0.1:3000',
      '/quiz-questions': 'http://127.0.0.1:3000',
      '/flashcard-sets': 'http://127.0.0.1:3000',
      '/projects': 'http://127.0.0.1:3000',
      '/chunks': 'http://127.0.0.1:3000',
    },
  },
})

# Video Sum

Video Sum là ứng dụng học từ video YouTube. Backend lấy transcript, chia chunk, tạo summary, tạo quiz và hỗ trợ chat theo nội dung video. Frontend cung cấp giao diện để nhập video, xem tóm tắt, luyện quiz và hỏi đáp.

## Tech Stack

- Backend: NestJS, TypeScript, Prisma, PostgreSQL
- Frontend: React, Vite, React Query, Zustand, Tailwind CSS
- AI: Groq-compatible ChatOpenAI, LangChain, fallback extractive summary, DeepEval

## Key Features

- Lấy transcript từ YouTube và lưu vào PostgreSQL
- Chia transcript thành chunk để làm nguồn cho summary, quiz và chat
- Summary AI-first với fallback extractive
- Tách model summary:
  - Map phase dùng `SUMMARY_MAP_MODEL`
  - Reduce/direct phase dùng `SUMMARY_REDUCE_MODEL`
- Quiz AI-first với fallback rule-based
- Chat có `retrievedChunks` để debug và đánh giá chất lượng

## Environment

Tối thiểu cần:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/video_sum?schema=public"
GROQ_API_KEY="..."
GROQ_BASE_URL="https://api.groq.com/openai/v1"
SUMMARY_MODE="auto"
SUMMARY_MAP_MODEL="llama-3.1-8b-instant"
SUMMARY_REDUCE_MODEL="llama-3.3-70b-versatile"
```

Xem thêm toàn bộ biến cấu hình trong [`.env.example`](./.env.example).

## Run Local

```bash
npm install
npm --prefix frontend install
docker compose up -d
npm run prisma:generate
npm run prisma:migrate
npm run start:dev
```

Hoặc chạy cả backend và frontend bằng:

```bash
node scripts/dev.js
```

## Useful Scripts

- `npm run start:dev`: chạy backend NestJS ở chế độ watch
- `npm run build`: build backend
- `npm run prisma:generate`: generate Prisma client
- `npm run prisma:migrate`: chạy Prisma migration
- `npm run eval:rag:deepeval`: đánh giá RAG
- `npm run eval:summarize:deepeval`: đánh giá summary
- `npm run eval:video:deepeval`: đánh giá all

## Summary Pipeline

Luồng summary hiện tại:

```text
transcript
  -> ensure chunks
  -> select chunks theo window để giữ coverage
  -> direct summary nếu video ngắn
  -> map -> collapse -> reduce nếu video dài
  -> fallback extractive nếu AI lỗi hoặc thiếu key
```

- Map phase dùng model nhẹ hơn để tiết kiệm quota và giảm độ trễ
- Reduce phase dùng model lớn hơn để tổng hợp đầu ra cuối cùng
- Collapse phase cũng dùng model map để tiết kiệm chi phí khi gom summary trung gian

## API Quick Checks

```bash
curl -X POST http://localhost:3000/videos \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://www.youtube.com/watch?v=VIDEO_ID\"}"

curl -X POST http://localhost:3000/chunks/from-video/VIDEO_UUID
curl -X POST http://localhost:3000/summaries/from-video/VIDEO_UUID
curl -X POST http://localhost:3000/quizzes/from-video/VIDEO_UUID
curl -X POST http://localhost:3000/chat-messages/ask \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"SESSION_UUID\",\"content\":\"Noi dung chinh cua video la gi?\"}"
```

## Notes

- `README.md` này phản ánh repo hiện tại, không phải template NestJS mặc định.
- Nếu bạn đổi model Groq cho summary, cập nhật cả `.env`, `.env.example` và tài liệu này để giữ đồng bộ.

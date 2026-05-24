# Kế hoạch cải thiện chất lượng Module Summarize

## 1. Vấn đề hiện tại
- Kết quả tóm tắt thường xuyên trả về "không đủ thông tin" hoặc "thiếu dữ kiện".
- Video dài bị mất dữ liệu quan trọng do chiến lược chọn chunk quá thưa.
- Prompt quá "phòng thủ", khiến AI không dám trích xuất thông tin nếu không chắc chắn 100%.
- Không có cơ chế kiểm tra chất lượng (Quality Gate), dẫn đến việc lưu các bản tóm tắt vô nghĩa vào database.

## 2. Mục tiêu
- Nâng cao độ bao phủ thông tin (coverage) cho video dài.
- Loại bỏ các bản tóm tắt kém chất lượng trước khi lưu.
- Cân bằng giữa tính an toàn (không bịa) và tính hữu ích (trích xuất được thông tin).

## 3. Các bước thực hiện chi tiết

### Bước 1: Cải thiện lựa chọn đầu vào (Input Selection)
**File:** `src/summaries/summary.service.ts`
- **Mở rộng cửa sổ:** Thay vì lấy 1 chunk tốt nhất mỗi window, sẽ tăng số lượng window hoặc lấy top 2 chunk nếu window đó chứa nhiều tín hiệu toán học.
- **Ưu tiên tín hiệu:** Cải thiện hàm `scoreChunk` để nhận diện tốt hơn các đoạn chứa công thức, ví dụ bài tập và kết luận.
- **Đảm bảo mạch truyện:** Luôn giữ 2 chunk đầu (mục tiêu) và 2 chunk cuối (kết luận) của video.

### Bước 2: Xây dựng Quality Gate (Bộ lọc chất lượng)
**File:** `src/summaries/summary.service.ts`
- **Logic kiểm tra:** Sau khi AI trả về kết quả, thực hiện đếm số lần xuất hiện của các cụm từ "phòng thủ" (ví dụ: "không đủ thông tin", "thiếu dữ kiện", "chưa rõ", "không đề cập").
- **Ngưỡng chặn (Threshold):** Nếu hơn 60% các mục trong `keyPoints` hoặc `simplifiedText` chứa các cụm từ này, bản tóm tắt bị coi là "Fail".
- **Hành động:** 
    - Log cảnh báo lỗi chất lượng.
    - Không lưu bản AI lỗi này.
    - Tự động quay về dùng `fallbackDraft` (Extractive Summary) để đảm bảo người dùng vẫn thấy được thông tin từ transcript.

### Bước 3: Tinh chỉnh Prompt (Prompt Engineering)
**File:** `src/summaries/summary-prompt.builder.ts`
- **Thay đổi tông giọng:** Chỉnh sửa chỉ dẫn để AI ưu tiên việc "tìm kiếm và tổng hợp" thay vì "cảnh báo thiếu hụt".
- **Cấu trúc lại phần "Thiếu dữ kiện":** Gom các phần thiếu vào một mục riêng thay vì cho phép AI điền "không rõ" vào mọi đề mục (key points, simplified text).
- **Ví dụ mẫu (Few-shot):** Cung cấp ví dụ về một bản tóm tắt tốt để AI bắt chước cấu trúc.

### Bước 4: Tích hợp Chiến lược Multi-Model
**File:** `src/summaries/summary.service.ts`, `src/summaries/summary-config.service.ts`
- **Map (8B):** Dùng model nhỏ để quét nhanh nhiều chunk (đã nới lỏng ở Bước 1).
- **Reduce (80B):** Dùng model lớn để lọc rác và viết lại bản tóm tắt cuối cùng một cách mạch lạc, vượt qua Quality Gate.

### Bước 5: Kiểm thử và Kiểm định
- **Smoke Test:** Chạy với các video "khó" (dài, nói nhanh, nhiều công thức).
- **DeepEval:** Sử dụng `SummarizationMetric` để đo chỉ số `inclusion` (độ bao phủ) và `hallucination` (độ bịa đặt).

## 4. Thứ tự ưu tiên
1.  **Bước 1 & 2:** Sửa logic chọn chunk và thêm Quality Gate (Giải quyết ngay vấn đề kết quả tệ).
2.  **Bước 3:** Tinh chỉnh Prompt (Cải thiện văn phong và độ hữu ích).
3.  **Bước 4:** Áp dụng Multi-model (Tối ưu hiệu năng/chi phí).

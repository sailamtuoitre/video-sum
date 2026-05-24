# Kế hoạch chỉnh sửa Module Summarize: Chiến lược Multi-Model MapReduce

## 1. Mục tiêu
Tối ưu hóa chi phí và hiệu năng bằng cách chia nhỏ tác vụ tóm tắt cho các model AI phù hợp:
- **Map Phase (Tóm tắt từng phần):** Sử dụng model nhỏ (8B - ví dụ `llama-3.1-8b-instant`) để xử lý nhanh, tiết kiệm quota và context.
- **Reduce Phase (Tổng hợp kết quả):** Sử dụng model lớn (70B/80B - ví dụ `llama-3.3-70b-versatile`) để đảm bảo chất lượng văn phong, tính logic và độ chính xác của bản tóm tắt cuối cùng.

## 2. Các file cần thay đổi

- `src/summaries/summary.types.ts`: Cập nhật interface `SummaryConfig`.
- `src/summaries/summary-config.service.ts`: Cập nhật logic đọc cấu hình từ `.env`.
- `src/summaries/summary.service.ts`: Cập nhật logic khởi tạo LLM cho từng giai đoạn.
- `.env` & `.env.example`: Thêm các biến môi trường mới.

## 3. Chi tiết thực hiện

### Bước 1: Cập nhật Cấu hình (Configuration)

1.  **Sửa `summary.types.ts`**:
    - Thêm `mapModel: string` và `reduceModel: string` vào `SummaryConfig`.
    - (Tùy chọn) Giữ lại `model` làm mặc định nếu các biến kia không được set.

2.  **Sửa `summary-config.service.ts`**:
    - Đọc `SUMMARY_MAP_MODEL` (mặc định `llama-3.1-8b-instant`).
    - Đọc `SUMMARY_REDUCE_MODEL` (mặc định `llama-3.3-70b-versatile`).
    - Gán các giá trị này vào object trả về của `getConfig()`.

3.  **Cập nhật `.env`**:
    ```env
    SUMMARY_MAP_MODEL=llama-3.1-8b-instant
    SUMMARY_REDUCE_MODEL=llama-3.3-70b-versatile
    ```

### Bước 2: Cập nhật Logic Service (`summary.service.ts`)

1.  **Refactor `createLlm`**:
    - Thay đổi để nhận tham số `modelName` thay vì lấy trực tiếp từ `config.model`.
    ```ts
    private createLlm(
      modelName: string,
      groqApiKey: string,
      maxTokens: number,
      config: SummaryConfig, // Để lấy baseUrl
    )
    ```

2.  **Cập nhật Map Phase (`buildMapSummaries`)**:
    - Gọi `createLlm(config.mapModel, ...)` khi thực hiện Map.

3.  **Cập nhật Collapse Phase (`collapseMapSummariesIfNeeded`)**:
    - Tùy chọn dùng `mapModel` hoặc `reduceModel`. Khuyến nghị: dùng `mapModel` để tiết kiệm vì đây vẫn là bước gom dữ liệu trung gian.

4.  **Cập nhật Reduce Phase (`reduceSummaries`)**:
    - Gọi `createLlm(config.reduceModel, ...)` khi thực hiện Reduce cuối cùng.

5.  **Cập nhật Direct Summary (`buildDirectAiSummaryDraft`)**:
    - Vì đây là tóm tắt một lần cho video ngắn, nên dùng `config.reduceModel` để có chất lượng tốt nhất.

### Bước 3: Kiểm tra và Đánh giá

1.  **Build dự án**: Chạy `npm run build` để đảm bảo không lỗi type.
2.  **Smoke Test**: Chạy tóm tắt cho 1 video dài để quan sát log (có thể thêm log để xem model nào đang được gọi).
3.  **Đánh giá chất lượng**: Sử dụng DeepEval để so sánh kết quả so với khi dùng 1 model duy nhất.

## 4. Lợi ích mong đợi
- **Tốc độ:** Model 8B phản hồi cực nhanh, giúp giai đoạn Map hoàn thành sớm.
- **Chi phí/Quota:** Giảm tải cho model 70B/80B vốn có giới hạn Rate Limit (RPM/TPM) khắt khe hơn trên các nền tảng như Groq.
- **Chất lượng:** Vẫn giữ được sự thông minh của model lớn ở khâu "chốt hạ" dữ liệu.

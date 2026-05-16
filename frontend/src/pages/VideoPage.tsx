import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import { cn, formatDuration } from '../lib/utils';

const statusColors: Record<string, string> = {
  pending: 'text-gold',
  processing: 'text-gold-bright',
  completed: 'text-sage-bright',
  failed: 'text-ember',
};

const statusLabels: Record<string, string> = {
  pending: 'Đang chờ xử lý...',
  processing: 'Đang xử lý video...',
  completed: 'Đã hoàn tất',
  failed: 'Xử lý thất bại',
};

export default function VideoPage() {
  const { videoId } = useParams<{ videoId: string }>();

  const { data: video, isLoading: videoLoading } = useQuery({
    queryKey: ['video', videoId],
    queryFn: () => api.getVideo(videoId!),
    enabled: !!videoId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 5000;
      return data.status === 'completed' || data.status === 'failed' ? false : 3000;
    },
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['summary', videoId],
    queryFn: async () => {
      const existingSummary = await api.getSummary(videoId!);

      if (existingSummary) {
        return existingSummary;
      }

      return api.generateSummary(videoId!);
    },
    enabled: !!videoId && video?.status === 'completed',
  });

  if (videoLoading) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-2/3 shimmer rounded-lg" />
        <div className="h-6 w-1/3 shimmer rounded-lg" />
        <div className="h-64 shimmer rounded-xl" />
      </div>
    );
  }

  if (!video) {
    return (
      <div className="text-center py-24">
        <p className="font-display text-xl text-ink-dim">Không tìm thấy video</p>
        <Link to="/" className="mt-4 inline-block text-gold hover:text-gold-bright text-sm">
          ← Về trang chủ
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <section>
        <Link to="/" className="text-ink-faint hover:text-ink-dim text-sm font-body mb-4 inline-block transition-colors">
          ← Tất cả video
        </Link>
        <h1 className="font-display text-3xl font-semibold text-ink leading-tight mt-2">
          {video.title || 'Video không có tiêu đề'}
        </h1>
        <div className="flex items-center gap-3 mt-3">
          <span className={cn('text-sm font-medium', statusColors[video.status])}>
            {statusLabels[video.status] || video.status}
          </span>
          {video.durationSec && (
            <span className="text-sm text-ink-faint">{formatDuration(video.durationSec)}</span>
          )}
          {video.language && (
            <span className="text-xs px-2 py-0.5 rounded bg-parchment-light text-ink-dim uppercase">
              {video.language}
            </span>
          )}
        </div>
        {video.errorMessage && (
          <p className="mt-3 text-sm text-ember bg-ember/5 border border-ember/20 rounded-lg px-4 py-3">
            {video.errorMessage}
          </p>
        )}
      </section>

      {video.status === 'completed' && (
        <>
          {summaryLoading && (
            <section className="space-y-4">
              <h2 className="font-display text-xl font-medium text-gold">Tóm tắt</h2>
              <div className="space-y-3">
                <div className="h-5 w-1/3 shimmer rounded-lg" />
                <div className="h-24 shimmer rounded-xl" />
              </div>
            </section>
          )}

          {summary && (
            <section className="space-y-5">
              <h2 className="font-display text-xl font-medium text-gold">Tóm tắt</h2>

              {summary.keyPoints && summary.keyPoints.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-medium text-ink-faint uppercase tracking-widest">
                    Ý chính
                  </h3>
                  <ul className="space-y-2.5">
                    {summary.keyPoints.map((point, i) => (
                      <li
                        key={i}
                        className="flex gap-3 text-sm text-ink-dim leading-relaxed animate-fade-up"
                        style={{ animationDelay: `${i * 80}ms` }}
                      >
                        <span className="text-gold-dim mt-1 shrink-0">•</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {summary.simplifiedText && (
                <div className="space-y-3">
                  <h3 className="text-xs font-medium text-ink-faint uppercase tracking-widest">
                    Giải thích đơn giản
                  </h3>
                  <p className="text-sm text-ink-dim leading-relaxed bg-parchment border border-parchment-light rounded-xl p-5">
                    {summary.simplifiedText}
                  </p>
                </div>
              )}

              {summary.mainTopics && summary.mainTopics.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-medium text-ink-faint uppercase tracking-widest">
                    Chủ đề chính
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {summary.mainTopics.map((topic, i) => (
                      <span
                        key={i}
                        className="px-3 py-1 rounded-full text-xs border border-gold-dim/30 text-gold bg-gold-dim/5"
                      >
                        {topic}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="space-y-4">
            <h2 className="font-display text-xl font-medium text-gold">Công cụ học tập</h2>
            <div className="grid grid-cols-2 gap-4">
              <Link
                to={`/video/${videoId}/chat`}
                className="group p-6 rounded-xl border border-parchment-light bg-parchment hover:border-sage/40 hover:bg-parchment-hover transition-all duration-200"
              >
                <div className="w-10 h-10 rounded-lg bg-sage/10 flex items-center justify-center mb-4 group-hover:bg-sage/20 transition-colors">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-sage-bright">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                  </svg>
                </div>
                <h3 className="font-display text-base font-medium text-ink mb-1">Chat với video</h3>
                <p className="text-xs text-ink-faint leading-relaxed">
                  Hỏi bất kỳ điều gì về nội dung video. AI sẽ trả lời dựa trên transcript.
                </p>
              </Link>

              <Link
                to={`/video/${videoId}/quiz`}
                className="group p-6 rounded-xl border border-parchment-light bg-parchment hover:border-gold-dim/40 hover:bg-parchment-hover transition-all duration-200"
              >
                <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center mb-4 group-hover:bg-gold/15 transition-colors">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gold">
                    <path d="M9 11l3 3L22 4" />
                    <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                  </svg>
                </div>
                <h3 className="font-display text-base font-medium text-ink mb-1">Trắc nghiệm</h3>
                <p className="text-xs text-ink-faint leading-relaxed">
                  10 câu hỏi trắc nghiệm từ nội dung video. Kiểm tra kiến thức của bạn.
                </p>
              </Link>
            </div>
          </section>
        </>
      )}

      {video.status === 'processing' && (
        <div className="text-center py-16 space-y-4">
          <div className="inline-flex items-center gap-3 text-gold">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="font-body text-sm">Đang xử lý video - trích xuất transcript và tạo tóm tắt...</span>
          </div>
          <p className="text-xs text-ink-faint">Quá trình này có thể mất 30-120 giây tùy độ dài video.</p>
        </div>
      )}

      {video.status === 'pending' && (
        <div className="text-center py-16">
          <p className="text-ink-dim font-body">Video đang trong hàng chờ xử lý...</p>
        </div>
      )}

      {video.status === 'failed' && (
        <div className="text-center py-16 space-y-4">
          <p className="text-ember font-body">Xử lý video thất bại.</p>
          <Link to="/" className="text-gold hover:text-gold-bright text-sm">
            ← Thử video khác
          </Link>
        </div>
      )}
    </div>
  );
}

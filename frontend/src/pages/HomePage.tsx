import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api } from '../services/api';
import { isValidYoutubeUrl, formatDuration, formatDate } from '../lib/utils';
import { cn } from '../lib/utils';

const statusColors: Record<string, string> = {
  pending: 'bg-gold-dim/20 text-gold',
  processing: 'bg-gold/15 text-gold-bright',
  completed: 'bg-sage/15 text-sage-bright',
  failed: 'bg-ember/15 text-ember',
};

const statusLabels: Record<string, string> = {
  pending: 'Hàng đợi',
  processing: 'Đang xử lý...',
  completed: 'Hoàn tất',
  failed: 'Lỗi',
};

export default function HomePage() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: videos, isLoading: videosLoading } = useQuery({
    queryKey: ['videos'],
    queryFn: api.getVideos,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 5000;
      const hasActive = data.some((v) => v.status === 'pending' || v.status === 'processing');
      return hasActive ? 3000 : false;
    },
  });

  const createMutation = useMutation({
    mutationFn: api.createVideo,
    onSuccess: (video) => {
      queryClient.invalidateQueries({ queryKey: ['videos'] });
      setUrl('');
      setError('');
      navigate(`/video/${video.id}`);
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Không thể tạo video. Vui lòng thử lại.';
      setError(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteVideo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['videos'] });
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Không thể xóa video. Vui lòng thử lại.';
      setError(msg);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setError('Vui lòng nhập URL YouTube.');
      return;
    }
    if (!isValidYoutubeUrl(trimmed)) {
      setError('URL YouTube không hợp lệ. Ví dụ: https://www.youtube.com/watch?v=...');
      return;
    }
    setError('');
    createMutation.mutate(trimmed);
  };

  const handleDeleteVideo = (videoId: string, title: string | null) => {
    const label = title || 'video này';
    const confirmed = window.confirm(`Bạn có chắc muốn xóa "${label}" không?`);

    if (!confirmed) {
      return;
    }

    setError('');
    deleteMutation.mutate(videoId);
  };

  return (
    <div className="space-y-12">
      <section className="space-y-6">
        <div>
          <h2 className="font-display text-3xl font-semibold text-ink tracking-tight">
            Học từ video
          </h2>
          <p className="mt-2 text-ink-dim text-base font-body leading-relaxed">
            Nhập một URL YouTube. AI sẽ trích xuất nội dung, tạo tóm tắt, câu hỏi trắc nghiệm,
            và chatbot để bạn học hiệu quả.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex gap-3">
            <input
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (error) setError('');
              }}
              placeholder="https://www.youtube.com/watch?v=..."
              className={cn(
                'flex-1 px-5 py-3.5 rounded-xl bg-parchment border text-ink placeholder:text-ink-faint font-body',
                'focus:outline-none focus:border-gold transition-colors duration-200',
                error ? 'border-ember' : 'border-parchment-light',
              )}
              disabled={createMutation.isPending}
            />
            <button
              type="submit"
              disabled={createMutation.isPending}
              className={cn(
                'px-7 py-3.5 rounded-xl font-body font-medium text-sm transition-all duration-200',
                'bg-gold text-void-deep hover:bg-gold-bright active:scale-[0.98]',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {createMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Đang xử lý...
                </span>
              ) : (
                'Xử lý video'
              )}
            </button>
          </div>
          {error && (
            <p className="text-ember text-sm font-body">{error}</p>
          )}
        </form>
      </section>

      <section className="space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl font-medium text-ink-dim">
            Video đã xử lý
          </h3>
          {videos && videos.length > 0 && (
            <span className="text-xs text-ink-faint font-body">{videos.length} video</span>
          )}
        </div>

        {videosLoading && (
          <div className="grid gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-28 rounded-xl shimmer" />
            ))}
          </div>
        )}

        {videos && videos.length === 0 && !videosLoading && (
          <div className="text-center py-16 px-8 rounded-xl border border-dashed border-parchment-light">
            <p className="text-ink-faint font-body text-base italic">
              Chưa có video nào. Nhập URL YouTube phía trên để bắt đầu.
            </p>
          </div>
        )}

        {videos && videos.length > 0 && (
          <div className="grid gap-3">
            {videos.map((v, i) => {
              const isDeleting = deleteMutation.isPending && deleteMutation.variables === v.id;

              return (
                <div
                  key={v.id}
                  className={cn(
                    'p-5 rounded-xl border border-parchment-light bg-parchment',
                    'hover:border-gold-dim hover:bg-parchment-hover transition-all duration-200',
                    'animate-fade-up',
                    isDeleting && 'opacity-60',
                  )}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <Link to={`/video/${v.id}`} className="group/link block">
                        <h4 className="font-display text-base font-medium text-ink line-clamp-2 group-hover/link:text-gold transition-colors">
                          {v.title || 'Video không có tiêu đề'}
                        </h4>
                      </Link>
                      <div className="flex items-center gap-3 mt-2">
                        <span className={cn('text-xs px-2.5 py-0.5 rounded-full font-medium', statusColors[v.status])}>
                          {statusLabels[v.status] || v.status}
                        </span>
                        {v.durationSec && (
                          <span className="text-xs text-ink-faint">{formatDuration(v.durationSec)}</span>
                        )}
                        <span className="text-xs text-ink-faint">{formatDate(v.createdAt)}</span>
                      </div>
                      {v.errorMessage && (
                        <p className="mt-2 text-xs text-ember line-clamp-1">{v.errorMessage}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteVideo(v.id, v.title)}
                      disabled={deleteMutation.isPending}
                      aria-label={`Xóa ${v.title || 'video'}`}
                      title="Xóa video"
                      className={cn(
                        'shrink-0 mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-lg',
                        'text-ink-faint hover:text-ember hover:bg-ember/10 transition-colors',
                        'disabled:cursor-not-allowed disabled:opacity-50',
                      )}
                    >
                      <Trash2 size={17} strokeWidth={1.7} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

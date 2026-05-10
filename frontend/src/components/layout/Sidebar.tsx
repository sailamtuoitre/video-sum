import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import { cn, formatDuration } from '../../lib/utils';

const statusColors: Record<string, string> = {
  pending: 'text-ink-faint',
  processing: 'text-gold',
  completed: 'text-sage-bright',
  failed: 'text-ember',
};

const statusLabels: Record<string, string> = {
  pending: 'Chờ...',
  processing: 'Đang xử lý',
  completed: 'Hoàn tất',
  failed: 'Thất bại',
};

export function Sidebar() {
  const location = useLocation();
  const { data: videos, isLoading } = useQuery({
    queryKey: ['videos'],
    queryFn: api.getVideos,
    refetchInterval: 5000,
  });

  const currentVideoId = useAppStore((s) => s.currentVideoId);

  return (
    <aside className="w-72 h-screen flex flex-col border-r border-parchment-light bg-void-deep shrink-0">
      <div className="px-6 pt-8 pb-6 border-b border-parchment-light">
        <Link to="/" className="block">
          <h1 className="font-display text-xl font-semibold text-gold tracking-wide leading-tight">
            Học Tập
            <span className="block text-ink-dim text-sm font-normal font-body tracking-normal mt-0.5">
              AI Video Assistant
            </span>
          </h1>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        <Link
          to="/"
          className={cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150',
            location.pathname === '/'
              ? 'bg-parchment-light text-gold'
              : 'text-ink-dim hover:text-ink hover:bg-parchment',
          )}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          Trang chủ
        </Link>

        {videos && videos.length > 0 && (
          <>
            <div className="px-3 pt-5 pb-2">
              <p className="text-xs font-medium text-ink-faint uppercase tracking-widest">Video đã xử lý</p>
            </div>
            {videos.map((v, i) => (
              <Link
                key={v.id}
                to={`/video/${v.id}`}
                onClick={() => useAppStore.getState().setCurrentVideoId(v.id)}
                className={cn(
                  'flex flex-col px-3 py-2.5 rounded-lg transition-colors duration-150',
                  'hover:bg-parchment animate-fade-up',
                  currentVideoId === v.id || location.pathname.includes(v.id)
                    ? 'bg-parchment-light border-l-2 border-gold'
                    : 'border-l-2 border-transparent',
                )}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <span className="text-sm text-ink line-clamp-1 font-medium">
                  {v.title || 'Không có tiêu đề'}
                </span>
                <span className="flex items-center gap-2 mt-0.5">
                  <span className={cn('text-xs', statusColors[v.status])}>
                    {statusLabels[v.status] || v.status}
                  </span>
                  {v.durationSec && (
                    <span className="text-xs text-ink-faint">{formatDuration(v.durationSec)}</span>
                  )}
                </span>
              </Link>
            ))}
          </>
        )}

        {isLoading && (
          <div className="space-y-2 px-3 pt-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-14 rounded-lg shimmer" />
            ))}
          </div>
        )}
      </nav>

      <div className="px-6 py-4 border-t border-parchment-light">
        <p className="text-xs text-ink-faint font-body italic">
          Học từ video YouTube với AI
        </p>
      </div>
    </aside>
  );
}

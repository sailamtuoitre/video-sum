import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import { cn } from '../lib/utils';
import { useState } from 'react';

export default function FlashcardPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const queryClient = useQueryClient();
  const [flipped, setFlipped] = useState(false);

  const { data: video } = useQuery({
    queryKey: ['video', videoId],
    queryFn: () => api.getVideo(videoId!),
    enabled: !!videoId,
  });

  const { data: flashcardSet, isLoading: setLoading } = useQuery({
    queryKey: ['flashcardSet', videoId],
    queryFn: () => api.getFlashcardSet(videoId!),
    enabled: !!videoId && video?.status === 'completed',
  });

  const { data: studyState, isLoading: studyLoading } = useQuery({
    queryKey: ['studyState', flashcardSet?.id],
    queryFn: () => api.getStudyState(flashcardSet!.id),
    enabled: !!flashcardSet?.id,
  });

  const generateMutation = useMutation({
    mutationFn: () => api.generateFlashcards(videoId!),
    onSuccess: (data) => {
      queryClient.setQueryData(['flashcardSet', videoId], data);
    },
  });

  const reviewMutation = useMutation({
    mutationFn: ({ flashcardId, status }: { flashcardId: string; status: 'known' | 'unknown' }) =>
      api.reviewCard(studyState!.id, flashcardId, status),
    onSuccess: (data) => {
      queryClient.setQueryData(['studyState', flashcardSet?.id], data);
      setFlipped(false);
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => api.resetStudy(studyState!.id),
    onSuccess: (data) => {
      queryClient.setQueryData(['studyState', flashcardSet?.id], data);
      setFlipped(false);
    },
  });

  if (video?.status !== 'completed') {
    return (
      <div className="text-center py-16">
        <p className="text-ink-dim font-body">Video chưa được xử lý xong.</p>
        <Link to={`/video/${videoId}`} className="mt-4 inline-block text-gold text-sm">
          ← Quay lại
        </Link>
      </div>
    );
  }

  if (setLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 shimmer rounded-lg" />
        <div className="h-80 shimmer rounded-xl" />
      </div>
    );
  }

  if (!flashcardSet && !generateMutation.isPending) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-6">
        <div className="w-20 h-20 rounded-2xl bg-parchment-light flex items-center justify-center">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ember">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        </div>
        <div>
          <h2 className="font-display text-xl text-ink">Chưa có flashcard</h2>
          <p className="text-sm text-ink-faint mt-1">Tạo 20 thẻ ghi nhớ từ nội dung video.</p>
        </div>
        <button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className="px-6 py-3 rounded-xl bg-gold text-void-deep font-body text-sm font-medium hover:bg-gold-bright transition-colors disabled:opacity-50"
        >
          {generateMutation.isPending ? 'Đang tạo...' : 'Tạo flashcards'}
        </button>
        <Link to={`/video/${videoId}`} className="text-ink-faint hover:text-ink-dim text-sm transition-colors">
          ← Quay lại
        </Link>
      </div>
    );
  }

  if (generateMutation.isPending) {
    return (
      <div className="space-y-6 py-16 text-center">
        <div className="inline-flex items-center gap-3 text-gold">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="font-body text-sm">Đang tạo flashcards từ nội dung video...</span>
        </div>
      </div>
    );
  }

  if (studyLoading || !studyState) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="inline-flex items-center gap-3 text-ink-faint">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">Đang tải...</span>
        </div>
      </div>
    );
  }

  const currentCard = studyState.currentCard;
  const { stats } = studyState;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to={`/video/${videoId}`} className="text-ink-faint hover:text-ink-dim transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M19 12H5m7-7l-7 7 7 7" />
            </svg>
          </Link>
          <div>
            <h1 className="font-display text-xl font-medium text-ink">Flashcards</h1>
            <p className="text-xs text-ink-faint mt-0.5">{flashcardSet?.title || 'Bộ thẻ ghi nhớ'}</p>
          </div>
        </div>
        <button
          onClick={() => {
            if (window.confirm('Bạn có chắc muốn đặt lại tiến độ học?')) {
              resetMutation.mutate();
            }
          }}
          disabled={resetMutation.isPending}
          className="text-xs text-ink-faint hover:text-ink-dim transition-colors disabled:opacity-50"
        >
          Đặt lại
        </button>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-6 p-4 rounded-xl bg-parchment border border-parchment-light">
        <Stat label="Đã thuộc" value={stats.known} color="text-sage-bright" />
        <Stat label="Chưa thuộc" value={stats.unknown} color="text-ember" />
        <Stat label="Còn lại" value={stats.remaining} color="text-ink-dim" />
        <div className="flex-1 text-right">
          <span className="text-xs text-ink-faint tabular-nums">
            {stats.reviewed}/{stats.total}
          </span>
        </div>
      </div>

      {stats.completed ? (
        <div className="text-center py-16 space-y-6">
          <div className="w-20 h-20 rounded-full mx-auto bg-sage/10 border-2 border-sage-bright flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-sage-bright">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <h2 className="font-display text-xl text-ink">Đã hoàn thành!</h2>
            <p className="text-sm text-ink-dim mt-1">
              Bạn đã ôn hết {stats.total} thẻ. Đã thuộc: {stats.known}, cần ôn lại: {stats.unknown}.
            </p>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => {
                if (window.confirm('Bắt đầu lại từ đầu?')) {
                  resetMutation.mutate();
                }
              }}
              className="px-5 py-2.5 rounded-xl bg-parchment-light text-ink text-sm font-body hover:bg-parchment-hover transition-colors"
            >
              Học lại
            </button>
            <Link
              to={`/video/${videoId}`}
              className="px-5 py-2.5 rounded-xl bg-gold text-void-deep text-sm font-body font-medium hover:bg-gold-bright transition-colors"
            >
              Quay lại
            </Link>
          </div>
        </div>
      ) : currentCard ? (
        <div className="space-y-6">
          {/* Flip card */}
          <div
            className={cn('flip-card h-80 cursor-pointer', flipped && 'flipped')}
            onClick={() => setFlipped(!flipped)}
          >
            <div className="flip-card-inner">
              <div className="flip-card-front rounded-2xl border border-parchment-light bg-parchment p-8 flex flex-col items-center justify-center text-center">
                <p className="text-xs text-ink-faint uppercase tracking-widest mb-4 font-body">
                  Mặt trước — Câu hỏi
                </p>
                <p className="font-display text-lg text-ink leading-relaxed">
                  {currentCard.front}
                </p>
                <p className="mt-6 text-xs text-ink-faint italic">
                  Nhấn để lật thẻ
                </p>
              </div>
              <div className="flip-card-back rounded-2xl border border-gold-dim/30 bg-parchment p-8 flex flex-col items-center justify-center text-center">
                <p className="text-xs text-gold-dim uppercase tracking-widest mb-4 font-body">
                  Mặt sau — Đáp án
                </p>
                <p className="font-body text-base text-ink leading-relaxed">
                  {currentCard.back}
                </p>
                <p className="mt-6 text-xs text-ink-faint italic">
                  Nhấn để lật lại
                </p>
              </div>
            </div>
          </div>

          {/* Review buttons */}
          <div className="flex gap-3 justify-center">
            <button
              onClick={() =>
                reviewMutation.mutate({ flashcardId: currentCard.id, status: 'unknown' })
              }
              disabled={reviewMutation.isPending}
              className={cn(
                'px-8 py-3 rounded-xl border font-body text-sm font-medium transition-all duration-200',
                'border-ember/30 text-ember hover:bg-ember/10 active:scale-[0.98]',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              Chưa thuộc
            </button>
            <button
              onClick={() =>
                reviewMutation.mutate({ flashcardId: currentCard.id, status: 'known' })
              }
              disabled={reviewMutation.isPending}
              className={cn(
                'px-8 py-3 rounded-xl font-body text-sm font-medium transition-all duration-200',
                'bg-sage text-void-deep hover:bg-sage-bright active:scale-[0.98]',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              Đã thuộc
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <span className={cn('font-display text-lg font-semibold tabular-nums', color)}>
        {value}
      </span>
      <p className="text-xs text-ink-faint mt-0.5">{label}</p>
    </div>
  );
}

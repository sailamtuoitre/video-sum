import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import { cn } from '../lib/utils';
import type { ChatMessage, RetrievedContext } from '../types';

export default function ChatPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: video } = useQuery({
    queryKey: ['video', videoId],
    queryFn: () => api.getVideo(videoId!),
    enabled: !!videoId,
  });

  const { data: sessions } = useQuery({
    queryKey: ['sessions', videoId],
    queryFn: () => api.getSessions(videoId!),
    enabled: !!videoId,
  });

  const createSessionMutation = useMutation({
    mutationFn: () => api.createSession(videoId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', videoId] });
    },
  });

  const sessionId = sessions?.[0]?.id;

  const { data: messages, isLoading: messagesLoading } = useQuery({
    queryKey: ['messages', sessionId],
    queryFn: () => api.getMessages(sessionId!),
    enabled: !!sessionId,
  });

  const sendMutation = useMutation({
    mutationFn: (content: string) => api.ask(sessionId!, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
      setInput('');
    },
  });

  useEffect(() => {
    if (videoId && sessions && sessions.length === 0 && !createSessionMutation.isPending) {
      createSessionMutation.mutate();
    }
  }, [videoId, sessions]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sendMutation.isPending || !sessionId) return;
    sendMutation.mutate(trimmed);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)]">
      <div className="flex items-center gap-4 mb-6 shrink-0">
        <Link to={`/video/${videoId}`} className="text-ink-faint hover:text-ink-dim transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M19 12H5m7-7l-7 7 7 7" />
          </svg>
        </Link>
        <div>
          <h1 className="font-display text-xl font-medium text-ink">
            Chat với video
          </h1>
          {video?.title && (
            <p className="text-xs text-ink-faint mt-0.5 line-clamp-1">{video.title}</p>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4 min-h-0"
      >
        {messagesLoading && (
          <div className="text-center py-8">
            <p className="text-ink-faint text-sm font-body italic">Đang tải lịch sử chat...</p>
          </div>
        )}

        {!messagesLoading && (!messages || messages.length === 0) && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-3 max-w-md">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-parchment-light flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gold-dim">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </svg>
              </div>
              <p className="font-display text-lg text-ink-dim">
                Hỏi bất kỳ điều gì về video này
              </p>
              <p className="text-sm text-ink-faint leading-relaxed">
                AI sẽ tìm kiếm trong transcript và trả lời dựa trên nội dung video.
                Nếu thông tin không có trong video, AI sẽ thông báo.
              </p>
            </div>
          </div>
        )}

        {messages?.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {sendMutation.isPending && (
          <div className="flex items-start gap-3 animate-fade-up">
            <div className="w-8 h-8 rounded-full bg-parchment-light flex items-center justify-center shrink-0 mt-0.5">
              <svg className="animate-spin h-4 w-4 text-gold" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-parchment-light text-ink-dim text-sm">
              Đang suy nghĩ...
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="shrink-0 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Hỏi về nội dung video..."
          className={cn(
            'flex-1 px-4 py-3 rounded-xl bg-parchment border border-parchment-light',
            'text-ink placeholder:text-ink-faint font-body text-sm',
            'focus:outline-none focus:border-gold-dim transition-colors duration-200',
          )}
          disabled={sendMutation.isPending || !sessionId}
        />
        <button
          type="submit"
          disabled={sendMutation.isPending || !input.trim() || !sessionId}
          className={cn(
            'px-5 py-3 rounded-xl bg-gold text-void-deep font-body text-sm font-medium',
            'hover:bg-gold-bright active:scale-[0.98] transition-all duration-200',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex items-start gap-3 animate-fade-up', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5',
          isUser ? 'bg-ember/20 text-ember' : 'bg-sage/20 text-sage-bright',
        )}
      >
        <span className="text-xs font-bold font-display">
          {isUser ? 'B' : 'AI'}
        </span>
      </div>
      <div className={cn('max-w-[75%] space-y-2', isUser && 'items-end')}>
        <div
          className={cn(
            'px-4 py-3 rounded-2xl text-sm leading-relaxed',
            isUser
              ? 'bg-ember/10 border border-ember/20 text-ink rounded-tr-sm'
              : 'bg-parchment-light text-ink-dim rounded-tl-sm',
          )}
        >
          {message.content}
        </div>
        {!isUser && message.retrievedChunks && message.retrievedChunks.length > 0 && (
          <SourceChips chunks={message.retrievedChunks as RetrievedContext[]} />
        )}
      </div>
    </div>
  );
}

function SourceChips({ chunks }: { chunks: RetrievedContext[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <p className="text-xs text-ink-faint font-body">Nguồn tham khảo:</p>
      <div className="flex flex-wrap gap-1.5">
        {chunks.map((chunk) => (
          <div key={chunk.citationId}>
            <button
              onClick={() => setExpanded(expanded === chunk.citationId ? null : chunk.citationId)}
              className={cn(
                'text-xs px-2 py-1 rounded-md font-medium transition-colors',
                chunk.source === 'chunk'
                  ? 'bg-gold-dim/10 text-gold-dim hover:bg-gold-dim/20'
                  : 'bg-sage/10 text-sage-bright hover:bg-sage/20',
              )}
            >
              [{chunk.citationId}]
            </button>
            {expanded === chunk.citationId && (
              <div className="mt-1 p-2.5 rounded-lg bg-parchment border border-parchment-light text-xs text-ink-faint leading-relaxed max-w-xs">
                {chunk.content.length > 200
                  ? chunk.content.slice(0, 200) + '...'
                  : chunk.content}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

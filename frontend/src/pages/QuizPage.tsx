import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import { cn } from '../lib/utils';
import type { QuizQuestion, CheckAnswerResult, QuizOption } from '../types';

export default function QuizPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const queryClient = useQueryClient();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<QuizOption | null>(null);
  const [checkResult, setCheckResult] = useState<CheckAnswerResult | null>(null);
  const [answers, setAnswers] = useState<Record<number, CheckAnswerResult>>({});
  const [finished, setFinished] = useState(false);

  const { data: video } = useQuery({
    queryKey: ['video', videoId],
    queryFn: () => api.getVideo(videoId!),
    enabled: !!videoId,
  });

  const { data: quiz, isLoading: quizLoading } = useQuery({
    queryKey: ['quiz', videoId],
    queryFn: () => api.getQuiz(videoId!),
    enabled: !!videoId && video?.status === 'completed',
  });

  const generateMutation = useMutation({
    mutationFn: () => api.generateQuiz(videoId!),
    onSuccess: (data) => {
      queryClient.setQueryData(['quiz', videoId], data);
    },
  });

  const checkMutation = useMutation({
    mutationFn: ({ questionId, option }: { questionId: string; option: QuizOption }) =>
      api.checkAnswer(questionId, option),
    onSuccess: (data) => {
      setCheckResult(data);
      setAnswers((prev) => ({ ...prev, [currentIndex]: data }));
    },
  });

  const currentQuestion: QuizQuestion | null = quiz?.questions?.[currentIndex] ?? null;

  const handleSelect = (option: QuizOption) => {
    if (checkResult) return;
    setSelectedOption(option);
  };

  const handleCheck = () => {
    if (!selectedOption || !currentQuestion) return;
    checkMutation.mutate({ questionId: currentQuestion.id, option: selectedOption });
  };

  const handleNext = () => {
    if (quiz && currentIndex < quiz.totalQuestions - 1) {
      setCurrentIndex((i) => i + 1);
      setSelectedOption(null);
      setCheckResult(null);
    }
  };

  const handleFinish = () => {
    setFinished(true);
  };

  const handleRetry = () => {
    setCurrentIndex(0);
    setSelectedOption(null);
    setCheckResult(null);
    setAnswers({});
    setFinished(false);
  };

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

  if (quizLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 shimmer rounded-lg" />
        <div className="h-64 shimmer rounded-xl" />
      </div>
    );
  }

  if (!quiz && !generateMutation.isPending) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-6">
        <div className="w-20 h-20 rounded-2xl bg-parchment-light flex items-center justify-center">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gold-dim">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
          </svg>
        </div>
        <div>
          <h2 className="font-display text-xl text-ink">Chưa có bài trắc nghiệm</h2>
          <p className="text-sm text-ink-faint mt-1">Tạo 10 câu hỏi trắc nghiệm từ nội dung video.</p>
        </div>
        <button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className="px-6 py-3 rounded-xl bg-gold text-void-deep font-body text-sm font-medium hover:bg-gold-bright transition-colors disabled:opacity-50"
        >
          {generateMutation.isPending ? 'Đang tạo...' : 'Tạo bài trắc nghiệm'}
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
          <span className="font-body text-sm">Đang tạo câu hỏi từ nội dung video...</span>
        </div>
      </div>
    );
  }

  if (finished && quiz) {
    const correctCount = Object.values(answers).filter((a) => a.isCorrect).length;
    const total = quiz.totalQuestions;
    return (
      <div className="space-y-8 animate-fade-up">
        <div className="text-center space-y-4">
          <div className={cn(
            'w-20 h-20 rounded-full mx-auto flex items-center justify-center border-4',
            correctCount >= 7
              ? 'border-sage-bright text-sage-bright bg-sage/10'
              : correctCount >= 4
                ? 'border-gold text-gold bg-gold/10'
                : 'border-ember text-ember bg-ember/10',
          )}>
            <span className="font-display text-2xl font-bold">{correctCount}/{total}</span>
          </div>
          <h2 className="font-display text-2xl text-ink">
            {correctCount >= 7 ? 'Xuất sắc!' : correctCount >= 4 ? 'Khá tốt!' : 'Cố gắng thêm!'}
          </h2>
          <p className="text-ink-dim text-sm">
            Bạn trả lời đúng {correctCount}/{total} câu hỏi.
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="font-display text-lg text-gold">Xem lại đáp án</h3>
          {quiz.questions.map((q, i) => {
            const ans = answers[i];
            return (
              <div
                key={q.id}
                className={cn(
                  'p-4 rounded-xl border',
                  ans?.isCorrect
                    ? 'border-sage/20 bg-sage/5'
                    : 'border-ember/20 bg-ember/5',
                )}
              >
                <p className="text-sm text-ink font-medium mb-2">
                  {i + 1}. {q.questionText}
                </p>
                {ans && (
                  <div className="space-y-1 text-xs">
                    <p className={ans.isCorrect ? 'text-sage-bright' : 'text-ember'}>
                      Bạn chọn: {ans.selectedOption}. {ans.selectedAnswerText || ''}
                      {ans.isCorrect ? ' ✓' : ' ✗'}
                    </p>
                    {!ans.isCorrect && (
                      <p className="text-sage-bright">
                        Đáp án đúng: {ans.correctOption}. {ans.correctAnswerText || ''}
                      </p>
                    )}
                    {ans.explanation && (
                      <p className="text-ink-faint italic mt-1">{ans.explanation}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex gap-3 justify-center">
          <button
            onClick={handleRetry}
            className="px-5 py-2.5 rounded-xl bg-parchment-light text-ink text-sm font-body hover:bg-parchment-hover transition-colors"
          >
            Làm lại
          </button>
          <Link
            to={`/video/${videoId}`}
            className="px-5 py-2.5 rounded-xl bg-gold text-void-deep text-sm font-body font-medium hover:bg-gold-bright transition-colors"
          >
            Quay lại video
          </Link>
        </div>
      </div>
    );
  }

  if (!quiz) return null;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Link to={`/video/${videoId}`} className="text-ink-faint hover:text-ink-dim transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M19 12H5m7-7l-7 7 7 7" />
          </svg>
        </Link>
        <div className="flex-1">
          <h1 className="font-display text-xl font-medium text-ink">Trắc nghiệm</h1>
          <div className="flex items-center gap-3 mt-1">
            <div className="flex-1 h-1.5 rounded-full bg-parchment-light overflow-hidden">
              <div
                className="h-full bg-gold rounded-full transition-all duration-300"
                style={{ width: `${((currentIndex) / quiz.totalQuestions) * 100}%` }}
              />
            </div>
            <span className="text-xs text-ink-faint font-body tabular-nums">
              {currentIndex + 1}/{quiz.totalQuestions}
            </span>
          </div>
        </div>
      </div>

      {currentQuestion && (
        <div className="space-y-6 animate-fade-up">
          <div className="p-6 rounded-xl bg-parchment border border-parchment-light">
            <p className="font-body text-base text-ink leading-relaxed">
              {currentQuestion.questionText}
            </p>
          </div>

          <div className="space-y-2.5">
            {(['A', 'B', 'C', 'D'] as QuizOption[]).map((opt) => {
              const optText = currentQuestion.options?.[opt];
              if (!optText) return null;

              const isSelected = selectedOption === opt;
              const isCorrect = checkResult?.correctOption === opt;
              const isWrong = checkResult && isSelected && !checkResult.isCorrect;

              return (
                <button
                  key={opt}
                  onClick={() => handleSelect(opt)}
                  disabled={!!checkResult}
                  className={cn(
                    'w-full text-left p-4 rounded-xl border transition-all duration-200',
                    'font-body text-sm',
                    !checkResult && 'hover:border-gold-dim cursor-pointer',
                    checkResult && 'cursor-default',
                    isSelected && !checkResult && 'border-gold bg-gold/5 text-ink',
                    !isSelected && !checkResult && 'border-parchment-light text-ink-dim',
                    isCorrect && checkResult && 'border-sage bg-sage/10 text-sage-bright',
                    isWrong && 'border-ember bg-ember/10 text-ember',
                  )}
                >
                  <span className="font-medium mr-2">{opt}.</span>
                  {optText}
                  {isCorrect && checkResult && (
                    <span className="ml-2 text-sage-bright">✓</span>
                  )}
                  {isWrong && (
                    <span className="ml-2 text-ember">✗</span>
                  )}
                </button>
              );
            })}
          </div>

          {checkResult && (
            <div
              className={cn(
                'p-4 rounded-xl border text-sm',
                checkResult.isCorrect
                  ? 'border-sage/20 bg-sage/5 text-sage-bright'
                  : 'border-ember/20 bg-ember/5 text-ember',
              )}
            >
              <p className="font-medium mb-1">{checkResult.feedback}</p>
              {checkResult.explanation && (
                <p className="text-ink-faint text-xs mt-1">{checkResult.explanation}</p>
              )}
            </div>
          )}

          <div className="flex gap-3">
            {!checkResult ? (
              <button
                onClick={handleCheck}
                disabled={!selectedOption || checkMutation.isPending}
                className={cn(
                  'px-6 py-2.5 rounded-xl bg-gold text-void-deep font-body text-sm font-medium',
                  'hover:bg-gold-bright transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                )}
              >
                {checkMutation.isPending ? 'Đang kiểm tra...' : 'Kiểm tra'}
              </button>
            ) : currentIndex < quiz.totalQuestions - 1 ? (
              <button
                onClick={handleNext}
                className="px-6 py-2.5 rounded-xl bg-parchment-light text-ink font-body text-sm hover:bg-parchment-hover transition-colors"
              >
                Câu tiếp theo
              </button>
            ) : (
              <button
                onClick={handleFinish}
                className="px-6 py-2.5 rounded-xl bg-gold text-void-deep font-body text-sm font-medium hover:bg-gold-bright transition-colors"
              >
                Xem kết quả
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import { Injectable } from '@nestjs/common';
import { SummaryTextService } from './summary-text.service';
import { SummaryDraft } from './summary.types';

export const INSUFFICIENT_MARKERS = [
  'khong du',
  'thieu du',
  'khong co du',
  'not enough',
  'insufficient',
] as const;

export const SIMPLIFIED_LABELS = [
  'chu de bai hoc',
  'kien thuc trong tam',
  'cong thuc dinh nghia',
  'dang bai va cach nhan dien',
  'cac buoc giai',
  'vi du trong transcript',
  'luu y dieu kien',
  'ket luan',
  'phan chua du du kien',
] as const;

@Injectable()
export class SummaryQualityChecker {
  constructor(private readonly text: SummaryTextService) {}

  isLowQualitySummary(draft: SummaryDraft): boolean {
    const joined = this.text.normalizeForCompare(
      [draft.simplifiedText, ...draft.keyPoints, ...draft.mainTopics].join(' '),
    );

    const markerHits = INSUFFICIENT_MARKERS.filter((marker) =>
      joined.includes(marker),
    ).length;

    const emptyLabelCount = this.countEmptySimplifiedLabels(
      draft.simplifiedText,
    );
    const weakKeyPoints = draft.keyPoints.filter((point) => {
      const normalized = this.text.normalizeForCompare(point);
      return (
        normalized.length < 20 ||
        normalized.includes('khong du') ||
        normalized.includes('thieu du')
      );
    }).length;

    return (
      markerHits >= 2 ||
      emptyLabelCount >= 4 ||
      (draft.keyPoints.length < 2 && weakKeyPoints >= draft.keyPoints.length)
    );
  }

  countEmptySimplifiedLabels(text: string): number {
    const normalizedText = text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ');

    return SIMPLIFIED_LABELS.filter((label) => {
      const cleanLabel = label.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const fullyCleanedText = normalizedText.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');

      const index = fullyCleanedText.indexOf(cleanLabel);
      if (index === -1) {
        return false;
      }

      const words = cleanLabel.split(' ');
      const lastWord = words[words.length - 1];
      const lastWordIndex = normalizedText.indexOf(lastWord, index);
      if (lastWordIndex === -1) {
        return false;
      }

      const tail = normalizedText.slice(lastWordIndex + lastWord.length).trim();

      return (
        tail.length === 0 ||
        (tail.startsWith(':') && tail.slice(1).trim().length === 0) ||
        tail.startsWith(': ...') ||
        tail.startsWith(':...') ||
        tail.startsWith('...') ||
        tail.startsWith(': khong du') ||
        tail.startsWith(':khong du') ||
        tail.startsWith('khong du')
      );
    }).length;
  }
}

export type SourceChunk = {
  id?: string;
  videoId: string;
  transcriptId: string;
  content: string;
  chunkIndex: number;
  tokenCount: number | null;
  startChar: number | null;
  endChar: number | null;
};

export type SummaryDraft = {
  keyPoints: string[];
  simplifiedText: string;
  mainTopics: string[];
  modelUsed: string;
  sourceChunkCount: number;
  sourceWordCount: number;
};

export type SummaryJson = Pick<
  SummaryDraft,
  'keyPoints' | 'simplifiedText' | 'mainTopics'
>;

export type MapSummary = {
  groupIndex: number;
  sourceChunkIndexes: number[];
  keyIdeas: string[];
  importantFormulas: string[];
  solutionSteps: string[];
  missingInformation: string[];
};

export type CollapsedSummary = {
  groupIndexes: number[];
  sourceChunkIndexes: number[];
  keyIdeas: string[];
  importantFormulas: string[];
  solutionSteps: string[];
  missingInformation: string[];
};

export type SummaryMode = 'auto' | 'direct' | 'mapreduce' | 'fallback';

export type SummaryConfig = {
  mode: SummaryMode;
  directMaxChunks: number;
  mapGroupSize: number;
  maxMapGroups: number;
  mapMaxTokens: number;
  collapseMaxGroups: number;
  collapseMaxTokens: number;
  reduceMaxTokens: number;
  chunkWordLimit: number;
  retryAttempts: number;
  retryBaseDelayMs: number;
  model: string;
  baseUrl: string;
};

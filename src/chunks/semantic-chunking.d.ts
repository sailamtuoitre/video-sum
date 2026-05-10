declare module 'semantic-chunking' {
  export type SemanticChunkInput = {
    document_name: string;
    document_text: string;
  };

  export type SemanticChunkResult = {
    text?: string;
    token_length?: number;
  };

  export type SemanticChunkOptions = {
    onnxEmbeddingModel?: string;
    dtype?: string;
    device?: string;
    modelCacheDir?: string;
    localModelPath?: string;
    maxTokenSize?: number;
    similarityThreshold?: number;
    dynamicThresholdLowerBound?: number;
    dynamicThresholdUpperBound?: number;
    numSimilaritySentencesLookahead?: number;
    combineChunks?: boolean;
    combineChunksSimilarityThreshold?: number;
    returnTokenLength?: boolean;
  };

  export function chunkit(
    documents: SemanticChunkInput[],
    options?: SemanticChunkOptions,
  ): Promise<SemanticChunkResult[]>;
}

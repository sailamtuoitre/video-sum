export type GroqMessage = {
  // role: 'system' | 'user' | 'assistant';
  role: string;
  content: string;
};

export type ChatCompletionParams = {
  model?: string;
  fallbackModels?: string[];
  messages: GroqMessage[];
  temperature?: number;
  maxTokens?: number;
  maxRetriesPerModel?: number;
};

export type ChatCompletionResult = {
  content: string;
  modelUsed: string;
  promptTokens: number | null;
  completionTokens: number | null;
};

export type TranscriptionResult = string;

export type GroqChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

export type GroqErrorPayload = {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

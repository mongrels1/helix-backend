export type AIProvider = 'openai' | 'gemini' | 'claude';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIRequest {
  prompt: string;
  messages?: ConversationMessage[];
  context?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  preferredProvider?: AIProvider;
  systemPrompt?: string;
  timeoutMs?: number;
  /** Override the Claude model (e.g. a stronger model for a strict correctness check). Claude path only. */
  claudeModel?: string;
  /**
   * Text that is identical across several calls (e.g. a lesson plan's class
   * context and resources), sent BEFORE `prompt`. Other providers simply get
   * it prepended. On Claude it is its own content block, and when
   * `cachePrefix` is true it is marked for prompt caching.
   */
  sharedPrefix?: string;
  /**
   * Mark `sharedPrefix` for Claude prompt caching. Only worth it when the
   * prefix is long enough for the model's cache minimum AND a later call will
   * read it: a cache write costs 25% more than plain input, so callers that
   * fire every request at once should leave this off.
   */
  cachePrefix?: boolean;
}

export interface AIResponse {
  text: string;
  provider: AIProvider;
  tokensUsed: number;
  latencyMs: number;
  /** Why the model stopped. 'max_tokens' means the reply was cut off, which is
   *  the difference between "the model got it wrong" and "we did not give it
   *  room to finish" — worth knowing before blaming the prompt. */
  stopReason?: string;
  /** Claude prompt caching: input tokens read from / written to the cache. */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ProviderConfig {
  name: AIProvider;
  available: boolean;
}

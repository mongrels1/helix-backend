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
}

export interface AIResponse {
  text: string;
  provider: AIProvider;
  tokensUsed: number;
  latencyMs: number;
}

export interface ProviderConfig {
  name: AIProvider;
  available: boolean;
}

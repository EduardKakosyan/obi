import { ChatMessage } from "../types";

/**
 * Provider types for LLM and Embedding services
 */
export type LLMProvider = "local" | "gemini";
export type EmbeddingProvider = "local" | "gemini";
export type VectorStoreProvider = "chromadb" | "pinecone";

/**
 * Unified interface for LLM clients
 */
export interface ILMClient {
	/**
	 * Send a chat completion request
	 */
	chat(messages: ChatMessage[]): Promise<ChatMessage>;

	/**
	 * Update client configuration
	 */
	updateConfig(config: Record<string, unknown>): void;

	/**
	 * Test connection to the LLM service
	 */
	testConnection(): Promise<boolean>;
}

/**
 * Unified interface for Embedding clients
 */
export interface IEmbeddingClient {
	/**
	 * Generate embedding for a single text
	 */
	embed(text: string): Promise<number[]>;

	/**
	 * Generate embeddings for multiple texts in batch
	 */
	embedBatch(texts: string[]): Promise<number[][]>;

	/**
	 * Update client configuration
	 */
	updateConfig(config: Record<string, unknown>): void;

	/**
	 * Test connection to the embedding service
	 */
	testConnection(): Promise<boolean>;

	/**
	 * Get the embedding dimension
	 */
	getEmbeddingDimension(): Promise<number>;
}

/**
 * Error class for LLM client errors
 */
export class LLMClientError extends Error {
	constructor(
		message: string,
		public statusCode?: number,
		public responseBody?: string
	) {
		super(message);
		this.name = "LLMClientError";
	}
}

/**
 * Error class for Embedding client errors
 */
export class EmbeddingClientError extends Error {
	constructor(
		message: string,
		public statusCode?: number,
		public responseBody?: string
	) {
		super(message);
		this.name = "EmbeddingClientError";
	}
}



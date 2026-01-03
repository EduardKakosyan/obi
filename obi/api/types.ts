import { ChatMessage } from "../types";
import {
	ToolDefinition,
	ToolCall,
	ToolResult,
	LLMResponse,
} from "../tools/types";

/**
 * Provider types for LLM and Embedding services
 */
export type LLMProvider = "local" | "gemini";
export type EmbeddingProvider = "local" | "gemini";
export type VectorStoreProvider = "chromadb" | "pinecone";

/**
 * Options for chat requests
 */
export interface ChatOptions {
	/** Tool definitions to make available to the LLM */
	tools?: ToolDefinition[];
	/** Results from previous tool calls */
	toolResults?: ToolResult[];
}

/**
 * Unified interface for LLM clients
 */
export interface ILMClient {
	/**
	 * Send a chat completion request
	 * @param messages The conversation history
	 * @param options Optional settings including tools
	 * @returns Response that may contain text or tool calls
	 */
	chat(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse>;

	/**
	 * Update client configuration
	 */
	updateConfig(config: Record<string, unknown>): void;

	/**
	 * Test connection to the LLM service
	 */
	testConnection(): Promise<boolean>;

	/**
	 * Whether this client supports tool/function calling
	 */
	supportsTools(): boolean;
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

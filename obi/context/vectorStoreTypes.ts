import { DocumentChunk } from "./documentChunker";

/**
 * Common search result interface for all vector stores
 */
export interface SearchResult {
	id: string;
	filePath: string;
	content: string;
	score: number;
	headingContext?: string;
}

/**
 * Unified interface for vector store implementations
 * Both ChromaDB and Pinecone implementations must conform to this interface
 */
export interface IVectorStore {
	/**
	 * Initialize the vector store (create collection/index if needed)
	 */
	initialize(): Promise<void>;

	/**
	 * Add or update documents with their embeddings
	 */
	upsert(chunks: DocumentChunk[], embeddings: number[][]): Promise<void>;

	/**
	 * Search for similar documents
	 */
	search(queryEmbedding: number[], nResults?: number): Promise<SearchResult[]>;

	/**
	 * Delete documents by file path
	 */
	deleteByFilePath(filePath: string): Promise<void>;

	/**
	 * Delete all documents in the collection/index
	 */
	clear(): Promise<void>;

	/**
	 * Get document count in collection/index
	 */
	count(): Promise<number>;

	/**
	 * Test connection to the vector store
	 */
	testConnection(): Promise<boolean>;

	/**
	 * Update configuration
	 */
	updateConfig(config: Record<string, unknown>): void;
}

/**
 * Error class for vector store errors
 */
export class VectorStoreError extends Error {
	constructor(
		message: string,
		public statusCode?: number
	) {
		super(message);
		this.name = "VectorStoreError";
	}
}


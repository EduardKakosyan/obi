import { requestUrl } from "obsidian";
import { DocumentChunk } from "./documentChunker";
import {
	IVectorStore,
	SearchResult,
	VectorStoreError,
} from "./vectorStoreTypes";

export interface PineconeConfig {
	apiKey: string;
	indexName: string;
	namespace?: string;
}

/**
 * Metadata stored with each vector in Pinecone
 */
interface ChunkMetadata {
	filePath: string;
	chunkIndex: number;
	headingContext: string;
	tokenCount: number;
	content: string;
}

/**
 * Pinecone API response types
 */
interface PineconeQueryMatch {
	id: string;
	score?: number;
	metadata?: Record<string, unknown>;
}

interface PineconeQueryResponse {
	matches?: PineconeQueryMatch[];
	namespace?: string;
}

interface PineconeDescribeIndexResponse {
	dimension?: number;
	host?: string;
	name?: string;
	metric?: string;
	status?: {
		ready?: boolean;
		state?: string;
	};
}

interface PineconeDescribeStatsResponse {
	namespaces?: Record<string, { recordCount?: number }>;
	dimension?: number;
	indexFullness?: number;
	totalRecordCount?: number;
}

/** Default namespace used by Pinecone */
const PINECONE_DEFAULT_NAMESPACE = "";

/**
 * Client for Pinecone vector database using Obsidian's requestUrl API
 * This avoids Node.js dependencies that aren't available in Obsidian
 */
export class PineconeVectorStore implements IVectorStore {
	private config: PineconeConfig;
	private indexHost: string | null = null;
	private initialized = false;

	constructor(config: PineconeConfig) {
		this.config = {
			namespace: PINECONE_DEFAULT_NAMESPACE,
			...config,
		};
	}

	/**
	 * Get the namespace to use in API requests
	 * Pinecone uses empty string for the default namespace in API calls
	 */
	private getNamespaceForApi(): string {
		return this.config.namespace || PINECONE_DEFAULT_NAMESPACE;
	}

	/**
	 * Get the base API URL for control plane operations
	 */
	private getControlPlaneUrl(): string {
		return "https://api.pinecone.io";
	}

	/**
	 * Get the data plane URL for index operations
	 */
	private getDataPlaneUrl(): string {
		if (!this.indexHost) {
			throw new VectorStoreError(
				"Pinecone index host not initialized. Call initialize() first."
			);
		}
		return `https://${this.indexHost}`;
	}

	/**
	 * Get common headers for API requests
	 */
	private getHeaders(): Record<string, string> {
		return {
			"Api-Key": this.config.apiKey,
			"Content-Type": "application/json",
		};
	}

	/**
	 * Initialize the vector store (discover index host)
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		if (!this.config.apiKey) {
			throw new VectorStoreError("Pinecone API key is required");
		}

		try {
			// Describe the index to get the host URL
			const response = await requestUrl({
				url: `${this.getControlPlaneUrl()}/indexes/${
					this.config.indexName
				}`,
				method: "GET",
				headers: this.getHeaders(),
				throw: false,
			});

			if (response.status === 404) {
				throw new VectorStoreError(
					`Pinecone index '${this.config.indexName}' not found. Please create it in the Pinecone console.`
				);
			}

			if (response.status !== 200) {
				throw new VectorStoreError(
					`Failed to describe Pinecone index: ${response.status} - ${response.text}`,
					response.status
				);
			}

			const indexInfo = response.json as PineconeDescribeIndexResponse;

			if (!indexInfo.host) {
				throw new VectorStoreError(
					"Pinecone index host not found in response"
				);
			}

			this.indexHost = indexInfo.host;
			console.log(
				`[Obi] Connected to Pinecone index: ${this.config.indexName} (dimension: ${indexInfo.dimension}, host: ${this.indexHost})`
			);
			this.initialized = true;
		} catch (e) {
			if (e instanceof VectorStoreError) throw e;
			throw new VectorStoreError(
				`Failed to initialize Pinecone: ${
					e instanceof Error ? e.message : String(e)
				}`
			);
		}
	}

	/**
	 * Add or update documents with their embeddings
	 */
	async upsert(
		chunks: DocumentChunk[],
		embeddings: number[][]
	): Promise<void> {
		if (!this.initialized) {
			await this.initialize();
		}

		if (chunks.length !== embeddings.length) {
			throw new VectorStoreError(
				"Chunks and embeddings arrays must have same length"
			);
		}

		if (chunks.length === 0) return;

		// Prepare vectors for upsert
		const vectors = chunks.map((chunk, i) => ({
			id: chunk.id,
			values: embeddings[i],
			metadata: {
				filePath: chunk.filePath,
				chunkIndex: chunk.chunkIndex,
				headingContext: chunk.headingContext || "",
				tokenCount: chunk.tokenCount,
				content: chunk.content,
			} as ChunkMetadata,
		}));

		// Pinecone recommends batching upserts in groups of 100
		const batchSize = 100;
		for (let i = 0; i < vectors.length; i += batchSize) {
			const batch = vectors.slice(i, i + batchSize);

			try {
				const response = await requestUrl({
					url: `${this.getDataPlaneUrl()}/vectors/upsert`,
					method: "POST",
					headers: this.getHeaders(),
					body: JSON.stringify({
						vectors: batch,
						namespace: this.getNamespaceForApi(),
					}),
					throw: false,
				});

				if (response.status !== 200) {
					throw new VectorStoreError(
						`Failed to upsert to Pinecone: ${response.status} - ${response.text}`,
						response.status
					);
				}
			} catch (e) {
				if (e instanceof VectorStoreError) throw e;
				throw new VectorStoreError(
					`Failed to upsert to Pinecone: ${
						e instanceof Error ? e.message : String(e)
					}`
				);
			}
		}
	}

	/**
	 * Search for similar documents
	 */
	async search(
		queryEmbedding: number[],
		nResults: number = 10
	): Promise<SearchResult[]> {
		if (!this.initialized) {
			await this.initialize();
		}

		try {
			const response = await requestUrl({
				url: `${this.getDataPlaneUrl()}/query`,
				method: "POST",
				headers: this.getHeaders(),
				body: JSON.stringify({
					vector: queryEmbedding,
					topK: nResults,
					includeMetadata: true,
					namespace: this.getNamespaceForApi(),
				}),
				throw: false,
			});

			if (response.status !== 200) {
				throw new VectorStoreError(
					`Pinecone search failed: ${response.status} - ${response.text}`,
					response.status
				);
			}

			const data = response.json as PineconeQueryResponse;
			const results: SearchResult[] = [];

			for (const match of data.matches || []) {
				const metadata = match.metadata as ChunkMetadata | undefined;
				if (!metadata) continue;

				results.push({
					id: match.id,
					filePath: metadata.filePath,
					content: metadata.content,
					score: match.score || 0,
					headingContext: metadata.headingContext || undefined,
				});
			}

			return results;
		} catch (e) {
			if (e instanceof VectorStoreError) throw e;
			throw new VectorStoreError(
				`Pinecone search failed: ${
					e instanceof Error ? e.message : String(e)
				}`
			);
		}
	}

	/**
	 * Delete documents by file path using metadata filter
	 * Note: This only works on pod-based indexes, not serverless
	 */
	async deleteByFilePath(filePath: string): Promise<void> {
		if (!this.initialized) {
			await this.initialize();
		}

		try {
			const response = await requestUrl({
				url: `${this.getDataPlaneUrl()}/vectors/delete`,
				method: "POST",
				headers: this.getHeaders(),
				body: JSON.stringify({
					filter: { filePath: { $eq: filePath } },
					namespace: this.getNamespaceForApi(),
				}),
				throw: false,
			});

			// Serverless indexes don't support filter-based delete
			// In that case, old vectors will be overwritten on next upsert
			if (response.status !== 200) {
				console.warn(
					`[Obi] Pinecone deleteByFilePath failed (may not be supported on serverless): ${response.status}`
				);
			}
		} catch (e) {
			console.warn(
				`[Obi] Pinecone deleteByFilePath failed: ${
					e instanceof Error ? e.message : String(e)
				}`
			);
		}
	}

	/**
	 * Delete all documents in the namespace
	 */
	async clear(): Promise<void> {
		if (!this.initialized) {
			await this.initialize();
		}

		try {
			const response = await requestUrl({
				url: `${this.getDataPlaneUrl()}/vectors/delete`,
				method: "POST",
				headers: this.getHeaders(),
				body: JSON.stringify({
					deleteAll: true,
					namespace: this.getNamespaceForApi(),
				}),
				throw: false,
			});

			if (response.status !== 200) {
				throw new VectorStoreError(
					`Failed to clear Pinecone namespace: ${response.status} - ${response.text}`,
					response.status
				);
			}

			console.log(
				`[Obi] Cleared all vectors from Pinecone namespace: ${
					this.config.namespace || "(default)"
				}`
			);
		} catch (e) {
			if (e instanceof VectorStoreError) throw e;
			throw new VectorStoreError(
				`Failed to clear Pinecone index: ${
					e instanceof Error ? e.message : String(e)
				}`
			);
		}
	}

	/**
	 * Get document count in the index/namespace
	 */
	async count(): Promise<number> {
		if (!this.initialized) {
			await this.initialize();
		}

		try {
			const response = await requestUrl({
				url: `${this.getDataPlaneUrl()}/describe_index_stats`,
				method: "POST",
				headers: this.getHeaders(),
				body: JSON.stringify({}),
				throw: false,
			});

			if (response.status !== 200) {
				console.warn(
					`[Obi] Failed to get Pinecone stats: ${response.status}`
				);
				return 0;
			}

			const stats = response.json as PineconeDescribeStatsResponse;

			// Get count for the configured namespace
			// Default namespace appears as "" in the stats response
			const namespaceKey = this.getNamespaceForApi();
			const namespaceStats = stats.namespaces?.[namespaceKey];

			if (namespaceStats) {
				return namespaceStats.recordCount || 0;
			}

			// If no namespace specified or namespace not found, return total
			if (!this.config.namespace) {
				return stats.totalRecordCount || 0;
			}

			return 0;
		} catch (e) {
			console.warn(`[Obi] Failed to get Pinecone count: ${e}`);
			return 0;
		}
	}

	/**
	 * Test connection to Pinecone
	 */
	async testConnection(): Promise<boolean> {
		try {
			console.log(
				`[Obi] Testing Pinecone connection to index: ${this.config.indexName}`
			);

			if (!this.config.apiKey) {
				console.warn("[Obi] Pinecone API key not configured");
				return false;
			}

			// Describe the index to verify connection
			const response = await requestUrl({
				url: `${this.getControlPlaneUrl()}/indexes/${
					this.config.indexName
				}`,
				method: "GET",
				headers: this.getHeaders(),
				throw: false,
			});

			if (response.status === 200) {
				const indexInfo =
					response.json as PineconeDescribeIndexResponse;
				console.log(
					`[Obi] Pinecone connection OK - index dimension: ${indexInfo.dimension}`
				);
				return true;
			}

			if (response.status === 404) {
				console.warn(
					`[Obi] Pinecone index '${this.config.indexName}' not found`
				);
				return false;
			}

			console.warn(
				`[Obi] Pinecone connection test failed: ${response.status}`
			);
			return false;
		} catch (e) {
			console.error("[Obi] Pinecone connection test failed:", e);
			return false;
		}
	}

	/**
	 * Update configuration
	 */
	updateConfig(config: Record<string, unknown>): void {
		const pineconeConfig = config as Partial<PineconeConfig>;

		const needsReinit =
			(pineconeConfig.apiKey &&
				pineconeConfig.apiKey !== this.config.apiKey) ||
			(pineconeConfig.indexName &&
				pineconeConfig.indexName !== this.config.indexName);

		this.config = { ...this.config, ...pineconeConfig };

		if (needsReinit) {
			this.indexHost = null;
			this.initialized = false;
		}
	}
}

/**
 * Create a PineconeVectorStore from plugin settings
 */
export function createPineconeVectorStore(settings: {
	pineconeApiKey: string;
	pineconeIndex: string;
	pineconeNamespace: string;
}): PineconeVectorStore {
	return new PineconeVectorStore({
		apiKey: settings.pineconeApiKey,
		indexName: settings.pineconeIndex,
		namespace: settings.pineconeNamespace,
	});
}

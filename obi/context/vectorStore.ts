import { requestUrl } from "obsidian";
import { DocumentChunk } from "./documentChunker";

export interface VectorStoreConfig {
	endpoint: string;
	collectionName: string;
	tenant?: string;
	database?: string;
}

export interface SearchResult {
	id: string;
	filePath: string;
	content: string;
	score: number;
	headingContext?: string;
}

export class VectorStoreError extends Error {
	constructor(
		message: string,
		public statusCode?: number
	) {
		super(message);
		this.name = "VectorStoreError";
	}
}

/**
 * Client for ChromaDB vector database (API v2)
 */
export class VectorStore {
	private config: VectorStoreConfig;
	private collectionId: string | null = null;

	constructor(config: VectorStoreConfig) {
		this.config = {
			tenant: "default_tenant",
			database: "default_database",
			...config,
		};
	}

	/**
	 * Get the base URL for collection operations
	 */
	private getCollectionsUrl(): string {
		return `${this.config.endpoint}/api/v2/tenants/${this.config.tenant}/databases/${this.config.database}/collections`;
	}

	/**
	 * Initialize the collection (create if doesn't exist)
	 */
	async initialize(): Promise<void> {
		try {
			// Try to get existing collection
			const collection = await this.getCollection();
			if (collection) {
				this.collectionId = collection.id;
				console.log(
					`[Obi] Using existing ChromaDB collection: ${this.config.collectionName}`
				);
				return;
			}
		} catch {
			// Collection doesn't exist, will create it
		}

		await this.createCollection();
		console.log(
			`[Obi] Created ChromaDB collection: ${this.config.collectionName}`
		);
	}

	/**
	 * Get collection info by name
	 */
	private async getCollection(): Promise<{ id: string; name: string } | null> {
		try {
			// List all collections and find by name
			const response = await requestUrl({
				url: this.getCollectionsUrl(),
				method: "GET",
				throw: false,
			});

			if (response.status === 200) {
				const collections = response.json;
				if (Array.isArray(collections)) {
					const found = collections.find(
						(c: { name: string; id: string }) =>
							c.name === this.config.collectionName
					);
					if (found) {
						this.collectionId = found.id;
						return found;
					}
				}
			}
			return null;
		} catch {
			return null;
		}
	}

	/**
	 * Create a new collection
	 */
	private async createCollection(): Promise<void> {
		const response = await requestUrl({
			url: this.getCollectionsUrl(),
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: this.config.collectionName,
				metadata: { "hnsw:space": "cosine" },
			}),
			throw: false,
		});

		if (response.status !== 200 && response.status !== 201) {
			throw new VectorStoreError(
				`Failed to create collection: ${response.status} - ${response.text}`,
				response.status
			);
		}

		const data = response.json;
		this.collectionId = data.id;
	}

	/**
	 * Add or update documents with their embeddings
	 */
	async upsert(
		chunks: DocumentChunk[],
		embeddings: number[][]
	): Promise<void> {
		if (!this.collectionId) {
			await this.initialize();
		}

		if (chunks.length !== embeddings.length) {
			throw new VectorStoreError(
				"Chunks and embeddings arrays must have same length"
			);
		}

		if (chunks.length === 0) return;

		const response = await requestUrl({
			url: `${this.config.endpoint}/api/v2/collections/${this.collectionId}/upsert`,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				ids: chunks.map((c) => c.id),
				embeddings: embeddings,
				documents: chunks.map((c) => c.content),
				metadatas: chunks.map((c) => ({
					filePath: c.filePath,
					chunkIndex: c.chunkIndex,
					headingContext: c.headingContext || "",
					tokenCount: c.tokenCount,
				})),
			}),
			throw: false,
		});

		if (response.status !== 200 && response.status !== 201) {
			throw new VectorStoreError(
				`Failed to upsert documents: ${response.status} - ${response.text}`,
				response.status
			);
		}
	}

	/**
	 * Search for similar documents
	 */
	async search(
		queryEmbedding: number[],
		nResults: number = 10
	): Promise<SearchResult[]> {
		if (!this.collectionId) {
			await this.initialize();
		}

		const response = await requestUrl({
			url: `${this.config.endpoint}/api/v2/collections/${this.collectionId}/query`,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				query_embeddings: [queryEmbedding],
				n_results: nResults,
				include: ["documents", "metadatas", "distances"],
			}),
			throw: false,
		});

		if (response.status !== 200) {
			throw new VectorStoreError(
				`Search failed: ${response.status} - ${response.text}`,
				response.status
			);
		}

		const data = response.json;

		// ChromaDB returns nested arrays for batch queries
		const ids = data.ids?.[0] || [];
		const documents = data.documents?.[0] || [];
		const metadatas = data.metadatas?.[0] || [];
		const distances = data.distances?.[0] || [];

		const results: SearchResult[] = [];

		for (let i = 0; i < ids.length; i++) {
			// ChromaDB returns L2 distance for cosine space, convert to similarity
			// For cosine distance: similarity = 1 - distance
			const similarity = 1 - (distances[i] || 0);

			results.push({
				id: ids[i],
				filePath: metadatas[i]?.filePath || "",
				content: documents[i] || "",
				score: similarity,
				headingContext: metadatas[i]?.headingContext || undefined,
			});
		}

		return results;
	}

	/**
	 * Delete documents by file path
	 */
	async deleteByFilePath(filePath: string): Promise<void> {
		if (!this.collectionId) {
			await this.initialize();
		}

		const response = await requestUrl({
			url: `${this.config.endpoint}/api/v2/collections/${this.collectionId}/delete`,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				where: { filePath: filePath },
			}),
			throw: false,
		});

		if (response.status !== 200) {
			// Ignore errors - document might not exist
			console.warn(`[Obi] Failed to delete chunks for ${filePath}`);
		}
	}

	/**
	 * Delete all documents in the collection
	 */
	async clear(): Promise<void> {
		// Delete and recreate collection
		if (this.collectionId) {
			await requestUrl({
				url: `${this.config.endpoint}/api/v2/collections/${this.collectionId}`,
				method: "DELETE",
				throw: false,
			});
		}
		this.collectionId = null;
		await this.initialize();
	}

	/**
	 * Get document count in collection
	 */
	async count(): Promise<number> {
		if (!this.collectionId) {
			await this.initialize();
		}

		const response = await requestUrl({
			url: `${this.config.endpoint}/api/v2/collections/${this.collectionId}/count`,
			method: "GET",
			throw: false,
		});

		if (response.status !== 200) {
			return 0;
		}

		return response.json || 0;
	}

	/**
	 * Test connection to ChromaDB
	 */
	async testConnection(): Promise<boolean> {
		try {
			console.log(`[Obi] Testing ChromaDB at ${this.config.endpoint}`);

			// Try the v2 heartbeat endpoint first
			let response = await requestUrl({
				url: `${this.config.endpoint}/api/v2/heartbeat`,
				method: "GET",
				throw: false,
			});

			if (response.status === 200) {
				console.log("[Obi] ChromaDB v2 heartbeat OK");
				return true;
			}

			// Fall back to v1 heartbeat (some versions)
			response = await requestUrl({
				url: `${this.config.endpoint}/api/v1/heartbeat`,
				method: "GET",
				throw: false,
			});

			if (response.status === 200) {
				console.log("[Obi] ChromaDB v1 heartbeat OK");
				return true;
			}

			// Try root endpoint
			response = await requestUrl({
				url: `${this.config.endpoint}/`,
				method: "GET",
				throw: false,
			});

			if (response.status === 200) {
				console.log("[Obi] ChromaDB root endpoint OK");
				return true;
			}

			console.warn(
				`[Obi] ChromaDB heartbeat failed with status: ${response.status}`
			);
			return false;
		} catch (e) {
			console.error("[Obi] ChromaDB test failed:", e);
			return false;
		}
	}

	/**
	 * Update configuration
	 */
	updateConfig(config: Partial<VectorStoreConfig>) {
		const needsReinit =
			config.collectionName &&
			config.collectionName !== this.config.collectionName;
		this.config = { ...this.config, ...config };
		if (needsReinit) {
			this.collectionId = null;
		}
	}
}

/**
 * Create a VectorStore from plugin settings
 */
export function createVectorStore(settings: {
	chromaEndpoint: string;
	chromaCollection: string;
}): VectorStore {
	return new VectorStore({
		endpoint: settings.chromaEndpoint,
		collectionName: settings.chromaCollection,
	});
}

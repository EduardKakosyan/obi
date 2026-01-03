import { requestUrl } from "obsidian";
import { IEmbeddingClient, EmbeddingClientError } from "../api/types";

export interface LocalEmbeddingClientConfig {
	endpoint: string;
	model: string;
	timeout?: number;
}

// Re-export for backwards compatibility
export { EmbeddingClientError } from "../api/types";

/**
 * Client for generating embeddings via Ollama's API
 */
export class LocalEmbeddingClient implements IEmbeddingClient {
	private config: LocalEmbeddingClientConfig;

	constructor(config: LocalEmbeddingClientConfig) {
		this.config = {
			timeout: 30000, // 30 second default timeout
			...config,
		};
	}

	/**
	 * Generate embedding for a single text
	 */
	async embed(text: string): Promise<number[]> {
		const embeddings = await this.embedBatch([text]);
		return embeddings[0];
	}

	/**
	 * Generate embeddings for multiple texts in batch
	 */
	async embedBatch(texts: string[]): Promise<number[][]> {
		const embeddings: number[][] = [];

		// Ollama processes one at a time, so we batch sequentially
		// but could parallelize with Promise.all for speed
		for (const text of texts) {
			const embedding = await this.embedSingle(text);
			embeddings.push(embedding);
		}

		return embeddings;
	}

	/**
	 * Generate embedding for a single text via Ollama API
	 */
	private async embedSingle(text: string): Promise<number[]> {
		const url = `${this.config.endpoint}/api/embeddings`;

		try {
			const response = await requestUrl({
				url,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: this.config.model,
					prompt: text,
				}),
				throw: false,
			});

			if (response.status !== 200) {
				throw new EmbeddingClientError(
					`Ollama API error: ${response.status}`,
					response.status,
					response.text
				);
			}

			const data = response.json;

			if (!data.embedding || !Array.isArray(data.embedding)) {
				throw new EmbeddingClientError(
					"Invalid embedding response from Ollama"
				);
			}

			return data.embedding;
		} catch (error) {
			if (error instanceof EmbeddingClientError) {
				throw error;
			}

			if (error instanceof Error) {
				throw new EmbeddingClientError(
					`Embedding request failed: ${error.message}`
				);
			}

			throw new EmbeddingClientError("Unknown error during embedding");
		}
	}

	/**
	 * Update client configuration
	 */
	updateConfig(config: Partial<LocalEmbeddingClientConfig>) {
		this.config = { ...this.config, ...config };
	}

	/**
	 * Test connection to Ollama
	 */
	async testConnection(): Promise<boolean> {
		try {
			console.log(
				`[Obi] Testing Ollama at ${this.config.endpoint} with model ${this.config.model}`
			);
			const embedding = await this.embed("test");
			console.log(
				`[Obi] Ollama test successful, embedding dimension: ${embedding.length}`
			);
			return embedding.length > 0;
		} catch (e) {
			console.error("[Obi] Ollama test failed:", e);
			return false;
		}
	}

	/**
	 * Get the embedding dimension (useful for vector DB setup)
	 */
	async getEmbeddingDimension(): Promise<number> {
		const embedding = await this.embed("test");
		return embedding.length;
	}
}

/**
 * Backwards compatibility alias
 */
export const EmbeddingClient = LocalEmbeddingClient;

/**
 * Create a LocalEmbeddingClient from plugin settings
 */
export function createEmbeddingClient(settings: {
	embeddingEndpoint: string;
	embeddingModel: string;
}): LocalEmbeddingClient {
	return new LocalEmbeddingClient({
		endpoint: settings.embeddingEndpoint,
		model: settings.embeddingModel,
	});
}

/**
 * Create a LocalEmbeddingClient from plugin settings (explicit name)
 */
export function createLocalEmbeddingClient(settings: {
	embeddingEndpoint: string;
	embeddingModel: string;
}): LocalEmbeddingClient {
	return new LocalEmbeddingClient({
		endpoint: settings.embeddingEndpoint,
		model: settings.embeddingModel,
	});
}

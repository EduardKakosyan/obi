import { requestUrl } from "obsidian";
import { IEmbeddingClient, EmbeddingClientError } from "../api/types";

export interface GeminiEmbeddingClientConfig {
	apiKey: string;
	model: string;
	timeout?: number;
	/**
	 * Output embedding dimension. Can only TRUNCATE to smaller dimensions.
	 * gemini-embedding-001 outputs 768 dimensions natively.
	 * Leave undefined to use native dimension.
	 */
	outputDimensionality?: number;
}

interface GeminiEmbeddingResponse {
	embedding?: {
		values: number[];
	};
	error?: {
		code: number;
		message: string;
		status: string;
	};
}

interface GeminiBatchEmbeddingResponse {
	embeddings?: Array<{
		values: number[];
	}>;
	error?: {
		code: number;
		message: string;
		status: string;
	};
}

/**
 * Client for generating embeddings via Google's Gemini API
 *
 * Gemini embedding models:
 * - gemini-embedding-001: outputs 768 dimensions natively
 *
 * Note: outputDimensionality can only TRUNCATE embeddings to smaller dimensions,
 * not expand them. If not specified, uses the model's native dimension (768).
 */
export class GeminiEmbeddingClient implements IEmbeddingClient {
	private config: GeminiEmbeddingClientConfig;
	private baseUrl = "https://generativelanguage.googleapis.com/v1beta";
	private cachedDimension: number | null = null;

	constructor(config: GeminiEmbeddingClientConfig) {
		this.config = {
			timeout: 30000, // 30 second default timeout
			// Don't set outputDimensionality by default - use native 768 dimensions
			...config,
			// Use provided model or default to gemini-embedding-001
			model: config.model || "gemini-embedding-001",
		};
	}

	/**
	 * Generate embedding for a single text
	 */
	async embed(text: string): Promise<number[]> {
		const url = `${this.baseUrl}/models/${this.config.model}:embedContent?key=${this.config.apiKey}`;

		try {
			const requestBody: Record<string, unknown> = {
				model: `models/${this.config.model}`,
				content: {
					parts: [{ text }],
				},
				taskType: "RETRIEVAL_DOCUMENT",
			};

			// Add output dimensionality if configured
			if (this.config.outputDimensionality) {
				requestBody.outputDimensionality =
					this.config.outputDimensionality;
			}

			const response = await requestUrl({
				url,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(requestBody),
				throw: false,
			});

			if (response.status !== 200) {
				const errorData = response.json as GeminiEmbeddingResponse;
				const errorMessage =
					errorData?.error?.message ||
					response.text ||
					"Unknown error";
				throw new EmbeddingClientError(
					`Gemini Embedding API error: ${errorMessage}`,
					response.status,
					response.text
				);
			}

			const data: GeminiEmbeddingResponse = response.json;

			if (
				!data.embedding?.values ||
				!Array.isArray(data.embedding.values)
			) {
				throw new EmbeddingClientError(
					"Invalid embedding response from Gemini"
				);
			}

			// Cache dimension for future reference
			if (this.cachedDimension === null) {
				this.cachedDimension = data.embedding.values.length;
			}

			return data.embedding.values;
		} catch (error) {
			if (error instanceof EmbeddingClientError) {
				throw error;
			}

			if (error instanceof Error) {
				throw new EmbeddingClientError(
					`Gemini embedding request failed: ${error.message}`
				);
			}

			throw new EmbeddingClientError("Unknown error during embedding");
		}
	}

	/**
	 * Generate embeddings for multiple texts in batch
	 * Gemini supports batch embedding via batchEmbedContents
	 */
	async embedBatch(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];

		// For small batches, use single requests (more reliable)
		if (texts.length <= 5) {
			const embeddings: number[][] = [];
			for (const text of texts) {
				const embedding = await this.embed(text);
				embeddings.push(embedding);
			}
			return embeddings;
		}

		// For larger batches, use batch API
		const url = `${this.baseUrl}/models/${this.config.model}:batchEmbedContents?key=${this.config.apiKey}`;

		try {
			const requests = texts.map((text) => {
				const req: Record<string, unknown> = {
					model: `models/${this.config.model}`,
					content: {
						parts: [{ text }],
					},
					taskType: "RETRIEVAL_DOCUMENT",
				};
				if (this.config.outputDimensionality) {
					req.outputDimensionality = this.config.outputDimensionality;
				}
				return req;
			});

			const response = await requestUrl({
				url,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ requests }),
				throw: false,
			});

			if (response.status !== 200) {
				const errorData = response.json as GeminiBatchEmbeddingResponse;
				const errorMessage =
					errorData?.error?.message ||
					response.text ||
					"Unknown error";
				throw new EmbeddingClientError(
					`Gemini Batch Embedding API error: ${errorMessage}`,
					response.status,
					response.text
				);
			}

			const data: GeminiBatchEmbeddingResponse = response.json;

			if (!data.embeddings || !Array.isArray(data.embeddings)) {
				throw new EmbeddingClientError(
					"Invalid batch embedding response from Gemini"
				);
			}

			const embeddings = data.embeddings.map((e) => e.values);

			// Cache dimension
			if (this.cachedDimension === null && embeddings.length > 0) {
				this.cachedDimension = embeddings[0].length;
			}

			return embeddings;
		} catch (error) {
			if (error instanceof EmbeddingClientError) {
				throw error;
			}

			// Fall back to sequential embedding on batch failure
			console.warn(
				"[Obi] Gemini batch embedding failed, falling back to sequential:",
				error
			);
			const embeddings: number[][] = [];
			for (const text of texts) {
				const embedding = await this.embed(text);
				embeddings.push(embedding);
			}
			return embeddings;
		}
	}

	/**
	 * Update client configuration
	 */
	updateConfig(config: Partial<GeminiEmbeddingClientConfig>) {
		const modelChanged = config.model && config.model !== this.config.model;
		this.config = { ...this.config, ...config };

		// Reset cached dimension if model changed
		if (modelChanged) {
			this.cachedDimension = null;
		}
	}

	/**
	 * Test connection to Gemini API
	 */
	async testConnection(): Promise<boolean> {
		try {
			console.log(
				`[Obi] Testing Gemini embeddings with model ${this.config.model}`
			);
			const embedding = await this.embed("test");
			console.log(
				`[Obi] Gemini embedding test successful, dimension: ${embedding.length}`
			);
			return embedding.length > 0;
		} catch (e) {
			console.error("[Obi] Gemini embedding test failed:", e);
			return false;
		}
	}

	/**
	 * Get the embedding dimension
	 */
	async getEmbeddingDimension(): Promise<number> {
		if (this.cachedDimension !== null) {
			return this.cachedDimension;
		}
		const embedding = await this.embed("test");
		return embedding.length;
	}
}

/**
 * Create a GeminiEmbeddingClient from plugin settings
 * Note: Uses native embedding dimension (768 for gemini-embedding-001)
 */
export function createGeminiEmbeddingClient(settings: {
	geminiApiKey: string;
	geminiEmbeddingModel: string;
}): GeminiEmbeddingClient {
	return new GeminiEmbeddingClient({
		apiKey: settings.geminiApiKey,
		model: settings.geminiEmbeddingModel,
		// Don't pass outputDimensionality - use native 768 dimensions
	});
}

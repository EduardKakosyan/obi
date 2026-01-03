import { App } from "obsidian";
import { IEmbeddingClient } from "../api/types";
import { IVectorStore, SearchResult } from "./vectorStoreTypes";
import { IndexManager } from "./indexManager";
import { ContextSnippet } from "../types";

export interface SemanticSearchConfig {
	/** Maximum number of results to return */
	maxResults: number;
	/** Minimum similarity score (0-1) */
	minScore: number;
	/** Maximum tokens in context */
	maxContextTokens: number;
}

const DEFAULT_CONFIG: SemanticSearchConfig = {
	maxResults: 10,
	minScore: 0.3,
	maxContextTokens: 4000,
};

/**
 * Orchestrates semantic search using embeddings and vector store
 */
export class SemanticSearch {
	private app: App;
	private embeddingClient: IEmbeddingClient;
	private vectorStore: IVectorStore;
	private indexManager: IndexManager;
	private config: SemanticSearchConfig;

	constructor(
		app: App,
		embeddingClient: IEmbeddingClient,
		vectorStore: IVectorStore,
		indexManager: IndexManager,
		config: Partial<SemanticSearchConfig> = {}
	) {
		this.app = app;
		this.embeddingClient = embeddingClient;
		this.vectorStore = vectorStore;
		this.indexManager = indexManager;
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Search for relevant context based on query
	 * Indexes any changed files before searching
	 */
	async search(query: string): Promise<ContextSnippet[]> {
		// First, ensure any changed files are indexed
		const changedFiles = this.indexManager.getChangedFiles();
		if (changedFiles.length > 0) {
			console.log(
				`[Obi] Indexing ${changedFiles.length} changed files before search`
			);
			await this.indexManager.indexChangedFiles();
		}

		// Generate embedding for query
		const queryEmbedding = await this.embeddingClient.embed(query);

		// Search vector store
		const results = await this.vectorStore.search(
			queryEmbedding,
			this.config.maxResults * 2 // Get more results to filter
		);

		// Filter by minimum score and deduplicate by file
		const filteredResults = this.filterAndDeduplicate(results);

		// Convert to ContextSnippets
		return this.toContextSnippets(filteredResults);
	}

	/**
	 * Search with pre-specified files to ensure are indexed
	 * Used when user mentions specific files via @[[filename]]
	 */
	async searchWithMentions(
		query: string,
		mentionedFilePaths: string[]
	): Promise<ContextSnippet[]> {
		// Ensure mentioned files are indexed
		if (mentionedFilePaths.length > 0) {
			await this.indexManager.ensureFilesIndexed(mentionedFilePaths);
		}

		// Also index any other changed files
		const changedFiles = this.indexManager.getChangedFiles();
		if (changedFiles.length > 0) {
			await this.indexManager.indexChangedFiles();
		}

		// Generate embedding for query
		const queryEmbedding = await this.embeddingClient.embed(query);

		// Search vector store
		const results = await this.vectorStore.search(
			queryEmbedding,
			this.config.maxResults * 2
		);

		// Filter and deduplicate
		const filteredResults = this.filterAndDeduplicate(results);

		// Boost mentioned files to the top
		const mentionedSet = new Set(mentionedFilePaths);
		filteredResults.sort((a, b) => {
			const aIsMentioned = mentionedSet.has(a.filePath);
			const bIsMentioned = mentionedSet.has(b.filePath);
			if (aIsMentioned && !bIsMentioned) return -1;
			if (!aIsMentioned && bIsMentioned) return 1;
			return b.score - a.score;
		});

		return this.toContextSnippets(filteredResults);
	}

	/**
	 * Filter results by score and deduplicate chunks from same file
	 */
	private filterAndDeduplicate(results: SearchResult[]): SearchResult[] {
		// Filter by minimum score
		const filtered = results.filter((r) => r.score >= this.config.minScore);

		// Group by file and keep best chunks per file
		const byFile = new Map<string, SearchResult[]>();
		for (const result of filtered) {
			const existing = byFile.get(result.filePath) || [];
			existing.push(result);
			byFile.set(result.filePath, existing);
		}

		// For each file, keep up to 2 best chunks
		const deduplicated: SearchResult[] = [];
		for (const [, chunks] of byFile) {
			chunks.sort((a, b) => b.score - a.score);
			deduplicated.push(...chunks.slice(0, 2));
		}

		// Sort by score and take top results
		deduplicated.sort((a, b) => b.score - a.score);
		return deduplicated.slice(0, this.config.maxResults);
	}

	/**
	 * Convert search results to context snippets
	 */
	private toContextSnippets(results: SearchResult[]): ContextSnippet[] {
		let totalTokens = 0;
		const snippets: ContextSnippet[] = [];

		for (const result of results) {
			const tokenCount = Math.ceil(result.content.length / 4);

			if (totalTokens + tokenCount > this.config.maxContextTokens) {
				// Truncate content to fit
				const remainingTokens =
					this.config.maxContextTokens - totalTokens;
				if (remainingTokens > 100) {
					const truncatedContent = result.content.slice(
						0,
						remainingTokens * 4
					);
					snippets.push({
						filePath: result.filePath,
						content: truncatedContent + " [...]",
						score: result.score,
					});
				}
				break;
			}

			snippets.push({
				filePath: result.filePath,
				content: result.content,
				score: result.score,
			});

			totalTokens += tokenCount;
		}

		return snippets;
	}

	/**
	 * Format context snippets for LLM prompt
	 */
	formatContextForPrompt(snippets: ContextSnippet[]): string {
		if (snippets.length === 0) {
			return "";
		}

		const parts = [
			"Here are relevant excerpts from the user's vault (retrieved via semantic search):\n",
		];

		// Group snippets by file for cleaner output
		const byFile = new Map<string, ContextSnippet[]>();
		for (const snippet of snippets) {
			const existing = byFile.get(snippet.filePath) || [];
			existing.push(snippet);
			byFile.set(snippet.filePath, existing);
		}

		for (const [filePath, fileSnippets] of byFile) {
			parts.push(`--- ${filePath} ---`);
			for (const snippet of fileSnippets) {
				parts.push(snippet.content);
				parts.push("");
			}
		}

		parts.push(
			"Use the above context to help answer the user's question. If the context doesn't contain relevant information, you can still answer based on your general knowledge, but let the user know."
		);

		return parts.join("\n");
	}

	/**
	 * Update configuration
	 */
	updateConfig(config: Partial<SemanticSearchConfig>): void {
		this.config = { ...this.config, ...config };
	}

	/**
	 * Test if semantic search is available
	 */
	async isAvailable(): Promise<boolean> {
		try {
			const [embeddingOk, vectorOk] = await Promise.all([
				this.embeddingClient.testConnection(),
				this.vectorStore.testConnection(),
			]);
			return embeddingOk && vectorOk;
		} catch {
			return false;
		}
	}
}

/**
 * Create a SemanticSearch instance
 */
export function createSemanticSearch(
	app: App,
	embeddingClient: IEmbeddingClient,
	vectorStore: IVectorStore,
	indexManager: IndexManager,
	config: Partial<SemanticSearchConfig> = {}
): SemanticSearch {
	return new SemanticSearch(
		app,
		embeddingClient,
		vectorStore,
		indexManager,
		config
	);
}

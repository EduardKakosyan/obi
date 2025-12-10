import { App, TFile } from "obsidian";
import { ContextSnippet } from "../types";

export interface VaultContextConfig {
	maxFiles: number;
	maxTokens: number;
}

/**
 * Rough token estimation (1 token ≈ 4 characters for English text)
 */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/**
 * Extract keywords from a query for simple relevance scoring
 */
function extractKeywords(query: string): string[] {
	// Remove common stop words and split into keywords
	const stopWords = new Set([
		"a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
		"have", "has", "had", "do", "does", "did", "will", "would", "could",
		"should", "may", "might", "must", "shall", "can", "need", "dare",
		"ought", "used", "to", "of", "in", "for", "on", "with", "at", "by",
		"from", "as", "into", "through", "during", "before", "after", "above",
		"below", "between", "under", "again", "further", "then", "once", "here",
		"there", "when", "where", "why", "how", "all", "each", "few", "more",
		"most", "other", "some", "such", "no", "nor", "not", "only", "own",
		"same", "so", "than", "too", "very", "just", "and", "but", "if", "or",
		"because", "until", "while", "what", "which", "who", "whom", "this",
		"that", "these", "those", "am", "i", "me", "my", "myself", "we", "our",
		"ours", "ourselves", "you", "your", "yours", "yourself", "yourselves",
		"he", "him", "his", "himself", "she", "her", "hers", "herself", "it",
		"its", "itself", "they", "them", "their", "theirs", "themselves",
	]);

	return query
		.toLowerCase()
		.replace(/[^\w\s]/g, " ")
		.split(/\s+/)
		.filter((word) => word.length > 2 && !stopWords.has(word));
}

/**
 * Calculate relevance score based on keyword matches
 */
function calculateScore(
	content: string,
	fileName: string,
	keywords: string[]
): number {
	if (keywords.length === 0) return 0;

	const lowerContent = content.toLowerCase();
	const lowerFileName = fileName.toLowerCase();

	let score = 0;

	for (const keyword of keywords) {
		// Count occurrences in content
		const contentMatches = (
			lowerContent.match(new RegExp(keyword, "g")) || []
		).length;
		score += contentMatches;

		// Bonus for filename matches
		if (lowerFileName.includes(keyword)) {
			score += 5;
		}
	}

	// Normalize by content length to avoid bias toward long documents
	const lengthFactor = Math.log10(content.length + 1);
	return score / Math.max(lengthFactor, 1);
}

/**
 * Trim content to fit within token budget
 */
function trimToTokenBudget(content: string, maxTokens: number): string {
	const estimatedTokens = estimateTokens(content);

	if (estimatedTokens <= maxTokens) {
		return content;
	}

	// Approximate character limit based on token budget
	const charLimit = maxTokens * 4;
	const trimmed = content.slice(0, charLimit);

	// Try to end at a sentence or paragraph boundary
	const lastParagraph = trimmed.lastIndexOf("\n\n");
	const lastSentence = trimmed.lastIndexOf(". ");

	if (lastParagraph > charLimit * 0.7) {
		return trimmed.slice(0, lastParagraph) + "\n\n[...]";
	}
	if (lastSentence > charLimit * 0.7) {
		return trimmed.slice(0, lastSentence + 1) + " [...]";
	}

	return trimmed + " [...]";
}

/**
 * Provides context from vault files for the chat assistant
 */
export class VaultContextProvider {
	private app: App;
	private config: VaultContextConfig;

	constructor(app: App, config: VaultContextConfig) {
		this.app = app;
		this.config = config;
	}

	/**
	 * Update configuration
	 */
	updateConfig(config: Partial<VaultContextConfig>) {
		this.config = { ...this.config, ...config };
	}

	/**
	 * Get all markdown files from the vault
	 */
	getMarkdownFiles(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	/**
	 * Gather relevant context snippets based on a user query
	 */
	async gatherContext(query: string): Promise<ContextSnippet[]> {
		const keywords = extractKeywords(query);
		const files = this.getMarkdownFiles();

		// Score all files
		const scoredFiles: Array<{ file: TFile; score: number; content: string }> =
			[];

		for (const file of files) {
			try {
				const content = await this.app.vault.cachedRead(file);
				const score = calculateScore(content, file.basename, keywords);

				scoredFiles.push({ file, score, content });
			} catch {
				// Skip files that can't be read
				continue;
			}
		}

		// Sort by score descending, then by modification time as tiebreaker
		scoredFiles.sort((a, b) => {
			if (b.score !== a.score) {
				return b.score - a.score;
			}
			return b.file.stat.mtime - a.file.stat.mtime;
		});

		// Take top N files
		const topFiles = scoredFiles.slice(0, this.config.maxFiles);

		// Distribute token budget across files
		const tokensPerFile = Math.floor(
			this.config.maxTokens / Math.max(topFiles.length, 1)
		);

		// Build context snippets
		const snippets: ContextSnippet[] = [];

		for (const { file, score, content } of topFiles) {
			const trimmedContent = trimToTokenBudget(content, tokensPerFile);

			snippets.push({
				filePath: file.path,
				content: trimmedContent,
				score,
			});
		}

		return snippets;
	}

	/**
	 * Format context snippets into a system message for the LLM
	 */
	formatContextForPrompt(snippets: ContextSnippet[]): string {
		if (snippets.length === 0) {
			return "";
		}

		const parts = [
			"Here are relevant notes from the user's vault that may help answer their question:\n",
		];

		for (const snippet of snippets) {
			parts.push(`--- ${snippet.filePath} ---`);
			parts.push(snippet.content);
			parts.push("");
		}

		parts.push(
			"Use the above context to help answer the user's question. If the context doesn't contain relevant information, you can still answer based on your general knowledge, but let the user know."
		);

		return parts.join("\n");
	}
}

/**
 * Create a VaultContextProvider from plugin settings
 */
export function createVaultContextProvider(
	app: App,
	settings: { maxContextFiles: number; maxContextTokens: number }
): VaultContextProvider {
	return new VaultContextProvider(app, {
		maxFiles: settings.maxContextFiles,
		maxTokens: settings.maxContextTokens,
	});
}

// Export utility functions for testing
export const _testing = {
	extractKeywords,
	calculateScore,
	trimToTokenBudget,
	estimateTokens,
};


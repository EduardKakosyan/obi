export interface DocumentChunk {
	/** Unique ID for this chunk (filePath + chunkIndex) */
	id: string;
	/** Source file path */
	filePath: string;
	/** Chunk index within the file */
	chunkIndex: number;
	/** The actual text content */
	content: string;
	/** Estimated token count */
	tokenCount: number;
	/** Optional heading context */
	headingContext?: string;
}

export interface ChunkerConfig {
	/** Target chunk size in tokens (approximate) */
	targetChunkSize: number;
	/** Overlap between chunks in tokens */
	chunkOverlap: number;
	/** Minimum chunk size (won't create smaller chunks) */
	minChunkSize: number;
}

const DEFAULT_CONFIG: ChunkerConfig = {
	targetChunkSize: 500,
	chunkOverlap: 50,
	minChunkSize: 100,
};

/**
 * Estimate token count (rough approximation: 1 token ≈ 4 chars for English)
 */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/**
 * Extract heading hierarchy from markdown content
 */
function extractHeadingContext(
	content: string,
	position: number
): string | undefined {
	const lines = content.slice(0, position).split("\n");
	const headings: string[] = [];

	for (const line of lines) {
		const match = line.match(/^(#{1,6})\s+(.+)$/);
		if (match) {
			const level = match[1].length;
			const title = match[2].trim();

			// Keep track of heading hierarchy
			// Remove any headings at same or lower level
			while (
				headings.length > 0 &&
				headings[headings.length - 1].startsWith("#".repeat(level))
			) {
				headings.pop();
			}
			headings.push(`${"#".repeat(level)} ${title}`);
		}
	}

	return headings.length > 0 ? headings.join(" > ") : undefined;
}

/**
 * Split text by natural boundaries (paragraphs, then sentences)
 */
function splitByBoundaries(text: string): string[] {
	// First try to split by double newlines (paragraphs)
	const paragraphs = text.split(/\n\n+/);

	const segments: string[] = [];

	for (const para of paragraphs) {
		const trimmed = para.trim();
		if (!trimmed) continue;

		// If paragraph is still too long, split by sentences
		if (estimateTokens(trimmed) > DEFAULT_CONFIG.targetChunkSize * 1.5) {
			const sentences = trimmed.split(/(?<=[.!?])\s+/);
			segments.push(...sentences.filter((s) => s.trim()));
		} else {
			segments.push(trimmed);
		}
	}

	return segments;
}

/**
 * Smart document chunker for semantic search
 */
export class DocumentChunker {
	private config: ChunkerConfig;

	constructor(config: Partial<ChunkerConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Chunk a document into semantic segments
	 */
	chunkDocument(filePath: string, content: string): DocumentChunk[] {
		const chunks: DocumentChunk[] = [];
		const segments = splitByBoundaries(content);

		let currentChunk = "";
		let currentTokens = 0;
		let chunkIndex = 0;
		let positionInDoc = 0;

		for (const segment of segments) {
			const segmentTokens = estimateTokens(segment);

			// If adding this segment would exceed target, save current chunk
			if (
				currentTokens > 0 &&
				currentTokens + segmentTokens > this.config.targetChunkSize
			) {
				if (currentTokens >= this.config.minChunkSize) {
					chunks.push({
						id: `${filePath}#${chunkIndex}`,
						filePath,
						chunkIndex,
						content: currentChunk.trim(),
						tokenCount: currentTokens,
						headingContext: extractHeadingContext(
							content,
							positionInDoc
						),
					});
					chunkIndex++;
				}

				// Start new chunk with overlap
				const overlapText = this.getOverlapText(currentChunk);
				currentChunk = overlapText ? overlapText + "\n\n" + segment : segment;
				currentTokens = estimateTokens(currentChunk);
			} else {
				// Add segment to current chunk
				currentChunk = currentChunk
					? currentChunk + "\n\n" + segment
					: segment;
				currentTokens += segmentTokens;
			}

			positionInDoc += segment.length;
		}

		// Don't forget the last chunk
		if (currentChunk.trim() && currentTokens >= this.config.minChunkSize) {
			chunks.push({
				id: `${filePath}#${chunkIndex}`,
				filePath,
				chunkIndex,
				content: currentChunk.trim(),
				tokenCount: currentTokens,
				headingContext: extractHeadingContext(content, positionInDoc),
			});
		}

		// If document is too small for chunking, return as single chunk
		if (chunks.length === 0 && content.trim()) {
			chunks.push({
				id: `${filePath}#0`,
				filePath,
				chunkIndex: 0,
				content: content.trim(),
				tokenCount: estimateTokens(content),
			});
		}

		return chunks;
	}

	/**
	 * Get overlap text from the end of a chunk
	 */
	private getOverlapText(text: string): string {
		if (this.config.chunkOverlap <= 0) return "";

		const targetChars = this.config.chunkOverlap * 4; // tokens to chars
		if (text.length <= targetChars) return text;

		// Try to break at a sentence boundary
		const tail = text.slice(-targetChars);
		const sentenceStart = tail.search(/[.!?]\s+[A-Z]/);

		if (sentenceStart > 0) {
			return tail.slice(sentenceStart + 2);
		}

		// Fall back to word boundary
		const wordStart = tail.indexOf(" ");
		return wordStart > 0 ? tail.slice(wordStart + 1) : tail;
	}

	/**
	 * Update configuration
	 */
	updateConfig(config: Partial<ChunkerConfig>) {
		this.config = { ...this.config, ...config };
	}
}

/**
 * Create a DocumentChunker with default settings
 */
export function createDocumentChunker(
	config: Partial<ChunkerConfig> = {}
): DocumentChunker {
	return new DocumentChunker(config);
}




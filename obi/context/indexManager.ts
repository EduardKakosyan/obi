import { App, TFile } from "obsidian";
import { IEmbeddingClient } from "../api/types";
import { IVectorStore } from "./vectorStoreTypes";
import { DocumentChunker, DocumentChunk } from "./documentChunker";

export interface IndexState {
	/** Map of file path -> last indexed mtime */
	fileModTimes: Record<string, number>;
	/** Last full index timestamp */
	lastFullIndex: number;
	/** Index version (for future migrations) */
	version: number;
}

export interface IndexManagerConfig {
	/** Batch size for embedding generation */
	batchSize: number;
	/** Interval for periodic indexing (ms) */
	indexInterval: number;
}

const DEFAULT_CONFIG: IndexManagerConfig = {
	batchSize: 10,
	indexInterval: 60 * 60 * 1000, // 1 hour
};

const INDEX_STATE_KEY = "obi-index-state";
const INDEX_VERSION = 1;

/**
 * Manages smart document indexing for semantic search
 *
 * Features:
 * - Tracks file modification times to avoid re-indexing unchanged files
 * - Indexes on startup
 * - Indexes periodically (hourly)
 * - Indexes changed files on-demand before queries
 */
export class IndexManager {
	private app: App;
	private embeddingClient: IEmbeddingClient;
	private vectorStore: IVectorStore;
	private chunker: DocumentChunker;
	private config: IndexManagerConfig;
	private state: IndexState;
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private isIndexing = false;
	private indexingProgress: { current: number; total: number } | null = null;

	constructor(
		app: App,
		embeddingClient: IEmbeddingClient,
		vectorStore: IVectorStore,
		chunker: DocumentChunker,
		config: Partial<IndexManagerConfig> = {}
	) {
		this.app = app;
		this.embeddingClient = embeddingClient;
		this.vectorStore = vectorStore;
		this.chunker = chunker;
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.state = {
			fileModTimes: {},
			lastFullIndex: 0,
			version: INDEX_VERSION,
		};
	}

	/**
	 * Initialize the index manager - load state and start periodic indexing
	 */
	async initialize(): Promise<void> {
		await this.loadState();
		await this.vectorStore.initialize();
		this.startPeriodicIndexing();
	}

	/**
	 * Shutdown - stop periodic indexing and save state
	 */
	async shutdown(): Promise<void> {
		this.stopPeriodicIndexing();
		await this.saveState();
	}

	/**
	 * Load persisted index state
	 */
	private async loadState(): Promise<void> {
		try {
			const stored = localStorage.getItem(INDEX_STATE_KEY);
			if (stored) {
				const parsed = JSON.parse(stored);
				if (parsed.version === INDEX_VERSION) {
					this.state = parsed;
				}
			}
		} catch (e) {
			console.warn("[Obi] Failed to load index state:", e);
		}
	}

	/**
	 * Save index state to localStorage
	 */
	private async saveState(): Promise<void> {
		try {
			localStorage.setItem(INDEX_STATE_KEY, JSON.stringify(this.state));
		} catch (e) {
			console.warn("[Obi] Failed to save index state:", e);
		}
	}

	/**
	 * Start periodic indexing (hourly)
	 */
	private startPeriodicIndexing(): void {
		if (this.intervalId) return;

		this.intervalId = setInterval(() => {
			this.indexChangedFiles().catch((e) =>
				console.error("[Obi] Periodic indexing failed:", e)
			);
		}, this.config.indexInterval);
	}

	/**
	 * Stop periodic indexing
	 */
	private stopPeriodicIndexing(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	/**
	 * Get files that have been modified since last indexing
	 */
	getChangedFiles(): TFile[] {
		const allFiles = this.app.vault.getMarkdownFiles();
		const changed: TFile[] = [];

		for (const file of allFiles) {
			const lastIndexed = this.state.fileModTimes[file.path];
			if (!lastIndexed || file.stat.mtime > lastIndexed) {
				changed.push(file);
			}
		}

		return changed;
	}

	/**
	 * Get files that have been deleted since last indexing
	 */
	getDeletedFiles(): string[] {
		const currentPaths = new Set(
			this.app.vault.getMarkdownFiles().map((f) => f.path)
		);
		const deleted: string[] = [];

		for (const path of Object.keys(this.state.fileModTimes)) {
			if (!currentPaths.has(path)) {
				deleted.push(path);
			}
		}

		return deleted;
	}

	/**
	 * Check if indexing is currently in progress
	 */
	isCurrentlyIndexing(): boolean {
		return this.isIndexing;
	}

	/**
	 * Get current indexing progress
	 */
	getProgress(): { current: number; total: number } | null {
		return this.indexingProgress;
	}

	/**
	 * Index all changed files (smart incremental indexing)
	 */
	async indexChangedFiles(): Promise<number> {
		if (this.isIndexing) {
			console.log("[Obi] Indexing already in progress, skipping");
			return 0;
		}

		this.isIndexing = true;

		try {
			// Handle deleted files first
			const deletedFiles = this.getDeletedFiles();
			for (const path of deletedFiles) {
				await this.vectorStore.deleteByFilePath(path);
				delete this.state.fileModTimes[path];
			}

			if (deletedFiles.length > 0) {
				console.log(
					`[Obi] Removed ${deletedFiles.length} deleted files from index`
				);
			}

			// Get changed files
			const changedFiles = this.getChangedFiles();

			if (changedFiles.length === 0) {
				console.log("[Obi] No files need indexing");
				return 0;
			}

			console.log(`[Obi] Indexing ${changedFiles.length} changed files`);
			this.indexingProgress = { current: 0, total: changedFiles.length };

			// Process files in batches
			let indexed = 0;
			for (
				let i = 0;
				i < changedFiles.length;
				i += this.config.batchSize
			) {
				const batch = changedFiles.slice(i, i + this.config.batchSize);
				await this.indexFiles(batch);
				indexed += batch.length;
				this.indexingProgress = {
					current: indexed,
					total: changedFiles.length,
				};
			}

			this.state.lastFullIndex = Date.now();
			await this.saveState();

			console.log(`[Obi] Indexed ${indexed} files`);
			return indexed;
		} finally {
			this.isIndexing = false;
			this.indexingProgress = null;
		}
	}

	/**
	 * Index specific files (used for pre-query indexing of relevant files)
	 */
	async indexFiles(files: TFile[]): Promise<void> {
		const allChunks: DocumentChunk[] = [];

		// Chunk all files
		for (const file of files) {
			try {
				const content = await this.app.vault.cachedRead(file);
				const chunks = this.chunker.chunkDocument(file.path, content);
				allChunks.push(...chunks);

				// Update state
				this.state.fileModTimes[file.path] = file.stat.mtime;
			} catch (e) {
				console.warn(`[Obi] Failed to read file ${file.path}:`, e);
			}
		}

		if (allChunks.length === 0) return;

		// Generate embeddings in batches
		const embeddings: number[][] = [];
		for (let i = 0; i < allChunks.length; i += this.config.batchSize) {
			const batch = allChunks.slice(i, i + this.config.batchSize);
			const batchEmbeddings = await this.embeddingClient.embedBatch(
				batch.map((c) => c.content)
			);
			embeddings.push(...batchEmbeddings);
		}

		// First delete old chunks for these files
		for (const file of files) {
			await this.vectorStore.deleteByFilePath(file.path);
		}

		// Upsert to vector store
		await this.vectorStore.upsert(allChunks, embeddings);
	}

	/**
	 * Index a single file
	 */
	async indexFile(file: TFile): Promise<void> {
		await this.indexFiles([file]);
		await this.saveState();
	}

	/**
	 * Ensure files relevant to a query are indexed before search
	 * Returns true if any files were newly indexed
	 */
	async ensureFilesIndexed(filePaths: string[]): Promise<boolean> {
		const filesToIndex: TFile[] = [];

		for (const path of filePaths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;

			const lastIndexed = this.state.fileModTimes[path];
			if (!lastIndexed || file.stat.mtime > lastIndexed) {
				filesToIndex.push(file);
			}
		}

		if (filesToIndex.length > 0) {
			await this.indexFiles(filesToIndex);
			await this.saveState();
			return true;
		}

		return false;
	}

	/**
	 * Force full reindex of all files
	 */
	async fullReindex(): Promise<number> {
		if (this.isIndexing) {
			throw new Error("Indexing already in progress");
		}

		this.isIndexing = true;

		try {
			// Clear existing index
			await this.vectorStore.clear();
			this.state.fileModTimes = {};

			const allFiles = this.app.vault.getMarkdownFiles();
			console.log(`[Obi] Full reindex of ${allFiles.length} files`);

			this.indexingProgress = { current: 0, total: allFiles.length };

			let indexed = 0;
			for (let i = 0; i < allFiles.length; i += this.config.batchSize) {
				const batch = allFiles.slice(i, i + this.config.batchSize);
				await this.indexFiles(batch);
				indexed += batch.length;
				this.indexingProgress = {
					current: indexed,
					total: allFiles.length,
				};
			}

			this.state.lastFullIndex = Date.now();
			await this.saveState();

			console.log(`[Obi] Full reindex complete: ${indexed} files`);
			return indexed;
		} finally {
			this.isIndexing = false;
			this.indexingProgress = null;
		}
	}

	/**
	 * Get index statistics
	 */
	async getStats(): Promise<{
		totalFiles: number;
		indexedFiles: number;
		changedFiles: number;
		lastFullIndex: Date | null;
		vectorCount: number;
	}> {
		const allFiles = this.app.vault.getMarkdownFiles();
		const changedFiles = this.getChangedFiles();
		const vectorCount = await this.vectorStore.count();

		return {
			totalFiles: allFiles.length,
			indexedFiles: Object.keys(this.state.fileModTimes).length,
			changedFiles: changedFiles.length,
			lastFullIndex: this.state.lastFullIndex
				? new Date(this.state.lastFullIndex)
				: null,
			vectorCount,
		};
	}

	/**
	 * Get detailed status of all files
	 */
	getDetailedFileStatus(): Array<{
		path: string;
		status: "indexed" | "changed" | "new";
		lastIndexed: Date | null;
		lastModified: Date;
	}> {
		const allFiles = this.app.vault.getMarkdownFiles();
		const result: Array<{
			path: string;
			status: "indexed" | "changed" | "new";
			lastIndexed: Date | null;
			lastModified: Date;
		}> = [];

		for (const file of allFiles) {
			const lastIndexedTime = this.state.fileModTimes[file.path];
			const lastModified = new Date(file.stat.mtime);

			let status: "indexed" | "changed" | "new";
			if (!lastIndexedTime) {
				status = "new";
			} else if (file.stat.mtime > lastIndexedTime) {
				status = "changed";
			} else {
				status = "indexed";
			}

			result.push({
				path: file.path,
				status,
				lastIndexed: lastIndexedTime ? new Date(lastIndexedTime) : null,
				lastModified,
			});
		}

		// Sort: new first, then changed, then indexed
		const statusOrder = { new: 0, changed: 1, indexed: 2 };
		result.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

		return result;
	}

	/**
	 * Update configuration
	 */
	updateConfig(config: Partial<IndexManagerConfig>): void {
		const needsRestart =
			config.indexInterval &&
			config.indexInterval !== this.config.indexInterval;

		this.config = { ...this.config, ...config };

		if (needsRestart && this.intervalId) {
			this.stopPeriodicIndexing();
			this.startPeriodicIndexing();
		}
	}
}

/**
 * Create an IndexManager from components
 */
export function createIndexManager(
	app: App,
	embeddingClient: IEmbeddingClient,
	vectorStore: IVectorStore,
	chunker: DocumentChunker,
	config: Partial<IndexManagerConfig> = {}
): IndexManager {
	return new IndexManager(app, embeddingClient, vectorStore, chunker, config);
}

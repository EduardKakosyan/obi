import { Plugin, Notice } from "obsidian";
import { ObiSettings, DEFAULT_SETTINGS, ObiSettingTab } from "./settings";
import { OBI_VIEW_TYPE, ObiChatView } from "./ui/chatView";
import { IndexStatusModal } from "./ui/indexStatusModal";
import {
	EmbeddingClient,
	createEmbeddingClient,
} from "./context/embeddingClient";
import { VectorStore, createVectorStore } from "./context/vectorStore";
import {
	DocumentChunker,
	createDocumentChunker,
} from "./context/documentChunker";
import { IndexManager, createIndexManager } from "./context/indexManager";
import { SemanticSearch, createSemanticSearch } from "./context/semanticSearch";

export default class ObiPlugin extends Plugin {
	settings: ObiSettings;

	// Semantic search components (exposed for settings tab)
	embeddingClient: EmbeddingClient | null = null;
	vectorStore: VectorStore | null = null;
	indexManager: IndexManager | null = null;
	semanticSearch: SemanticSearch | null = null;

	private chunker: DocumentChunker | null = null;

	async onload() {
		await this.loadSettings();

		// Register the chat view
		this.registerView(OBI_VIEW_TYPE, (leaf) => new ObiChatView(leaf, this));

		// Initialize semantic search after layout is ready (vault fully loaded)
		this.app.workspace.onLayoutReady(async () => {
			if (this.settings.useSemanticSearch) {
				await this.initializeSemanticSearch();
			}
		});

		// Add ribbon icon to open chat
		this.addRibbonIcon("message-circle", "Open Obi chat", () => {
			this.activateChatView();
		});

		// Add command to open chat
		this.addCommand({
			id: "open-chat",
			name: "Open chat",
			callback: () => {
				this.activateChatView();
			},
		});

		// Add command to reindex vault
		this.addCommand({
			id: "reindex-vault",
			name: "Reindex vault for semantic search",
			callback: async () => {
				await this.triggerReindex();
			},
		});

		// Add command to show index stats
		this.addCommand({
			id: "index-stats",
			name: "Show index statistics",
			callback: async () => {
				await this.showIndexStats();
			},
		});

		// Add settings tab
		this.addSettingTab(new ObiSettingTab(this.app, this));
	}

	async onunload() {
		// Shutdown index manager (saves state, stops periodic indexing)
		if (this.indexManager) {
			await this.indexManager.shutdown();
		}

		// Clean up view
		this.app.workspace.detachLeavesOfType(OBI_VIEW_TYPE);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);

		// Reinitialize semantic search if settings changed
		if (this.settings.useSemanticSearch && !this.semanticSearch) {
			await this.initializeSemanticSearch();
		} else if (!this.settings.useSemanticSearch && this.semanticSearch) {
			await this.shutdownSemanticSearch();
		} else if (this.settings.useSemanticSearch) {
			// Update existing components with new settings
			this.updateSemanticSearchConfig();
		}
	}

	/**
	 * Initialize semantic search components
	 */
	private async initializeSemanticSearch(): Promise<void> {
		console.log("[Obi] Initializing semantic search...");

		try {
			// Create components
			this.embeddingClient = createEmbeddingClient(this.settings);
			this.vectorStore = createVectorStore(this.settings);
			this.chunker = createDocumentChunker({
				targetChunkSize: this.settings.chunkSize,
				chunkOverlap: this.settings.chunkOverlap,
			});

			this.indexManager = createIndexManager(
				this.app,
				this.embeddingClient,
				this.vectorStore,
				this.chunker
			);

			this.semanticSearch = createSemanticSearch(
				this.app,
				this.embeddingClient,
				this.vectorStore,
				this.indexManager,
				{
					maxResults: this.settings.maxContextFiles,
					minScore: this.settings.minSimilarityScore,
					maxContextTokens: this.settings.maxContextTokens,
				}
			);

			// Initialize index manager (loads state, starts periodic indexing)
			await this.indexManager.initialize();

			// Test connections individually for better error reporting
			console.log("[Obi] Testing Ollama connection...");
			const ollamaOk = await this.embeddingClient.testConnection();
			console.log(
				`[Obi] Ollama connection: ${ollamaOk ? "OK" : "FAILED"}`
			);

			console.log("[Obi] Testing ChromaDB connection...");
			const chromaOk = await this.vectorStore.testConnection();
			console.log(
				`[Obi] ChromaDB connection: ${chromaOk ? "OK" : "FAILED"}`
			);

			if (!ollamaOk || !chromaOk) {
				const failures = [];
				if (!ollamaOk) failures.push("Ollama");
				if (!chromaOk) failures.push("ChromaDB");
				console.warn(
					`[Obi] Semantic search servers not available: ${failures.join(
						", "
					)}`
				);
				new Notice(
					`Obi: ${failures.join(
						" and "
					)} not available. Check your servers.`,
					5000
				);
				return;
			}

			// Index changed files on startup
			const changedCount = await this.indexManager.indexChangedFiles();
			if (changedCount > 0) {
				console.log(`[Obi] Indexed ${changedCount} files on startup`);
			}

			console.log("[Obi] Semantic search initialized successfully");
		} catch (e) {
			console.error("[Obi] Failed to initialize semantic search:", e);
			new Notice(`Obi: Failed to initialize semantic search: ${e}`, 5000);
		}
	}

	/**
	 * Shutdown semantic search components
	 */
	private async shutdownSemanticSearch(): Promise<void> {
		if (this.indexManager) {
			await this.indexManager.shutdown();
		}

		this.embeddingClient = null;
		this.vectorStore = null;
		this.chunker = null;
		this.indexManager = null;
		this.semanticSearch = null;
	}

	/**
	 * Update semantic search configuration
	 */
	private updateSemanticSearchConfig(): void {
		if (this.embeddingClient) {
			this.embeddingClient.updateConfig({
				endpoint: this.settings.embeddingEndpoint,
				model: this.settings.embeddingModel,
			});
		}

		if (this.vectorStore) {
			this.vectorStore.updateConfig({
				endpoint: this.settings.chromaEndpoint,
				collectionName: this.settings.chromaCollection,
			});
		}

		if (this.chunker) {
			this.chunker.updateConfig({
				targetChunkSize: this.settings.chunkSize,
				chunkOverlap: this.settings.chunkOverlap,
			});
		}

		if (this.semanticSearch) {
			this.semanticSearch.updateConfig({
				maxResults: this.settings.maxContextFiles,
				minScore: this.settings.minSimilarityScore,
				maxContextTokens: this.settings.maxContextTokens,
			});
		}
	}

	/**
	 * Trigger a full reindex
	 */
	private async triggerReindex(): Promise<void> {
		if (!this.indexManager) {
			new Notice("Semantic search not initialized");
			return;
		}

		if (this.indexManager.isCurrentlyIndexing()) {
			new Notice("Indexing already in progress");
			return;
		}

		const notice = new Notice("Reindexing vault...", 0);

		try {
			const count = await this.indexManager.fullReindex();
			notice.hide();
			new Notice(`Reindex complete: ${count} files indexed`, 5000);
		} catch (e) {
			notice.hide();
			new Notice(`Reindex failed: ${e}`, 5000);
		}
	}

	/**
	 * Show index statistics in a modal
	 */
	private async showIndexStats(): Promise<void> {
		if (!this.indexManager) {
			new Notice("Semantic search not initialized");
			return;
		}

		try {
			const stats = await this.indexManager.getStats();
			const fileStatuses = this.indexManager.getDetailedFileStatus();

			new IndexStatusModal(this.app, fileStatuses, stats).open();
		} catch (e) {
			new Notice(`Failed to get stats: ${e}`, 5000);
		}
	}

	async activateChatView() {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(OBI_VIEW_TYPE)[0];

		if (!leaf) {
			// Open in right sidebar
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({
					type: OBI_VIEW_TYPE,
					active: true,
				});
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}
}

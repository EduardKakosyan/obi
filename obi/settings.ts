import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type ObiPlugin from "./main";
import { LLMProvider, EmbeddingProvider } from "./api/types";

export interface ObiSettings {
	// Provider Selection
	/** Which LLM provider to use */
	llmProvider: LLMProvider;
	/** Which embedding provider to use */
	embeddingProvider: EmbeddingProvider;

	// Local LLM Settings (LM Studio)
	/** LM Studio API endpoint */
	endpoint: string;
	/** Model identifier to use */
	model: string;
	/** Optional API key for authentication */
	apiKey: string;

	// Gemini Settings
	/** Gemini API key */
	geminiApiKey: string;
	/** Gemini model for chat */
	geminiModel: string;
	/** Gemini model for embeddings */
	geminiEmbeddingModel: string;
	/** Gemini embedding output dimension */
	geminiEmbeddingDimension: number;

	// Context Settings
	/** Maximum number of context files to include */
	maxContextFiles: number;
	/** Maximum tokens for context snippets */
	maxContextTokens: number;
	/** Whether to include vault context in queries */
	enableContext: boolean;

	// Omnisearch Settings
	/** Omnisearch HTTP server port */
	omnisearchPort: number;
	/** Whether to use Omnisearch HTTP server for file search */
	useOmnisearchHttp: boolean;

	// Semantic Search Settings
	/** Whether to use semantic search (embeddings) instead of keyword search */
	useSemanticSearch: boolean;

	// Local Embedding Settings (Ollama)
	/** Ollama endpoint for embeddings */
	embeddingEndpoint: string;
	/** Embedding model to use */
	embeddingModel: string;

	// Vector Store Settings (ChromaDB)
	/** ChromaDB endpoint */
	chromaEndpoint: string;
	/** ChromaDB collection name */
	chromaCollection: string;

	// Search Tuning
	/** Minimum similarity score for search results (0-1) */
	minSimilarityScore: number;
	/** Chunk size for document chunking (tokens) */
	chunkSize: number;
	/** Chunk overlap (tokens) */
	chunkOverlap: number;
}

export const DEFAULT_SETTINGS: ObiSettings = {
	// Provider Selection
	llmProvider: "local",
	embeddingProvider: "local",

	// Local LLM
	endpoint: "http://localhost:1234/v1",
	model: "mistralai/ministral-3-14b-reasoning",
	apiKey: "",

	// Gemini
	geminiApiKey: "",
	geminiModel: "gemini-2.5-flash",
	geminiEmbeddingModel: "gemini-embedding-001",
	geminiEmbeddingDimension: 768, // Native dimension for gemini-embedding-001

	// Context
	maxContextFiles: 5,
	maxContextTokens: 4000,
	enableContext: true,

	// Omnisearch
	omnisearchPort: 51361,
	useOmnisearchHttp: true,

	// Semantic Search
	useSemanticSearch: true,

	// Local Embedding (Ollama)
	embeddingEndpoint: "http://localhost:11434",
	embeddingModel: "mxbai-embed-large",

	// Vector Store (ChromaDB)
	chromaEndpoint: "http://localhost:8000",
	chromaCollection: "obi-vault",

	// Search Tuning
	minSimilarityScore: 0.3,
	chunkSize: 500,
	chunkOverlap: 50,
};

export class ObiSettingTab extends PluginSettingTab {
	plugin: ObiPlugin;

	constructor(app: App, plugin: ObiPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Obi settings" });

		// ============================================
		// Provider Selection
		// ============================================
		containerEl.createEl("h3", { text: "Provider selection" });

		new Setting(containerEl)
			.setName("LLM provider")
			.setDesc(
				"Choose between local (LM Studio) or cloud (Gemini) for chat."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("local", "Local (LM Studio)")
					.addOption("gemini", "Cloud (Gemini)")
					.setValue(this.plugin.settings.llmProvider)
					.onChange(async (value) => {
						this.plugin.settings.llmProvider = value as LLMProvider;
						await this.plugin.saveSettings();
						this.display(); // Refresh to show/hide relevant sections
					})
			);

		new Setting(containerEl)
			.setName("Embedding provider")
			.setDesc(
				"Choose between local (Ollama) or cloud (Gemini) for embeddings."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("local", "Local (Ollama)")
					.addOption("gemini", "Cloud (Gemini)")
					.setValue(this.plugin.settings.embeddingProvider)
					.onChange(async (value) => {
						this.plugin.settings.embeddingProvider =
							value as EmbeddingProvider;
						await this.plugin.saveSettings();
						this.display(); // Refresh to show/hide relevant sections
					})
			);

		// ============================================
		// Gemini Settings (shown when using cloud)
		// ============================================
		const showGeminiSettings =
			this.plugin.settings.llmProvider === "gemini" ||
			this.plugin.settings.embeddingProvider === "gemini";

		if (showGeminiSettings) {
			containerEl.createEl("h3", { text: "Gemini (cloud)" });

			new Setting(containerEl)
				.setName("Gemini API key")
				.setDesc(
					"Your Google AI API key from Google AI Studio (aistudio.google.com)."
				)
				.addText((text) =>
					text
						.setPlaceholder("Enter your Gemini API key")
						.setValue(this.plugin.settings.geminiApiKey)
						.onChange(async (value) => {
							this.plugin.settings.geminiApiKey = value;
							await this.plugin.saveSettings();
						})
				);

			if (this.plugin.settings.llmProvider === "gemini") {
				new Setting(containerEl)
					.setName("Gemini chat model")
					.setDesc(
						"The Gemini model to use for chat (e.g., gemini-3.0-flash, gemini-3.0-pro)."
					)
					.addText((text) =>
						text
							.setPlaceholder("gemini-3.0-flash")
							.setValue(this.plugin.settings.geminiModel)
							.onChange(async (value) => {
								this.plugin.settings.geminiModel = value;
								await this.plugin.saveSettings();
							})
					);
			}

			if (this.plugin.settings.embeddingProvider === "gemini") {
				new Setting(containerEl)
					.setName("Gemini embedding model")
					.setDesc(
						"The Gemini model to use for embeddings. Note: gemini-embedding-001 outputs 768 dimensions."
					)
					.addText((text) =>
						text
							.setPlaceholder("gemini-embedding-001")
							.setValue(this.plugin.settings.geminiEmbeddingModel)
							.onChange(async (value) => {
								this.plugin.settings.geminiEmbeddingModel =
									value;
								await this.plugin.saveSettings();
							})
					);

				// Add warning about dimension mismatch
				const warningEl = containerEl.createDiv({
					cls: "obi-setting-warning",
				});
				warningEl.createEl("p", {
					text: "⚠️ Gemini embeddings are 768 dimensions. If your existing ChromaDB collection uses different dimensions (e.g., 1024 from Ollama), you must use a different collection name or delete the old collection.",
				});
			}

			new Setting(containerEl)
				.setName("Test Gemini connection")
				.setDesc("Test your Gemini API key and model configuration.")
				.addButton((button) =>
					button.setButtonText("Test").onClick(async () => {
						await this.testGeminiConnection();
					})
				);
		}

		// ============================================
		// Local LLM Settings (shown when using local)
		// ============================================
		if (this.plugin.settings.llmProvider === "local") {
			containerEl.createEl("h3", { text: "Local LLM (LM Studio)" });

			new Setting(containerEl)
				.setName("LM Studio endpoint")
				.setDesc(
					"The URL of your local LM Studio server (OpenAI-compatible API)."
				)
				.addText((text) =>
					text
						.setPlaceholder("http://localhost:1234/v1")
						.setValue(this.plugin.settings.endpoint)
						.onChange(async (value) => {
							this.plugin.settings.endpoint = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Model")
				.setDesc("The model identifier to use for chat completions.")
				.addText((text) =>
					text
						.setPlaceholder("mistralai/ministral-3-14b-reasoning")
						.setValue(this.plugin.settings.model)
						.onChange(async (value) => {
							this.plugin.settings.model = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("API key")
				.setDesc(
					"Optional API key if your LM Studio server requires authentication."
				)
				.addText((text) =>
					text
						.setPlaceholder("Leave empty if not required")
						.setValue(this.plugin.settings.apiKey)
						.onChange(async (value) => {
							this.plugin.settings.apiKey = value;
							await this.plugin.saveSettings();
						})
				);
		}

		// ============================================
		// Semantic Search Settings
		// ============================================
		containerEl.createEl("h3", { text: "Semantic search (RAG)" });

		new Setting(containerEl)
			.setName("Enable semantic search")
			.setDesc(
				"Use embedding-based semantic search instead of keyword search."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useSemanticSearch)
					.onChange(async (value) => {
						this.plugin.settings.useSemanticSearch = value;
						await this.plugin.saveSettings();
						this.display(); // Refresh to show/hide embedding settings
					})
			);

		// Local Embedding Settings (only shown when semantic search enabled and using local)
		if (
			this.plugin.settings.useSemanticSearch &&
			this.plugin.settings.embeddingProvider === "local"
		) {
			containerEl.createEl("h4", { text: "Local embeddings (Ollama)" });

			new Setting(containerEl)
				.setName("Ollama endpoint")
				.setDesc("The URL of your local Ollama server for embeddings.")
				.addText((text) =>
					text
						.setPlaceholder("http://localhost:11434")
						.setValue(this.plugin.settings.embeddingEndpoint)
						.onChange(async (value) => {
							this.plugin.settings.embeddingEndpoint = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Embedding model")
				.setDesc(
					"The Ollama model to use for embeddings (e.g., nomic-embed-text, mxbai-embed-large)."
				)
				.addText((text) =>
					text
						.setPlaceholder("nomic-embed-text")
						.setValue(this.plugin.settings.embeddingModel)
						.onChange(async (value) => {
							this.plugin.settings.embeddingModel = value;
							await this.plugin.saveSettings();
						})
				);
		}

		// Vector Store Settings (ChromaDB) - always shown when semantic search enabled
		if (this.plugin.settings.useSemanticSearch) {
			containerEl.createEl("h4", { text: "Vector store (ChromaDB)" });

			new Setting(containerEl)
				.setName("ChromaDB endpoint")
				.setDesc("The URL of your local ChromaDB server.")
				.addText((text) =>
					text
						.setPlaceholder("http://localhost:8000")
						.setValue(this.plugin.settings.chromaEndpoint)
						.onChange(async (value) => {
							this.plugin.settings.chromaEndpoint = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Collection name")
				.setDesc("ChromaDB collection name to store vault embeddings.")
				.addText((text) =>
					text
						.setPlaceholder("obi-vault")
						.setValue(this.plugin.settings.chromaCollection)
						.onChange(async (value) => {
							this.plugin.settings.chromaCollection = value;
							await this.plugin.saveSettings();
						})
				);

			// Search Tuning
			containerEl.createEl("h4", { text: "Search tuning" });

			new Setting(containerEl)
				.setName("Minimum similarity score")
				.setDesc(
					"Minimum similarity score (0-1) for search results. Lower = more results."
				)
				.addSlider((slider) =>
					slider
						.setLimits(0.1, 0.9, 0.05)
						.setValue(this.plugin.settings.minSimilarityScore)
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.plugin.settings.minSimilarityScore = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Chunk size")
				.setDesc(
					"Target size for document chunks in tokens. Smaller = more precise, larger = more context."
				)
				.addSlider((slider) =>
					slider
						.setLimits(200, 1000, 50)
						.setValue(this.plugin.settings.chunkSize)
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.plugin.settings.chunkSize = value;
							await this.plugin.saveSettings();
						})
				);

			// Index Management
			containerEl.createEl("h4", { text: "Index management" });

			new Setting(containerEl)
				.setName("Test connections")
				.setDesc(
					"Test connections to embedding and vector store services."
				)
				.addButton((button) =>
					button.setButtonText("Test").onClick(async () => {
						await this.testConnections();
					})
				);

			new Setting(containerEl)
				.setName("Reindex vault")
				.setDesc(
					"Force a full reindex of all vault files. Use if search results are stale."
				)
				.addButton((button) =>
					button
						.setButtonText("Reindex")
						.setWarning()
						.onClick(async () => {
							await this.triggerReindex();
						})
				);
		}

		// ============================================
		// Context Settings
		// ============================================
		containerEl.createEl("h3", { text: "Context settings" });

		new Setting(containerEl)
			.setName("Enable vault context")
			.setDesc(
				"Include relevant notes from your vault when answering questions."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableContext)
					.onChange(async (value) => {
						this.plugin.settings.enableContext = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Max context files")
			.setDesc("Maximum number of notes to include as context.")
			.addSlider((slider) =>
				slider
					.setLimits(1, 20, 1)
					.setValue(this.plugin.settings.maxContextFiles)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.maxContextFiles = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Max context tokens")
			.setDesc(
				"Approximate maximum tokens to include from context files."
			)
			.addSlider((slider) =>
				slider
					.setLimits(500, 8000, 100)
					.setValue(this.plugin.settings.maxContextTokens)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.maxContextTokens = value;
						await this.plugin.saveSettings();
					})
			);

		// ============================================
		// Omnisearch Settings
		// ============================================
		containerEl.createEl("h3", { text: "Omnisearch (file suggestions)" });

		new Setting(containerEl)
			.setName("Use Omnisearch HTTP server")
			.setDesc(
				"Use Omnisearch's HTTP server for @ file suggestions. Enable the HTTP server in Omnisearch settings first."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useOmnisearchHttp)
					.onChange(async (value) => {
						this.plugin.settings.useOmnisearchHttp = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Omnisearch server port")
			.setDesc(
				"The port Omnisearch HTTP server runs on (default: 51361)."
			)
			.addText((text) =>
				text
					.setPlaceholder("51361")
					.setValue(String(this.plugin.settings.omnisearchPort))
					.onChange(async (value) => {
						const port = parseInt(value, 10);
						if (!isNaN(port) && port > 0 && port < 65536) {
							this.plugin.settings.omnisearchPort = port;
							await this.plugin.saveSettings();
						}
					})
			);
	}

	private async testGeminiConnection(): Promise<void> {
		const notice = new Notice("Testing Gemini connection...", 0);

		try {
			const results: string[] = [];

			// Test Gemini LLM if enabled
			if (this.plugin.settings.llmProvider === "gemini") {
				if (!this.plugin.settings.geminiApiKey) {
					results.push("✗ Gemini LLM (no API key)");
				} else {
					const { GeminiLMClient } = await import(
						"./api/geminiLmClient"
					);
					const client = new GeminiLMClient({
						apiKey: this.plugin.settings.geminiApiKey,
						model: this.plugin.settings.geminiModel,
					});
					const ok = await client.testConnection();
					results.push(ok ? "✓ Gemini LLM" : "✗ Gemini LLM");
				}
			}

			// Test Gemini Embedding if enabled
			if (this.plugin.settings.embeddingProvider === "gemini") {
				if (!this.plugin.settings.geminiApiKey) {
					results.push("✗ Gemini Embeddings (no API key)");
				} else {
					const { GeminiEmbeddingClient } = await import(
						"./context/geminiEmbeddingClient"
					);
					const client = new GeminiEmbeddingClient({
						apiKey: this.plugin.settings.geminiApiKey,
						model: this.plugin.settings.geminiEmbeddingModel,
					});
					const ok = await client.testConnection();
					results.push(
						ok ? "✓ Gemini Embeddings" : "✗ Gemini Embeddings"
					);
				}
			}

			notice.hide();
			new Notice(results.join("\n"), 5000);
		} catch (e) {
			notice.hide();
			new Notice(`Connection test failed: ${e}`, 5000);
		}
	}

	private async testConnections(): Promise<void> {
		const notice = new Notice("Testing connections...", 0);

		try {
			const results: string[] = [];

			// Test Embedding Client
			if (this.plugin.embeddingClient) {
				const embeddingOk =
					await this.plugin.embeddingClient.testConnection();
				const providerName =
					this.plugin.settings.embeddingProvider === "gemini"
						? "Gemini Embeddings"
						: "Ollama";
				results.push(
					embeddingOk ? `✓ ${providerName}` : `✗ ${providerName}`
				);
			} else {
				results.push("✗ Embedding client (not initialized)");
			}

			// Test ChromaDB
			if (this.plugin.vectorStore) {
				const chromaOk = await this.plugin.vectorStore.testConnection();
				results.push(chromaOk ? "✓ ChromaDB" : "✗ ChromaDB");
			} else {
				results.push("✗ ChromaDB (not initialized)");
			}

			notice.hide();
			new Notice(results.join("\n"), 5000);
		} catch (e) {
			notice.hide();
			new Notice(`Connection test failed: ${e}`, 5000);
		}
	}

	private async triggerReindex(): Promise<void> {
		if (!this.plugin.indexManager) {
			new Notice("Index manager not initialized");
			return;
		}

		if (this.plugin.indexManager.isCurrentlyIndexing()) {
			new Notice("Indexing already in progress");
			return;
		}

		const notice = new Notice("Reindexing vault...", 0);

		try {
			const count = await this.plugin.indexManager.fullReindex();
			notice.hide();
			new Notice(`Reindex complete: ${count} files indexed`, 5000);
		} catch (e) {
			notice.hide();
			new Notice(`Reindex failed: ${e}`, 5000);
		}
	}
}

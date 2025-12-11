import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type ObiPlugin from "./main";

export interface ObiSettings {
	/** LM Studio API endpoint */
	endpoint: string;
	/** Model identifier to use */
	model: string;
	/** Optional API key for authentication */
	apiKey: string;
	/** Maximum number of context files to include */
	maxContextFiles: number;
	/** Maximum tokens for context snippets */
	maxContextTokens: number;
	/** Whether to include vault context in queries */
	enableContext: boolean;
	/** Omnisearch HTTP server port */
	omnisearchPort: number;
	/** Whether to use Omnisearch HTTP server for file search */
	useOmnisearchHttp: boolean;

	// Semantic Search Settings
	/** Whether to use semantic search (embeddings) instead of keyword search */
	useSemanticSearch: boolean;
	/** Ollama endpoint for embeddings */
	embeddingEndpoint: string;
	/** Embedding model to use */
	embeddingModel: string;
	/** ChromaDB endpoint */
	chromaEndpoint: string;
	/** ChromaDB collection name */
	chromaCollection: string;
	/** Minimum similarity score for search results (0-1) */
	minSimilarityScore: number;
	/** Chunk size for document chunking (tokens) */
	chunkSize: number;
	/** Chunk overlap (tokens) */
	chunkOverlap: number;
}

export const DEFAULT_SETTINGS: ObiSettings = {
	endpoint: "http://localhost:1234/v1",
	model: "mistralai/ministral-3-14b-reasoning",
	apiKey: "",
	maxContextFiles: 5,
	maxContextTokens: 4000,
	enableContext: true,
	omnisearchPort: 51361,
	useOmnisearchHttp: true,

	// Semantic Search Defaults
	useSemanticSearch: true,
	embeddingEndpoint: "http://localhost:11434",
	embeddingModel: "mxbai-embed-large",
	chromaEndpoint: "http://localhost:8000",
	chromaCollection: "obi-vault",
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

		// LLM Settings
		containerEl.createEl("h3", { text: "Language model" });

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

		// Semantic Search Settings
		containerEl.createEl("h3", { text: "Semantic search (RAG)" });

		new Setting(containerEl)
			.setName("Enable semantic search")
			.setDesc(
				"Use embedding-based semantic search instead of keyword search. Requires Ollama and ChromaDB running locally."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useSemanticSearch)
					.onChange(async (value) => {
						this.plugin.settings.useSemanticSearch = value;
						await this.plugin.saveSettings();
					})
			);

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
		new Setting(containerEl)
			.setName("Test connections")
			.setDesc("Test connections to Ollama and ChromaDB servers.")
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

		// Context Settings
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

		// Omnisearch Settings
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

	private async testConnections(): Promise<void> {
		const notice = new Notice("Testing connections...", 0);

		try {
			const results: string[] = [];

			// Test Ollama
			if (this.plugin.embeddingClient) {
				const ollamaOk =
					await this.plugin.embeddingClient.testConnection();
				results.push(ollamaOk ? "✓ Ollama" : "✗ Ollama");
			} else {
				results.push("✗ Ollama (not initialized)");
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

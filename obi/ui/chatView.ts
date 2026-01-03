import {
	ItemView,
	WorkspaceLeaf,
	setIcon,
	TFile,
	requestUrl,
	MarkdownRenderer,
	Component,
} from "obsidian";
import type ObiPlugin from "../main";
import { ChatMessage } from "../types";
import { ILMClient, LLMClientError, ChatOptions } from "../api/types";
import {
	VaultContextProvider,
	createVaultContextProvider,
} from "../context/vaultContext";
import { ToolCall, ToolResult, LLMResponse } from "../tools/types";
import {
	ToolHandler,
	createToolHandler,
	TOOL_DEFINITIONS,
} from "../tools/handlers";

export const OBI_VIEW_TYPE = "obi-chat-view";

/** Maximum number of tool call rounds to prevent infinite loops */
const MAX_TOOL_ROUNDS = 10;

/** Omnisearch HTTP API response type */
interface OmnisearchHttpResult {
	score: number;
	vault: string;
	path: string;
	basename: string;
	foundWords: string[];
	matches: Array<{ match: string; offset: number }>;
	excerpt: string;
}

interface MentionedFile {
	file: TFile;
	displayName: string;
}

interface FileSuggestion {
	path: string;
	basename: string;
	parentPath: string;
	excerpt?: string;
	score?: number;
}

export class ObiChatView extends ItemView {
	private plugin: ObiPlugin;
	private messages: ChatMessage[] = [];
	private contextProvider: VaultContextProvider;
	private toolHandler: ToolHandler;
	private isLoading = false;

	// DOM elements
	private messagesContainer: HTMLElement;
	private inputContainer: HTMLElement;
	private inputEl: HTMLTextAreaElement;
	private sendButton: HTMLButtonElement;

	// @ mention suggestions
	private suggestionsEl: HTMLElement | null = null;
	private suggestions: FileSuggestion[] = [];
	private selectedSuggestionIndex = 0;
	private mentionStartPos: number | null = null;
	private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ObiPlugin) {
		super(leaf);
		this.plugin = plugin;

		// Initialize context provider
		this.contextProvider = createVaultContextProvider(
			plugin.app,
			plugin.settings
		);

		// Initialize tool handler
		this.toolHandler = createToolHandler(plugin.app);
	}

	/**
	 * Get the LLM client from the plugin (respects provider setting)
	 */
	private getLMClient(): ILMClient | null {
		return this.plugin.lmClient;
	}

	getViewType(): string {
		return OBI_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Obi Chat";
	}

	getIcon(): string {
		return "message-circle";
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("obi-chat-container");

		// Create header
		const header = container.createDiv({ cls: "obi-chat-header" });
		header.createEl("h4", { text: "Obi" });

		const clearBtn = header.createEl("button", {
			cls: "obi-clear-btn",
			attr: { "aria-label": "Clear chat" },
		});
		setIcon(clearBtn, "trash-2");
		this.registerDomEvent(clearBtn, "click", () => this.clearChat());

		// Create messages container
		this.messagesContainer = container.createDiv({
			cls: "obi-messages-container",
		});

		// Create input area wrapper (for positioning suggestions)
		const inputWrapper = container.createDiv({ cls: "obi-input-wrapper" });

		// Create input area
		this.inputContainer = inputWrapper.createDiv({
			cls: "obi-input-container",
		});

		this.inputEl = this.inputContainer.createEl("textarea", {
			cls: "obi-input",
			attr: {
				placeholder: "Ask about your vault... (@ to search files)",
				rows: "1",
			},
		});

		this.sendButton = this.inputContainer.createEl("button", {
			cls: "obi-send-btn",
			attr: { "aria-label": "Send message" },
		});
		setIcon(this.sendButton, "send");

		// Event listeners - use registerDomEvent for proper cleanup
		this.registerDomEvent(this.sendButton, "click", () =>
			this.handleSend()
		);
		this.registerDomEvent(this.inputEl, "keydown", (e) =>
			this.handleKeyDown(e)
		);
		this.registerDomEvent(this.inputEl, "input", () => this.handleInput());

		// Close suggestions when clicking outside
		this.registerDomEvent(document, "click", (e) => {
			if (
				!this.inputContainer.contains(e.target as Node) &&
				!this.suggestionsEl?.contains(e.target as Node)
			) {
				this.hideSuggestions();
			}
		});

		// Render welcome message
		this.renderWelcome();
	}

	async onClose() {
		this.hideSuggestions();
		if (this.searchDebounceTimer) {
			clearTimeout(this.searchDebounceTimer);
		}
	}

	private handleKeyDown(e: KeyboardEvent) {
		// Handle suggestions navigation
		if (this.suggestionsEl && this.suggestions.length > 0) {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				this.selectedSuggestionIndex = Math.min(
					this.selectedSuggestionIndex + 1,
					this.suggestions.length - 1
				);
				this.updateSuggestionsHighlight();
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				this.selectedSuggestionIndex = Math.max(
					this.selectedSuggestionIndex - 1,
					0
				);
				this.updateSuggestionsHighlight();
				return;
			}
			if (e.key === "Enter" || e.key === "Tab") {
				e.preventDefault();
				this.selectSuggestion(
					this.suggestions[this.selectedSuggestionIndex]
				);
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				this.hideSuggestions();
				return;
			}
		}

		// Normal send on Enter
		if (e.key === "Enter" && !e.shiftKey && !this.suggestionsEl) {
			e.preventDefault();
			this.handleSend();
		}
	}

	private handleInput() {
		// Auto-resize textarea
		this.inputEl.style.height = "auto";
		this.inputEl.style.height =
			Math.min(this.inputEl.scrollHeight, 150) + "px";

		// Check for @ mentions with debounce
		this.checkForMentionTrigger();
	}

	private checkForMentionTrigger() {
		const cursorPos = this.inputEl.selectionStart;
		const text = this.inputEl.value;

		// Find the @ symbol before cursor
		let atPos = -1;
		for (let i = cursorPos - 1; i >= 0; i--) {
			const char = text[i];
			if (char === "@") {
				atPos = i;
				break;
			}
			// Stop if we hit a space or newline (no @ in this "word")
			if (char === " " || char === "\n") {
				break;
			}
		}

		if (atPos === -1) {
			this.hideSuggestions();
			return;
		}

		// Get the search query after @
		const searchQuery = text.slice(atPos + 1, cursorPos);
		this.mentionStartPos = atPos;

		// Debounce the search
		if (this.searchDebounceTimer) {
			clearTimeout(this.searchDebounceTimer);
		}

		this.searchDebounceTimer = setTimeout(async () => {
			const filtered = await this.searchFiles(searchQuery);

			if (filtered.length > 0) {
				this.suggestions = filtered;
				this.selectedSuggestionIndex = 0;
				this.showSuggestions();
			} else if (searchQuery.length > 0) {
				// Show "no results" state
				this.suggestions = [];
				this.showNoResults(searchQuery);
			} else {
				this.hideSuggestions();
			}
		}, 150); // 150ms debounce
	}

	/**
	 * Search files using Omnisearch HTTP server
	 */
	private async searchFilesViaHttp(query: string): Promise<FileSuggestion[]> {
		const port = this.plugin.settings.omnisearchPort;
		const url = `http://localhost:${port}/search?q=${encodeURIComponent(
			query
		)}`;

		try {
			// Use Obsidian's requestUrl API for reliable HTTP requests in plugins
			const response = await requestUrl({
				url,
				method: "GET",
				headers: {
					Accept: "application/json",
				},
				throw: false, // Don't throw on non-2xx status
			});

			if (response.status !== 200) {
				console.warn(`[Obi] Omnisearch HTTP error: ${response.status}`);
				return [];
			}

			// Parse the response - requestUrl returns json property directly
			let results: OmnisearchHttpResult[];
			try {
				results = response.json;
			} catch {
				console.warn("[Obi] Omnisearch returned invalid JSON");
				return [];
			}

			// Validate response is an array
			if (!Array.isArray(results)) {
				console.warn(
					"[Obi] Omnisearch response is not an array:",
					typeof results
				);
				return [];
			}

			console.log(
				`[Obi] Omnisearch returned ${results.length} results for "${query}"`
			);

			return results.slice(0, 15).map((result) => {
				const parentPath = result.path.includes("/")
					? result.path.substring(0, result.path.lastIndexOf("/"))
					: "";
				return {
					path: result.path,
					basename: result.basename,
					parentPath,
					excerpt: result.excerpt,
					score: result.score,
				};
			});
		} catch (e) {
			// requestUrl throws on network errors (server not running, etc.)
			console.warn("[Obi] Omnisearch HTTP request failed:", e);
			return [];
		}
	}

	/**
	 * Search vault files directly using Obsidian API
	 */
	private searchFilesInVault(query: string): FileSuggestion[] {
		try {
			const allFiles = this.plugin.app.vault.getMarkdownFiles();
			const lowerQuery = query.toLowerCase();

			console.log(
				`[Obi] Vault fallback search - ${allFiles.length} markdown files found`
			);

			// If empty query, show recent files
			if (query.length === 0) {
				const recentFiles = allFiles
					.sort((a, b) => b.stat.mtime - a.stat.mtime)
					.slice(0, 15)
					.map((file) => ({
						path: file.path,
						basename: file.basename,
						parentPath: file.parent?.path || "",
					}));
				console.log(`[Obi] Showing ${recentFiles.length} recent files`);
				return recentFiles;
			}

			const filtered = allFiles
				.filter((file) => {
					const name = file.basename.toLowerCase();
					const path = file.path.toLowerCase();
					return (
						name.includes(lowerQuery) || path.includes(lowerQuery)
					);
				})
				.sort((a, b) => {
					// Prioritize exact basename matches
					const aBasename = a.basename.toLowerCase();
					const bBasename = b.basename.toLowerCase();
					const aExact = aBasename === lowerQuery;
					const bExact = bBasename === lowerQuery;
					if (aExact && !bExact) return -1;
					if (!aExact && bExact) return 1;

					// Then prioritize basename starts with query
					const aStartsWith = aBasename.startsWith(lowerQuery);
					const bStartsWith = bBasename.startsWith(lowerQuery);
					if (aStartsWith && !bStartsWith) return -1;
					if (!aStartsWith && bStartsWith) return 1;

					// Then by recency
					return b.stat.mtime - a.stat.mtime;
				})
				.slice(0, 15)
				.map((file) => ({
					path: file.path,
					basename: file.basename,
					parentPath: file.parent?.path || "",
				}));

			console.log(
				`[Obi] Vault search found ${filtered.length} files for "${query}"`
			);
			return filtered;
		} catch (e) {
			console.error("[Obi] Vault search failed:", e);
			return [];
		}
	}

	/**
	 * Search files - tries Omnisearch HTTP first, then always falls back to vault search
	 */
	private async searchFiles(query: string): Promise<FileSuggestion[]> {
		let results: FileSuggestion[] = [];

		// Try Omnisearch HTTP server if enabled
		if (this.plugin.settings.useOmnisearchHttp && query.length > 0) {
			console.log(`[Obi] Trying Omnisearch HTTP for query: "${query}"`);
			results = await this.searchFilesViaHttp(query);

			if (results.length > 0) {
				console.log(
					`[Obi] Omnisearch returned ${results.length} results`
				);
				return results;
			}
			console.log(
				"[Obi] Omnisearch returned no results, falling back to vault search"
			);
		}

		// Fall back to vault search
		results = this.searchFilesInVault(query);
		console.log(`[Obi] Final search returned ${results.length} results`);

		return results;
	}

	private showSuggestions() {
		// Remove existing popup without clearing the suggestions array
		if (this.suggestionsEl) {
			this.suggestionsEl.remove();
			this.suggestionsEl = null;
		}

		// Create suggestions popup in the input wrapper (parent of inputContainer)
		const inputWrapper = this.inputContainer.parentElement;
		if (!inputWrapper) return;

		this.suggestionsEl = inputWrapper.createDiv({
			cls: "obi-suggestions",
		});

		// Add header
		const header = this.suggestionsEl.createDiv({
			cls: "obi-suggestions-header",
		});
		header.createSpan({ text: "Files", cls: "obi-suggestions-title" });
		header.createSpan({
			text: `${this.suggestions.length} result${
				this.suggestions.length !== 1 ? "s" : ""
			}`,
			cls: "obi-suggestions-count",
		});

		// Add items
		const listEl = this.suggestionsEl.createDiv({
			cls: "obi-suggestions-list",
		});

		for (let i = 0; i < this.suggestions.length; i++) {
			const suggestion = this.suggestions[i];
			const item = listEl.createDiv({
				cls: "obi-suggestion-item",
			});

			if (i === this.selectedSuggestionIndex) {
				item.addClass("is-selected");
			}

			const icon = item.createDiv({ cls: "obi-suggestion-icon" });
			setIcon(icon, "file-text");

			const textContainer = item.createDiv({
				cls: "obi-suggestion-text",
			});

			// File name
			const nameEl = textContainer.createDiv({
				cls: "obi-suggestion-name",
			});
			nameEl.setText(suggestion.basename);

			// Path or excerpt
			if (suggestion.excerpt) {
				const excerptEl = textContainer.createDiv({
					cls: "obi-suggestion-excerpt",
				});
				// Clean up excerpt (remove excessive whitespace)
				const cleanExcerpt = suggestion.excerpt
					.replace(/\s+/g, " ")
					.trim()
					.slice(0, 100);
				excerptEl.setText(cleanExcerpt);
			}

			if (suggestion.parentPath && suggestion.parentPath !== "/") {
				const pathEl = textContainer.createDiv({
					cls: "obi-suggestion-path",
				});
				pathEl.setText(suggestion.parentPath);
			}

			// Score badge (if available)
			if (suggestion.score !== undefined && suggestion.score > 0) {
				const scoreBadge = item.createDiv({
					cls: "obi-suggestion-score",
				});
				scoreBadge.setText(Math.round(suggestion.score).toString());
			}

			this.registerDomEvent(item, "click", () =>
				this.selectSuggestion(suggestion)
			);
			this.registerDomEvent(item, "mouseenter", () => {
				this.selectedSuggestionIndex = i;
				this.updateSuggestionsHighlight();
			});
		}

		// Add keyboard hint
		const hint = this.suggestionsEl.createDiv({
			cls: "obi-suggestions-hint",
		});
		hint.innerHTML =
			"<kbd>↑</kbd><kbd>↓</kbd> navigate · <kbd>Enter</kbd> select · <kbd>Esc</kbd> close";
	}

	private showNoResults(query: string) {
		// Remove existing popup without clearing state
		if (this.suggestionsEl) {
			this.suggestionsEl.remove();
			this.suggestionsEl = null;
		}

		const inputWrapper = this.inputContainer.parentElement;
		if (!inputWrapper) return;

		this.suggestionsEl = inputWrapper.createDiv({
			cls: "obi-suggestions",
		});

		const noResults = this.suggestionsEl.createDiv({
			cls: "obi-no-results",
		});
		noResults.createSpan({
			text: `No files found for "${query}"`,
		});
	}

	private updateSuggestionsHighlight() {
		if (!this.suggestionsEl) return;

		const items = this.suggestionsEl.querySelectorAll(
			".obi-suggestion-item"
		);
		items.forEach((item, i) => {
			item.toggleClass("is-selected", i === this.selectedSuggestionIndex);
		});

		// Scroll selected item into view
		const selectedItem = items[this.selectedSuggestionIndex] as HTMLElement;
		if (selectedItem) {
			selectedItem.scrollIntoView({ block: "nearest" });
		}
	}

	private selectSuggestion(suggestion: FileSuggestion) {
		if (this.mentionStartPos === null) return;

		const text = this.inputEl.value;
		const cursorPos = this.inputEl.selectionStart;

		// Replace @query with @[[filename]]
		const before = text.slice(0, this.mentionStartPos);
		const after = text.slice(cursorPos);
		const mention = `@[[${suggestion.basename}]] `;

		this.inputEl.value = before + mention + after;

		// Move cursor after the mention
		const newCursorPos = this.mentionStartPos + mention.length;
		this.inputEl.setSelectionRange(newCursorPos, newCursorPos);

		this.hideSuggestions();
		this.inputEl.focus();
	}

	private hideSuggestions() {
		if (this.suggestionsEl) {
			this.suggestionsEl.remove();
			this.suggestionsEl = null;
		}
		this.suggestions = [];
		this.mentionStartPos = null;
	}

	private renderWelcome() {
		const welcome = this.messagesContainer.createDiv({
			cls: "obi-welcome",
		});
		welcome.createEl("p", {
			text: "👋 Hi! I'm Obi, your vault assistant.",
		});
		welcome.createEl("p", {
			cls: "obi-welcome-hint",
			text: "Type @ to search and mention files, then ask your question.",
		});
	}

	private clearChat() {
		this.messages = [];
		this.messagesContainer.empty();
		this.renderWelcome();
	}

	/**
	 * Parse @[[filename]] mentions from the query
	 */
	private parseMentions(query: string): MentionedFile[] {
		const mentionRegex = /@\[\[([^\]]+)\]\]/g;
		const mentions: MentionedFile[] = [];
		let match;

		while ((match = mentionRegex.exec(query)) !== null) {
			const filename = match[1];
			const file = this.plugin.app.vault
				.getMarkdownFiles()
				.find((f) => f.basename === filename);

			if (file) {
				mentions.push({ file, displayName: filename });
			}
		}

		return mentions;
	}

	/**
	 * Remove @[[filename]] mentions from the query for display
	 */
	private cleanQueryForDisplay(query: string): string {
		return query.replace(/@\[\[([^\]]+)\]\]/g, "[$1]").trim();
	}

	/**
	 * Build system prompt with tool instructions
	 */
	private buildToolSystemPrompt(): string {
		return `You are Obi, a helpful assistant for managing an Obsidian vault.

You have access to tools that can help you work with the vault:
- create_file: Create new markdown files
- edit_file: Edit existing files (replace text or append content)
- read_file: Read file contents
- list_files: List files in a directory
- search_vault: Search for files by name

When the user asks you to create, edit, or modify files, use these tools to make the changes.
After making changes, briefly confirm what you did.
If you need to see a file's contents before editing, use read_file first.`;
	}

	/**
	 * Execute tool calls and return results
	 */
	private async executeToolCalls(
		toolCalls: ToolCall[]
	): Promise<ToolResult[]> {
		const results: ToolResult[] = [];

		for (const toolCall of toolCalls) {
			console.log(
				`[Obi] Executing tool: ${toolCall.name}`,
				toolCall.arguments
			);
			const result = await this.toolHandler.execute(toolCall);
			console.log(`[Obi] Tool result:`, result);
			results.push(result);
		}

		return results;
	}

	/**
	 * Display tool calls in the UI
	 */
	private displayToolCalls(toolCalls: ToolCall[]) {
		const toolEl = this.messagesContainer.createDiv({
			cls: "obi-tool-calls",
		});

		for (const toolCall of toolCalls) {
			const callEl = toolEl.createDiv({ cls: "obi-tool-call" });

			// Tool icon and name
			const headerEl = callEl.createDiv({ cls: "obi-tool-call-header" });
			const iconEl = headerEl.createSpan({ cls: "obi-tool-call-icon" });
			setIcon(iconEl, this.getToolIcon(toolCall.name));
			headerEl.createSpan({
				text: this.getToolDisplayName(toolCall.name),
				cls: "obi-tool-call-name",
			});

			// Tool arguments summary
			const argsEl = callEl.createDiv({ cls: "obi-tool-call-args" });
			argsEl.setText(this.formatToolArgs(toolCall));
		}

		this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
	}

	/**
	 * Display tool results in the UI
	 */
	private displayToolResults(results: ToolResult[]) {
		const resultsEl = this.messagesContainer.createDiv({
			cls: "obi-tool-results",
		});

		for (const result of results) {
			const resultEl = resultsEl.createDiv({
				cls: `obi-tool-result ${
					result.success
						? "obi-tool-result-success"
						: "obi-tool-result-error"
				}`,
			});

			const iconEl = resultEl.createSpan({ cls: "obi-tool-result-icon" });
			setIcon(iconEl, result.success ? "check-circle" : "x-circle");

			// Truncate long results for display
			const displayContent =
				result.content.length > 200
					? result.content.substring(0, 200) + "..."
					: result.content;

			resultEl.createSpan({
				text: displayContent,
				cls: "obi-tool-result-text",
			});
		}

		this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
	}

	/**
	 * Get icon for a tool
	 */
	private getToolIcon(toolName: string): string {
		const icons: Record<string, string> = {
			create_file: "file-plus",
			edit_file: "edit",
			read_file: "file-text",
			list_files: "folder",
			search_vault: "search",
		};
		return icons[toolName] || "tool";
	}

	/**
	 * Get display name for a tool
	 */
	private getToolDisplayName(toolName: string): string {
		const names: Record<string, string> = {
			create_file: "Creating file",
			edit_file: "Editing file",
			read_file: "Reading file",
			list_files: "Listing files",
			search_vault: "Searching vault",
		};
		return names[toolName] || toolName;
	}

	/**
	 * Format tool arguments for display
	 */
	private formatToolArgs(toolCall: ToolCall): string {
		const args = toolCall.arguments;
		switch (toolCall.name) {
			case "create_file":
				return `${args.path}`;
			case "edit_file":
				return `${args.path} (${args.mode})`;
			case "read_file":
				return `${args.path}`;
			case "list_files":
				return `${args.path || "/"}`;
			case "search_vault":
				return `"${args.query}"`;
			default:
				return JSON.stringify(args);
		}
	}

	private async handleSend() {
		const query = this.inputEl.value.trim();
		if (!query || this.isLoading) return;

		// Parse mentioned files
		const mentionedFiles = this.parseMentions(query);
		const displayQuery = this.cleanQueryForDisplay(query);

		// Clear input
		this.inputEl.value = "";
		this.inputEl.style.height = "auto";
		this.hideSuggestions();

		// Remove welcome message if present
		const welcome = this.messagesContainer.querySelector(".obi-welcome");
		if (welcome) welcome.remove();

		// Add user message (cleaned for display)
		this.addMessage(
			{ role: "user", content: displayQuery },
			mentionedFiles
		);

		// Show loading
		this.setLoading(true);

		try {
			// Get LLM client from plugin (respects provider setting)
			const lmClient = this.getLMClient();
			if (!lmClient) {
				throw new Error(
					"LLM not configured. Check your settings (API key for Gemini, or LM Studio server for local)."
				);
			}

			// Update context provider with latest settings
			this.contextProvider.updateConfig({
				maxFiles: this.plugin.settings.maxContextFiles,
				maxTokens: this.plugin.settings.maxContextTokens,
			});

			// Build messages for API
			const apiMessages: ChatMessage[] = [];

			// Add tool system prompt if tools are enabled
			const toolsEnabled =
				this.plugin.settings.enableTools && lmClient.supportsTools();
			if (toolsEnabled) {
				apiMessages.push({
					role: "system",
					content: this.buildToolSystemPrompt(),
				});
			}

			// Gather context from mentioned files + auto-search if enabled
			let contextPrompt = "";

			// Add explicitly mentioned files
			if (mentionedFiles.length > 0) {
				const mentionedContent = await this.getMentionedFilesContent(
					mentionedFiles
				);
				if (mentionedContent) {
					contextPrompt += mentionedContent + "\n\n";
				}
			}

			// Add auto-searched context if enabled
			if (this.plugin.settings.enableContext) {
				const snippets = await this.contextProvider.gatherContext(
					displayQuery
				);
				// Filter out already-mentioned files
				const mentionedPaths = new Set(
					mentionedFiles.map((m) => m.file.path)
				);
				const filteredSnippets = snippets.filter(
					(s) => !mentionedPaths.has(s.filePath)
				);

				const autoContext =
					this.contextProvider.formatContextForPrompt(
						filteredSnippets
					);
				if (autoContext) {
					contextPrompt += autoContext;
				}
			}

			if (contextPrompt) {
				apiMessages.push({
					role: "system",
					content: contextPrompt,
				});
			}

			// Add conversation history (last few messages for context)
			const historyLimit = 10;
			const recentMessages = this.messages.slice(-historyLimit);
			apiMessages.push(...recentMessages);

			// Prepare chat options
			const chatOptions: ChatOptions = {};
			if (toolsEnabled) {
				chatOptions.tools = TOOL_DEFINITIONS;
			}

			// Tool execution loop
			let response: LLMResponse;
			let toolRound = 0;

			while (toolRound < MAX_TOOL_ROUNDS) {
				// Call LLM
				response = await lmClient.chat(apiMessages, chatOptions);

				// Check if LLM wants to call tools
				if (response.toolCalls && response.toolCalls.length > 0) {
					toolRound++;
					console.log(
						`[Obi] Tool round ${toolRound}: ${response.toolCalls.length} tool calls`
					);

					// Display tool calls in UI
					this.displayToolCalls(response.toolCalls);

					// Execute tools
					const toolResults = await this.executeToolCalls(
						response.toolCalls
					);

					// Display tool results in UI
					this.displayToolResults(toolResults);

					// Add tool call and results to conversation for next round
					// For the assistant's tool call, we add a placeholder message
					apiMessages.push({
						role: "assistant",
						content: `[Called tools: ${response.toolCalls
							.map((tc) => tc.name)
							.join(", ")}]`,
					});

					// Add tool results as user message
					const resultsText = toolResults
						.map(
							(r) =>
								`Tool ${r.callId}: ${
									r.success ? "SUCCESS" : "ERROR"
								} - ${r.content}`
						)
						.join("\n\n");

					apiMessages.push({
						role: "user",
						content: `Tool results:\n\n${resultsText}`,
					});

					// Update chat options with tool results for next iteration
					chatOptions.toolResults = toolResults;
				} else if (response.message) {
					// Got a text response, we're done
					this.addMessage(response.message);
					break;
				} else {
					// Unexpected response
					throw new Error("Received empty response from LLM");
				}
			}

			if (toolRound >= MAX_TOOL_ROUNDS) {
				this.addErrorMessage(
					"Reached maximum tool call rounds. The agent may be stuck in a loop."
				);
			}
		} catch (error) {
			let errorMessage =
				"An error occurred while processing your request.";

			if (error instanceof LLMClientError) {
				if (error.statusCode) {
					errorMessage = `LLM error (${error.statusCode}): ${error.message}`;
				} else {
					errorMessage = error.message;
				}
			} else if (error instanceof Error) {
				errorMessage = error.message;
			}

			this.addErrorMessage(errorMessage);
		} finally {
			this.setLoading(false);
		}
	}

	private async getMentionedFilesContent(
		mentions: MentionedFile[]
	): Promise<string> {
		if (mentions.length === 0) return "";

		const parts = ["The user specifically mentioned these files:\n"];

		for (const mention of mentions) {
			try {
				const content = await this.plugin.app.vault.cachedRead(
					mention.file
				);
				// Trim content if too long
				const maxChars = Math.floor(
					(this.plugin.settings.maxContextTokens * 4) /
						mentions.length
				);
				const trimmedContent =
					content.length > maxChars
						? content.slice(0, maxChars) + "\n[...]"
						: content;

				parts.push(`--- ${mention.file.path} ---`);
				parts.push(trimmedContent);
				parts.push("");
			} catch {
				// Skip files that can't be read
				continue;
			}
		}

		return parts.join("\n");
	}

	private addMessage(message: ChatMessage, mentions?: MentionedFile[]) {
		this.messages.push(message);

		const messageEl = this.messagesContainer.createDiv({
			cls: `obi-message obi-message-${message.role}`,
		});

		const contentEl = messageEl.createDiv({ cls: "obi-message-content" });

		// Render markdown for assistant messages, plain text for user messages
		if (message.role === "assistant") {
			// Use Obsidian's markdown renderer
			MarkdownRenderer.render(
				this.app,
				message.content,
				contentEl,
				"",
				this as Component
			);
		} else {
			contentEl.setText(message.content);
		}

		// Show mentioned files as chips for user messages
		if (message.role === "user" && mentions && mentions.length > 0) {
			const chipsEl = messageEl.createDiv({ cls: "obi-mention-chips" });
			for (const mention of mentions) {
				const chip = chipsEl.createDiv({ cls: "obi-mention-chip" });
				setIcon(
					chip.createSpan({ cls: "obi-mention-chip-icon" }),
					"file-text"
				);
				chip.createSpan({ text: mention.displayName });

				// Click to open the file
				this.registerDomEvent(chip, "click", () => {
					this.plugin.app.workspace.openLinkText(
						mention.file.path,
						"",
						false
					);
				});
			}
		}

		// Scroll to bottom
		this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
	}

	private addErrorMessage(error: string) {
		const errorEl = this.messagesContainer.createDiv({
			cls: "obi-message obi-message-error",
		});

		const contentEl = errorEl.createDiv({ cls: "obi-message-content" });
		contentEl.setText(`⚠️ ${error}`);

		// Scroll to bottom
		this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
	}

	private setLoading(loading: boolean) {
		this.isLoading = loading;
		this.sendButton.disabled = loading;
		this.inputEl.disabled = loading;

		// Remove existing loading indicator
		const existingLoader =
			this.messagesContainer.querySelector(".obi-loading");
		if (existingLoader) existingLoader.remove();

		if (loading) {
			const loader = this.messagesContainer.createDiv({
				cls: "obi-loading",
			});
			loader.createDiv({ cls: "obi-loading-dot" });
			loader.createDiv({ cls: "obi-loading-dot" });
			loader.createDiv({ cls: "obi-loading-dot" });

			this.messagesContainer.scrollTop =
				this.messagesContainer.scrollHeight;
		}
	}
}

import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type ObiPlugin from "../main";
import { ChatMessage } from "../types";
import { LMClient, createLMClient, LMClientError } from "../api/lmClient";
import {
	VaultContextProvider,
	createVaultContextProvider,
} from "../context/vaultContext";

export const OBI_VIEW_TYPE = "obi-chat-view";

export class ObiChatView extends ItemView {
	private plugin: ObiPlugin;
	private messages: ChatMessage[] = [];
	private lmClient: LMClient;
	private contextProvider: VaultContextProvider;
	private isLoading = false;

	// DOM elements
	private messagesContainer: HTMLElement;
	private inputContainer: HTMLElement;
	private inputEl: HTMLTextAreaElement;
	private sendButton: HTMLButtonElement;

	constructor(leaf: WorkspaceLeaf, plugin: ObiPlugin) {
		super(leaf);
		this.plugin = plugin;

		// Initialize clients
		this.lmClient = createLMClient(plugin.settings);
		this.contextProvider = createVaultContextProvider(
			plugin.app,
			plugin.settings
		);
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
		clearBtn.addEventListener("click", () => this.clearChat());

		// Create messages container
		this.messagesContainer = container.createDiv({
			cls: "obi-messages-container",
		});

		// Create input area
		this.inputContainer = container.createDiv({ cls: "obi-input-container" });

		this.inputEl = this.inputContainer.createEl("textarea", {
			cls: "obi-input",
			attr: {
				placeholder: "Ask something about your vault...",
				rows: "1",
			},
		});

		this.sendButton = this.inputContainer.createEl("button", {
			cls: "obi-send-btn",
			attr: { "aria-label": "Send message" },
		});
		setIcon(this.sendButton, "send");

		// Event listeners
		this.sendButton.addEventListener("click", () => this.handleSend());
		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				this.handleSend();
			}
		});

		// Auto-resize textarea
		this.inputEl.addEventListener("input", () => {
			this.inputEl.style.height = "auto";
			this.inputEl.style.height =
				Math.min(this.inputEl.scrollHeight, 150) + "px";
		});

		// Render welcome message
		this.renderWelcome();
	}

	async onClose() {
		// Cleanup if needed
	}

	private renderWelcome() {
		const welcome = this.messagesContainer.createDiv({
			cls: "obi-welcome",
		});
		welcome.createEl("p", {
			text: "👋 Hi! I'm Obi, your vault assistant. Ask me anything about your notes.",
		});
		welcome.createEl("p", {
			cls: "obi-welcome-hint",
			text: "I'll search your vault for relevant context to help answer your questions.",
		});
	}

	private clearChat() {
		this.messages = [];
		this.messagesContainer.empty();
		this.renderWelcome();
	}

	private async handleSend() {
		const query = this.inputEl.value.trim();
		if (!query || this.isLoading) return;

		// Clear input
		this.inputEl.value = "";
		this.inputEl.style.height = "auto";

		// Remove welcome message if present
		const welcome = this.messagesContainer.querySelector(".obi-welcome");
		if (welcome) welcome.remove();

		// Add user message
		this.addMessage({ role: "user", content: query });

		// Show loading
		this.setLoading(true);

		try {
			// Update clients with latest settings
			this.lmClient.updateConfig({
				endpoint: this.plugin.settings.endpoint,
				model: this.plugin.settings.model,
				apiKey: this.plugin.settings.apiKey || undefined,
			});
			this.contextProvider.updateConfig({
				maxFiles: this.plugin.settings.maxContextFiles,
				maxTokens: this.plugin.settings.maxContextTokens,
			});

			// Build messages for API
			const apiMessages: ChatMessage[] = [];

			// Add system message with context if enabled
			if (this.plugin.settings.enableContext) {
				const snippets = await this.contextProvider.gatherContext(query);
				const contextPrompt =
					this.contextProvider.formatContextForPrompt(snippets);

				if (contextPrompt) {
					apiMessages.push({
						role: "system",
						content: contextPrompt,
					});
				}
			}

			// Add conversation history (last few messages for context)
			const historyLimit = 10;
			const recentMessages = this.messages.slice(-historyLimit);
			apiMessages.push(...recentMessages);

			// Call LM Studio
			const response = await this.lmClient.chat(apiMessages);

			// Add assistant response
			this.addMessage(response);
		} catch (error) {
			let errorMessage = "An error occurred while processing your request.";

			if (error instanceof LMClientError) {
				if (error.statusCode) {
					errorMessage = `LM Studio error (${error.statusCode}): ${error.message}`;
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

	private addMessage(message: ChatMessage) {
		this.messages.push(message);

		const messageEl = this.messagesContainer.createDiv({
			cls: `obi-message obi-message-${message.role}`,
		});

		const contentEl = messageEl.createDiv({ cls: "obi-message-content" });
		contentEl.setText(message.content);

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

			this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
		}
	}
}


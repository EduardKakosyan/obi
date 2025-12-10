import { App, PluginSettingTab, Setting } from "obsidian";
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
}

export const DEFAULT_SETTINGS: ObiSettings = {
	endpoint: "http://localhost:1234/v1",
	model: "mistralai/ministral-3-14b-reasoning",
	apiKey: "",
	maxContextFiles: 5,
	maxContextTokens: 2000,
	enableContext: true,
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

		new Setting(containerEl)
			.setName("LM Studio endpoint")
			.setDesc("The URL of your local LM Studio server (OpenAI-compatible API).")
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
			.setDesc("Optional API key if your LM Studio server requires authentication.")
			.addText((text) =>
				text
					.setPlaceholder("Leave empty if not required")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "Context settings" });

		new Setting(containerEl)
			.setName("Enable vault context")
			.setDesc("Include relevant notes from your vault when answering questions.")
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
			.setDesc("Approximate maximum tokens to include from context files.")
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
	}
}


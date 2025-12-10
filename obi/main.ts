import { Plugin } from "obsidian";
import { ObiSettings, DEFAULT_SETTINGS, ObiSettingTab } from "./settings";
import { OBI_VIEW_TYPE, ObiChatView } from "./ui/chatView";

export default class ObiPlugin extends Plugin {
	settings: ObiSettings;

	async onload() {
		await this.loadSettings();

		// Register the chat view
		this.registerView(OBI_VIEW_TYPE, (leaf) => new ObiChatView(leaf, this));

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

		// Add settings tab
		this.addSettingTab(new ObiSettingTab(this.app, this));
	}

	onunload() {
		// Clean up view
		this.app.workspace.detachLeavesOfType(OBI_VIEW_TYPE);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
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

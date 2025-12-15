import { App, Modal, setIcon } from "obsidian";

interface FileStatus {
	path: string;
	status: "indexed" | "changed" | "new";
	lastIndexed: Date | null;
	lastModified: Date;
}

interface IndexStats {
	totalFiles: number;
	indexedFiles: number;
	changedFiles: number;
	lastFullIndex: Date | null;
	vectorCount: number;
}

export class IndexStatusModal extends Modal {
	private fileStatuses: FileStatus[];
	private stats: IndexStats;

	constructor(app: App, fileStatuses: FileStatus[], stats: IndexStats) {
		super(app);
		this.fileStatuses = fileStatuses;
		this.stats = stats;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("obi-index-status-modal");

		// Header
		contentEl.createEl("h2", { text: "Index status" });

		// Summary stats
		const statsEl = contentEl.createDiv({ cls: "obi-index-stats" });

		const indexed = this.fileStatuses.filter(
			(f) => f.status === "indexed"
		).length;
		const changed = this.fileStatuses.filter(
			(f) => f.status === "changed"
		).length;
		const newFiles = this.fileStatuses.filter(
			(f) => f.status === "new"
		).length;

		this.createStatCard(statsEl, "check-circle", "Indexed", indexed, "indexed");
		this.createStatCard(statsEl, "refresh-cw", "Changed", changed, "changed");
		this.createStatCard(statsEl, "file-plus", "New", newFiles, "new");
		this.createStatCard(
			statsEl,
			"database",
			"Vectors",
			this.stats.vectorCount,
			"vectors"
		);

		// Last indexed info
		if (this.stats.lastFullIndex) {
			const lastIndexEl = contentEl.createDiv({ cls: "obi-last-index" });
			lastIndexEl.createSpan({
				text: `Last full index: ${this.stats.lastFullIndex.toLocaleString()}`,
			});
		}

		// Filter tabs
		const tabsEl = contentEl.createDiv({ cls: "obi-index-tabs" });
		const tabs = [
			{ id: "all", label: "All", count: this.fileStatuses.length },
			{ id: "new", label: "New", count: newFiles },
			{ id: "changed", label: "Changed", count: changed },
			{ id: "indexed", label: "Indexed", count: indexed },
		];

		let activeTab = "all";

		const listContainer = contentEl.createDiv({ cls: "obi-file-list-container" });

		const renderList = (filter: string) => {
			listContainer.empty();

			const filtered =
				filter === "all"
					? this.fileStatuses
					: this.fileStatuses.filter((f) => f.status === filter);

			if (filtered.length === 0) {
				listContainer.createDiv({
					cls: "obi-no-files",
					text:
						filter === "all"
							? "No markdown files in vault"
							: `No ${filter} files`,
				});
				return;
			}

			const listEl = listContainer.createDiv({ cls: "obi-file-list" });

			for (const file of filtered) {
				const itemEl = listEl.createDiv({
					cls: `obi-file-item obi-file-${file.status}`,
				});

				const iconEl = itemEl.createDiv({ cls: "obi-file-icon" });
				const icon =
					file.status === "indexed"
						? "check-circle"
						: file.status === "changed"
							? "refresh-cw"
							: "file-plus";
				setIcon(iconEl, icon);

				const infoEl = itemEl.createDiv({ cls: "obi-file-info" });

				const pathEl = infoEl.createDiv({ cls: "obi-file-path" });
				pathEl.setText(file.path);

				const metaEl = infoEl.createDiv({ cls: "obi-file-meta" });

				if (file.status === "indexed" && file.lastIndexed) {
					metaEl.createSpan({
						text: `Indexed: ${this.formatRelativeTime(file.lastIndexed)}`,
					});
				} else if (file.status === "changed" && file.lastIndexed) {
					metaEl.createSpan({
						text: `Modified since indexing`,
					});
				} else {
					metaEl.createSpan({
						text: `Never indexed`,
					});
				}
			}
		};

		for (const tab of tabs) {
			const tabEl = tabsEl.createEl("button", {
				cls: `obi-tab ${tab.id === activeTab ? "active" : ""}`,
				text: `${tab.label} (${tab.count})`,
			});

			tabEl.addEventListener("click", () => {
				tabsEl.querySelectorAll(".obi-tab").forEach((t) => {
					t.removeClass("active");
				});
				tabEl.addClass("active");
				activeTab = tab.id;
				renderList(tab.id);
			});
		}

		renderList(activeTab);
	}

	private createStatCard(
		container: HTMLElement,
		icon: string,
		label: string,
		value: number,
		cls: string
	) {
		const card = container.createDiv({ cls: `obi-stat-card obi-stat-${cls}` });
		const iconEl = card.createDiv({ cls: "obi-stat-icon" });
		setIcon(iconEl, icon);
		card.createDiv({ cls: "obi-stat-value", text: String(value) });
		card.createDiv({ cls: "obi-stat-label", text: label });
	}

	private formatRelativeTime(date: Date): string {
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) return "just now";
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;
		return date.toLocaleDateString();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}





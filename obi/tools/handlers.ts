import { App, TFile, TFolder, normalizePath } from "obsidian";
import { ToolDefinition, ToolCall, ToolResult } from "./types";

/**
 * Tool definitions that describe available tools to the LLM
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
	{
		name: "create_file",
		description:
			"Create a new markdown file in the vault with the specified content. Use this to create new notes.",
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description:
						"The path for the new file, relative to vault root. Should end with .md extension.",
				},
				content: {
					type: "string",
					description: "The content to write to the file.",
				},
			},
			required: ["path", "content"],
		},
	},
	{
		name: "edit_file",
		description:
			"Edit an existing file by replacing specific text or appending content. Use mode 'replace' to find and replace text, or 'append' to add content at the end.",
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "The path to the file to edit, relative to vault root.",
				},
				mode: {
					type: "string",
					description: "The edit mode: 'replace' to find and replace text, 'append' to add content at the end.",
					enum: ["replace", "append"],
				},
				search: {
					type: "string",
					description: "For 'replace' mode: the exact text to find and replace.",
				},
				replace: {
					type: "string",
					description: "For 'replace' mode: the text to replace with.",
				},
				content: {
					type: "string",
					description: "For 'append' mode: the content to append to the file.",
				},
			},
			required: ["path", "mode"],
		},
	},
	{
		name: "read_file",
		description:
			"Read the full content of a file from the vault. Use this to examine file contents before editing.",
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "The path to the file to read, relative to vault root.",
				},
			},
			required: ["path"],
		},
	},
	{
		name: "list_files",
		description:
			"List files and folders in a directory. Use this to explore the vault structure.",
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description:
						"The folder path to list, relative to vault root. Use empty string or '/' for root.",
				},
			},
			required: ["path"],
		},
	},
	{
		name: "search_vault",
		description:
			"Search for files in the vault by filename. Returns matching file paths.",
		parameters: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "The search query to match against file names.",
				},
				limit: {
					type: "number",
					description: "Maximum number of results to return. Defaults to 10.",
				},
			},
			required: ["query"],
		},
	},
];

/**
 * Handler class for executing tools
 */
export class ToolHandler {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Execute a tool call and return the result
	 */
	async execute(toolCall: ToolCall): Promise<ToolResult> {
		try {
			switch (toolCall.name) {
				case "create_file":
					return await this.createFile(toolCall);
				case "edit_file":
					return await this.editFile(toolCall);
				case "read_file":
					return await this.readFile(toolCall);
				case "list_files":
					return await this.listFiles(toolCall);
				case "search_vault":
					return await this.searchVault(toolCall);
				default:
					return {
						callId: toolCall.id,
						success: false,
						content: `Unknown tool: ${toolCall.name}`,
					};
			}
		} catch (error) {
			return {
				callId: toolCall.id,
				success: false,
				content: `Error executing ${toolCall.name}: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	/**
	 * Create a new file
	 */
	private async createFile(toolCall: ToolCall): Promise<ToolResult> {
		const path = toolCall.arguments.path as string;
		const content = toolCall.arguments.content as string;

		if (!path) {
			return {
				callId: toolCall.id,
				success: false,
				content: "Missing required parameter: path",
			};
		}

		if (content === undefined) {
			return {
				callId: toolCall.id,
				success: false,
				content: "Missing required parameter: content",
			};
		}

		// Normalize the path and ensure .md extension
		let normalizedPath = normalizePath(path);
		if (!normalizedPath.endsWith(".md")) {
			normalizedPath += ".md";
		}

		// Check if file already exists
		const existingFile = this.app.vault.getAbstractFileByPath(normalizedPath);
		if (existingFile) {
			return {
				callId: toolCall.id,
				success: false,
				content: `File already exists: ${normalizedPath}. Use edit_file to modify existing files.`,
			};
		}

		// Create parent folders if they don't exist
		const parentPath = normalizedPath.substring(0, normalizedPath.lastIndexOf("/"));
		if (parentPath) {
			const parentFolder = this.app.vault.getAbstractFileByPath(parentPath);
			if (!parentFolder) {
				await this.app.vault.createFolder(parentPath);
			}
		}

		// Create the file
		await this.app.vault.create(normalizedPath, content);

		return {
			callId: toolCall.id,
			success: true,
			content: `Created file: ${normalizedPath}`,
		};
	}

	/**
	 * Edit an existing file
	 */
	private async editFile(toolCall: ToolCall): Promise<ToolResult> {
		const path = toolCall.arguments.path as string;
		const mode = toolCall.arguments.mode as "replace" | "append";

		if (!path) {
			return {
				callId: toolCall.id,
				success: false,
				content: "Missing required parameter: path",
			};
		}

		if (!mode || !["replace", "append"].includes(mode)) {
			return {
				callId: toolCall.id,
				success: false,
				content: "Invalid mode. Must be 'replace' or 'append'.",
			};
		}

		const normalizedPath = normalizePath(path);
		const file = this.app.vault.getAbstractFileByPath(normalizedPath);

		if (!file || !(file instanceof TFile)) {
			return {
				callId: toolCall.id,
				success: false,
				content: `File not found: ${normalizedPath}`,
			};
		}

		const currentContent = await this.app.vault.read(file);

		if (mode === "replace") {
			const search = toolCall.arguments.search as string;
			const replace = toolCall.arguments.replace as string;

			if (!search) {
				return {
					callId: toolCall.id,
					success: false,
					content: "Missing required parameter for replace mode: search",
				};
			}

			if (replace === undefined) {
				return {
					callId: toolCall.id,
					success: false,
					content: "Missing required parameter for replace mode: replace",
				};
			}

			if (!currentContent.includes(search)) {
				return {
					callId: toolCall.id,
					success: false,
					content: `Search text not found in file: "${search.substring(0, 50)}${search.length > 50 ? "..." : ""}"`,
				};
			}

			const newContent = currentContent.replace(search, replace);
			await this.app.vault.modify(file, newContent);

			return {
				callId: toolCall.id,
				success: true,
				content: `Replaced text in ${normalizedPath}`,
			};
		} else {
			// append mode
			const content = toolCall.arguments.content as string;

			if (content === undefined) {
				return {
					callId: toolCall.id,
					success: false,
					content: "Missing required parameter for append mode: content",
				};
			}

			const newContent = currentContent + "\n" + content;
			await this.app.vault.modify(file, newContent);

			return {
				callId: toolCall.id,
				success: true,
				content: `Appended content to ${normalizedPath}`,
			};
		}
	}

	/**
	 * Read a file's content
	 */
	private async readFile(toolCall: ToolCall): Promise<ToolResult> {
		const path = toolCall.arguments.path as string;

		if (!path) {
			return {
				callId: toolCall.id,
				success: false,
				content: "Missing required parameter: path",
			};
		}

		const normalizedPath = normalizePath(path);
		const file = this.app.vault.getAbstractFileByPath(normalizedPath);

		if (!file || !(file instanceof TFile)) {
			return {
				callId: toolCall.id,
				success: false,
				content: `File not found: ${normalizedPath}`,
			};
		}

		const content = await this.app.vault.read(file);

		// Truncate very long files to avoid token limits
		const maxLength = 10000;
		const truncated = content.length > maxLength;
		const displayContent = truncated
			? content.substring(0, maxLength) + "\n\n[... content truncated ...]"
			: content;

		return {
			callId: toolCall.id,
			success: true,
			content: `Content of ${normalizedPath}:\n\n${displayContent}`,
		};
	}

	/**
	 * List files in a directory
	 */
	private async listFiles(toolCall: ToolCall): Promise<ToolResult> {
		let path = toolCall.arguments.path as string;

		// Handle root directory
		if (!path || path === "/" || path === ".") {
			path = "";
		} else {
			path = normalizePath(path);
		}

		// Get folder or root
		let items: string[] = [];

		if (path === "") {
			// List root folder
			const root = this.app.vault.getRoot();
			for (const child of root.children) {
				const prefix = child instanceof TFolder ? "📁 " : "📄 ";
				items.push(prefix + child.name);
			}
		} else {
			const folder = this.app.vault.getAbstractFileByPath(path);

			if (!folder) {
				return {
					callId: toolCall.id,
					success: false,
					content: `Folder not found: ${path}`,
				};
			}

			if (!(folder instanceof TFolder)) {
				return {
					callId: toolCall.id,
					success: false,
					content: `Path is not a folder: ${path}`,
				};
			}

			for (const child of folder.children) {
				const prefix = child instanceof TFolder ? "📁 " : "📄 ";
				items.push(prefix + child.name);
			}
		}

		// Sort: folders first, then files
		items.sort((a, b) => {
			const aIsFolder = a.startsWith("📁");
			const bIsFolder = b.startsWith("📁");
			if (aIsFolder && !bIsFolder) return -1;
			if (!aIsFolder && bIsFolder) return 1;
			return a.localeCompare(b);
		});

		const displayPath = path || "/";

		return {
			callId: toolCall.id,
			success: true,
			content: `Contents of ${displayPath}:\n\n${items.join("\n") || "(empty folder)"}`,
		};
	}

	/**
	 * Search for files by name
	 */
	private async searchVault(toolCall: ToolCall): Promise<ToolResult> {
		const query = toolCall.arguments.query as string;
		const limit = (toolCall.arguments.limit as number) || 10;

		if (!query) {
			return {
				callId: toolCall.id,
				success: false,
				content: "Missing required parameter: query",
			};
		}

		const lowerQuery = query.toLowerCase();
		const allFiles = this.app.vault.getMarkdownFiles();

		// Search by filename and path
		const matches = allFiles
			.filter((file) => {
				const name = file.basename.toLowerCase();
				const path = file.path.toLowerCase();
				return name.includes(lowerQuery) || path.includes(lowerQuery);
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
			.slice(0, limit);

		if (matches.length === 0) {
			return {
				callId: toolCall.id,
				success: true,
				content: `No files found matching "${query}"`,
			};
		}

		const results = matches.map((f) => `- ${f.path}`).join("\n");

		return {
			callId: toolCall.id,
			success: true,
			content: `Found ${matches.length} file(s) matching "${query}":\n\n${results}`,
		};
	}
}

/**
 * Create a tool handler instance
 */
export function createToolHandler(app: App): ToolHandler {
	return new ToolHandler(app);
}


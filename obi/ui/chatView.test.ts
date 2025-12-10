import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for chat view @ mention functionality
 * These tests focus on the file search and mention parsing logic
 */

// Mock Omnisearch API types for testing
interface MockOmnisearchResult {
	score: number;
	vault: string;
	path: string;
	basename: string;
	foundWords: string[];
	matches: Array<{ match: string; offset: number }>;
	excerpt: string;
}

interface MockOmnisearchApi {
	search: (query: string) => Promise<MockOmnisearchResult[]>;
}

describe("@ Mention File Search", () => {
	let mockOmnisearch: MockOmnisearchApi;

	beforeEach(() => {
		// Create mock Omnisearch API
		mockOmnisearch = {
			search: vi.fn(),
		};
		vi.clearAllMocks();
	});

	afterEach(() => {
		// Clean up global omnisearch
		if ("omnisearch" in globalThis) {
			delete (globalThis as Record<string, unknown>).omnisearch;
		}
	});

	describe("Omnisearch Integration", () => {
		it("should detect when Omnisearch is available", () => {
			expect(typeof globalThis.omnisearch).toBe("undefined");

			// Simulate Omnisearch being available
			(globalThis as Record<string, unknown>).omnisearch = mockOmnisearch;

			expect(typeof globalThis.omnisearch).not.toBe("undefined");
		});

		it("should call Omnisearch search with query", async () => {
			const mockResults: MockOmnisearchResult[] = [
				{
					score: 10,
					vault: "test-vault",
					path: "notes/meeting-notes.md",
					basename: "meeting-notes",
					foundWords: ["meeting"],
					matches: [{ match: "meeting", offset: 0 }],
					excerpt: "Meeting notes from today...",
				},
				{
					score: 8,
					vault: "test-vault",
					path: "projects/project-plan.md",
					basename: "project-plan",
					foundWords: ["project"],
					matches: [{ match: "project", offset: 0 }],
					excerpt: "Project planning document...",
				},
			];

			mockOmnisearch.search = vi.fn().mockResolvedValue(mockResults);
			(globalThis as Record<string, unknown>).omnisearch = mockOmnisearch;

			const results = await globalThis.omnisearch!.search("meeting");

			expect(mockOmnisearch.search).toHaveBeenCalledWith("meeting");
			expect(results).toHaveLength(2);
			expect(results[0].basename).toBe("meeting-notes");
			expect(results[0].excerpt).toBe("Meeting notes from today...");
		});

		it("should handle empty Omnisearch results", async () => {
			mockOmnisearch.search = vi.fn().mockResolvedValue([]);
			(globalThis as Record<string, unknown>).omnisearch = mockOmnisearch;

			const results = await globalThis.omnisearch!.search("nonexistent");

			expect(results).toHaveLength(0);
		});

		it("should handle Omnisearch errors gracefully", async () => {
			mockOmnisearch.search = vi
				.fn()
				.mockRejectedValue(new Error("Omnisearch error"));
			(globalThis as Record<string, unknown>).omnisearch = mockOmnisearch;

			await expect(
				globalThis.omnisearch!.search("test")
			).rejects.toThrow("Omnisearch error");
		});

		it("should return results with score and excerpt", async () => {
			const mockResults: MockOmnisearchResult[] = [
				{
					score: 15.5,
					vault: "test-vault",
					path: "folder/subfolder/note.md",
					basename: "note",
					foundWords: ["test", "query"],
					matches: [
						{ match: "test", offset: 10 },
						{ match: "query", offset: 25 },
					],
					excerpt: "This is a test query example...",
				},
			];

			mockOmnisearch.search = vi.fn().mockResolvedValue(mockResults);
			(globalThis as Record<string, unknown>).omnisearch = mockOmnisearch;

			const results = await globalThis.omnisearch!.search("test query");

			expect(results[0].score).toBe(15.5);
			expect(results[0].excerpt).toBe("This is a test query example...");
			expect(results[0].foundWords).toContain("test");
			expect(results[0].foundWords).toContain("query");
		});
	});

	describe("Mention Parsing", () => {
		// Regex pattern used in chatView.ts
		const mentionRegex = /@\[\[([^\]]+)\]\]/g;

		it("should parse single @[[filename]] mention", () => {
			const query = "Tell me about @[[meeting-notes]] please";
			const matches: string[] = [];
			let match;

			while ((match = mentionRegex.exec(query)) !== null) {
				matches.push(match[1]);
			}

			expect(matches).toHaveLength(1);
			expect(matches[0]).toBe("meeting-notes");
		});

		it("should parse multiple @[[filename]] mentions", () => {
			const query =
				"Compare @[[project-plan]] with @[[budget-report]] and @[[timeline]]";
			const matches: string[] = [];
			let match;

			// Reset regex
			mentionRegex.lastIndex = 0;

			while ((match = mentionRegex.exec(query)) !== null) {
				matches.push(match[1]);
			}

			expect(matches).toHaveLength(3);
			expect(matches).toContain("project-plan");
			expect(matches).toContain("budget-report");
			expect(matches).toContain("timeline");
		});

		it("should handle query with no mentions", () => {
			const query = "What is the meaning of life?";
			const matches: string[] = [];
			let match;

			mentionRegex.lastIndex = 0;

			while ((match = mentionRegex.exec(query)) !== null) {
				matches.push(match[1]);
			}

			expect(matches).toHaveLength(0);
		});

		it("should handle filenames with spaces", () => {
			const query = "Check @[[my important note]] for details";
			const matches: string[] = [];
			let match;

			mentionRegex.lastIndex = 0;

			while ((match = mentionRegex.exec(query)) !== null) {
				matches.push(match[1]);
			}

			expect(matches).toHaveLength(1);
			expect(matches[0]).toBe("my important note");
		});

		it("should not match incomplete mentions", () => {
			const query = "This @incomplete and @[[also incomplete";
			const matches: string[] = [];
			let match;

			mentionRegex.lastIndex = 0;

			while ((match = mentionRegex.exec(query)) !== null) {
				matches.push(match[1]);
			}

			expect(matches).toHaveLength(0);
		});
	});

	describe("Query Display Cleaning", () => {
		// Function to clean query for display (removes @[[]] syntax)
		const cleanQueryForDisplay = (query: string): string => {
			return query.replace(/@\[\[([^\]]+)\]\]/g, "[$1]").trim();
		};

		it("should convert @[[filename]] to [filename] for display", () => {
			const query = "Tell me about @[[meeting-notes]]";
			const cleaned = cleanQueryForDisplay(query);

			expect(cleaned).toBe("Tell me about [meeting-notes]");
		});

		it("should handle multiple mentions", () => {
			const query = "Compare @[[file1]] and @[[file2]]";
			const cleaned = cleanQueryForDisplay(query);

			expect(cleaned).toBe("Compare [file1] and [file2]");
		});

		it("should preserve query without mentions", () => {
			const query = "Simple question without mentions";
			const cleaned = cleanQueryForDisplay(query);

			expect(cleaned).toBe("Simple question without mentions");
		});

		it("should trim whitespace", () => {
			const query = "  @[[note]] question  ";
			const cleaned = cleanQueryForDisplay(query);

			expect(cleaned).toBe("[note] question");
		});
	});

	describe("@ Trigger Detection", () => {
		/**
		 * Simulates the @ trigger detection logic from chatView.ts
		 * Returns the position of @ if found, or -1
		 */
		const findAtTrigger = (
			text: string,
			cursorPos: number
		): { atPos: number; query: string } | null => {
			let atPos = -1;

			for (let i = cursorPos - 1; i >= 0; i--) {
				const char = text[i];
				if (char === "@") {
					atPos = i;
					break;
				}
				if (char === " " || char === "\n") {
					break;
				}
			}

			if (atPos === -1) {
				return null;
			}

			return {
				atPos,
				query: text.slice(atPos + 1, cursorPos),
			};
		};

		it("should detect @ at cursor position", () => {
			const text = "Hello @";
			const cursorPos = 7;

			const result = findAtTrigger(text, cursorPos);

			expect(result).not.toBeNull();
			expect(result!.atPos).toBe(6);
			expect(result!.query).toBe("");
		});

		it("should detect @ with partial query", () => {
			const text = "Hello @meet";
			const cursorPos = 11;

			const result = findAtTrigger(text, cursorPos);

			expect(result).not.toBeNull();
			expect(result!.atPos).toBe(6);
			expect(result!.query).toBe("meet");
		});

		it("should not detect @ after space", () => {
			const text = "Hello @ world";
			const cursorPos = 13; // cursor at end

			const result = findAtTrigger(text, cursorPos);

			expect(result).toBeNull();
		});

		it("should detect @ at start of text", () => {
			const text = "@note";
			const cursorPos = 5;

			const result = findAtTrigger(text, cursorPos);

			expect(result).not.toBeNull();
			expect(result!.atPos).toBe(0);
			expect(result!.query).toBe("note");
		});

		it("should detect @ in middle of sentence", () => {
			const text = "Check this @important note";
			const cursorPos = 21; // after "important"

			const result = findAtTrigger(text, cursorPos);

			expect(result).not.toBeNull();
			expect(result!.atPos).toBe(11);
			expect(result!.query).toBe("important");
		});

		it("should handle multiple @ symbols - use closest", () => {
			const text = "@first @second";
			const cursorPos = 14;

			const result = findAtTrigger(text, cursorPos);

			expect(result).not.toBeNull();
			expect(result!.atPos).toBe(7);
			expect(result!.query).toBe("second");
		});

		it("should not trigger on email-like patterns", () => {
			const text = "email@example.com typing here";
			const cursorPos = 29; // at end after space

			const result = findAtTrigger(text, cursorPos);

			expect(result).toBeNull();
		});
	});

	describe("File Suggestion Formatting", () => {
		interface FileSuggestion {
			path: string;
			basename: string;
			parentPath: string;
			excerpt?: string;
			score?: number;
		}

		const formatOmnisearchResults = (
			results: MockOmnisearchResult[]
		): FileSuggestion[] => {
			return results.slice(0, 10).map((result) => {
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
		};

		it("should format Omnisearch results correctly", () => {
			const omnisearchResults: MockOmnisearchResult[] = [
				{
					score: 10,
					vault: "vault",
					path: "folder/note.md",
					basename: "note",
					foundWords: ["test"],
					matches: [],
					excerpt: "Test excerpt",
				},
			];

			const formatted = formatOmnisearchResults(omnisearchResults);

			expect(formatted).toHaveLength(1);
			expect(formatted[0].basename).toBe("note");
			expect(formatted[0].parentPath).toBe("folder");
			expect(formatted[0].excerpt).toBe("Test excerpt");
			expect(formatted[0].score).toBe(10);
		});

		it("should handle root-level files", () => {
			const omnisearchResults: MockOmnisearchResult[] = [
				{
					score: 5,
					vault: "vault",
					path: "root-note.md",
					basename: "root-note",
					foundWords: [],
					matches: [],
					excerpt: "",
				},
			];

			const formatted = formatOmnisearchResults(omnisearchResults);

			expect(formatted[0].parentPath).toBe("");
		});

		it("should limit results to 10", () => {
			const manyResults: MockOmnisearchResult[] = Array.from(
				{ length: 20 },
				(_, i) => ({
					score: 20 - i,
					vault: "vault",
					path: `note${i}.md`,
					basename: `note${i}`,
					foundWords: [],
					matches: [],
					excerpt: "",
				})
			);

			const formatted = formatOmnisearchResults(manyResults);

			expect(formatted).toHaveLength(10);
		});

		it("should handle deeply nested paths", () => {
			const omnisearchResults: MockOmnisearchResult[] = [
				{
					score: 8,
					vault: "vault",
					path: "a/b/c/d/deep-note.md",
					basename: "deep-note",
					foundWords: [],
					matches: [],
					excerpt: "",
				},
			];

			const formatted = formatOmnisearchResults(omnisearchResults);

			expect(formatted[0].parentPath).toBe("a/b/c/d");
		});
	});

	describe("Fallback File Search", () => {
		interface MockFile {
			path: string;
			basename: string;
			parent: { path: string } | null;
		}

		const fallbackSearch = (
			files: MockFile[],
			query: string
		): MockFile[] => {
			const lowerQuery = query.toLowerCase();

			return files
				.filter((file) => {
					const name = file.basename.toLowerCase();
					const path = file.path.toLowerCase();
					return name.includes(lowerQuery) || path.includes(lowerQuery);
				})
				.sort((a, b) => {
					const aBasename = a.basename.toLowerCase();
					const bBasename = b.basename.toLowerCase();
					const aStartsWith = aBasename.startsWith(lowerQuery);
					const bStartsWith = bBasename.startsWith(lowerQuery);
					if (aStartsWith && !bStartsWith) return -1;
					if (!aStartsWith && bStartsWith) return 1;
					return a.basename.localeCompare(b.basename);
				})
				.slice(0, 10);
		};

		const mockFiles: MockFile[] = [
			{ path: "meeting-notes.md", basename: "meeting-notes", parent: null },
			{
				path: "projects/project-plan.md",
				basename: "project-plan",
				parent: { path: "projects" },
			},
			{
				path: "projects/meeting-agenda.md",
				basename: "meeting-agenda",
				parent: { path: "projects" },
			},
			{ path: "ideas.md", basename: "ideas", parent: null },
			{
				path: "archive/old-meeting.md",
				basename: "old-meeting",
				parent: { path: "archive" },
			},
		];

		it("should filter files by basename", () => {
			const results = fallbackSearch(mockFiles, "meeting");

			expect(results.length).toBeGreaterThan(0);
			expect(results.every((f) => f.basename.includes("meeting"))).toBe(
				true
			);
		});

		it("should filter files by path", () => {
			const results = fallbackSearch(mockFiles, "projects");

			expect(results.length).toBe(2);
			expect(results.every((f) => f.path.includes("projects"))).toBe(true);
		});

		it("should prioritize basename matches that start with query", () => {
			const results = fallbackSearch(mockFiles, "meet");

			// meeting-notes and meeting-agenda should come before old-meeting
			expect(results[0].basename).toBe("meeting-agenda");
			expect(results[1].basename).toBe("meeting-notes");
		});

		it("should be case insensitive", () => {
			const results = fallbackSearch(mockFiles, "MEETING");

			expect(results.length).toBeGreaterThan(0);
		});

		it("should return empty array for no matches", () => {
			const results = fallbackSearch(mockFiles, "nonexistent");

			expect(results).toHaveLength(0);
		});

		it("should limit results to 10", () => {
			const manyFiles: MockFile[] = Array.from({ length: 20 }, (_, i) => ({
				path: `note${i}.md`,
				basename: `note${i}`,
				parent: null,
			}));

			const results = fallbackSearch(manyFiles, "note");

			expect(results).toHaveLength(10);
		});
	});
});


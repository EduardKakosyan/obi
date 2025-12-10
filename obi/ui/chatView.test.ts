import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for chat view @ mention functionality
 * These tests focus on the file search and mention parsing logic
 */

// Mock Omnisearch HTTP API response type
interface MockOmnisearchHttpResult {
	score: number;
	vault: string;
	path: string;
	basename: string;
	foundWords: string[];
	matches: Array<{ match: string; offset: number }>;
	excerpt: string;
}

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("@ Mention File Search", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("Omnisearch HTTP Server Integration", () => {
		it("should call Omnisearch HTTP endpoint with query", async () => {
			const mockResults: MockOmnisearchHttpResult[] = [
				{
					score: 10,
					vault: "test-vault",
					path: "notes/meeting-notes.md",
					basename: "meeting-notes",
					foundWords: ["meeting"],
					matches: [{ match: "meeting", offset: 0 }],
					excerpt: "Meeting notes from today...",
				},
			];

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResults),
			});

			const port = 51361;
			const query = "meeting";
			const url = `http://localhost:${port}/search?q=${encodeURIComponent(
				query
			)}`;

			const response = await fetch(url);
			const results = await response.json();

			expect(mockFetch).toHaveBeenCalledWith(url);
			expect(results).toHaveLength(1);
			expect(results[0].basename).toBe("meeting-notes");
		});

		it("should handle HTTP server not running", async () => {
			mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

			const port = 51361;
			const url = `http://localhost:${port}/search?q=test`;

			await expect(fetch(url)).rejects.toThrow("Connection refused");
		});

		it("should handle HTTP error responses", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
			});

			const response = await fetch(
				"http://localhost:51361/search?q=test"
			);

			expect(response.ok).toBe(false);
			expect(response.status).toBe(500);
		});

		it("should properly encode query parameters", () => {
			const query = "2025 meeting notes";
			const encoded = encodeURIComponent(query);
			const url = `http://localhost:51361/search?q=${encoded}`;

			expect(url).toBe(
				"http://localhost:51361/search?q=2025%20meeting%20notes"
			);
		});

		it("should handle special characters in query", () => {
			const query = "meeting @work #important";
			const encoded = encodeURIComponent(query);
			const url = `http://localhost:51361/search?q=${encoded}`;

			expect(url).toContain("search?q=");
			expect(encoded).toBe("meeting%20%40work%20%23important");
		});

		it("should return results with all required fields", async () => {
			const mockResults: MockOmnisearchHttpResult[] = [
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

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResults),
			});

			const response = await fetch(
				"http://localhost:51361/search?q=test"
			);
			const results: MockOmnisearchHttpResult[] = await response.json();

			expect(results[0].score).toBe(15.5);
			expect(results[0].excerpt).toBe("This is a test query example...");
			expect(results[0].path).toBe("folder/subfolder/note.md");
			expect(results[0].basename).toBe("note");
			expect(results[0].foundWords).toContain("test");
		});

		it("should handle empty results array", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve([]),
			});

			const response = await fetch(
				"http://localhost:51361/search?q=nonexistent"
			);
			const results = await response.json();

			expect(results).toHaveLength(0);
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
			results: MockOmnisearchHttpResult[]
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
			const omnisearchResults: MockOmnisearchHttpResult[] = [
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
			const omnisearchResults: MockOmnisearchHttpResult[] = [
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
			const manyResults: MockOmnisearchHttpResult[] = Array.from(
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
			const omnisearchResults: MockOmnisearchHttpResult[] = [
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
					return (
						name.includes(lowerQuery) || path.includes(lowerQuery)
					);
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
			{
				path: "meeting-notes.md",
				basename: "meeting-notes",
				parent: null,
			},
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
			expect(results.every((f) => f.path.includes("projects"))).toBe(
				true
			);
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
			const manyFiles: MockFile[] = Array.from(
				{ length: 20 },
				(_, i) => ({
					path: `note${i}.md`,
					basename: `note${i}`,
					parent: null,
				})
			);

			const results = fallbackSearch(manyFiles, "note");

			expect(results).toHaveLength(10);
		});
	});
});

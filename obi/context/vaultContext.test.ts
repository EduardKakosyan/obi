import { describe, it, expect } from "vitest";
import { _testing } from "./vaultContext";

const { extractKeywords, calculateScore, trimToTokenBudget, estimateTokens } =
	_testing;

describe("vaultContext utilities", () => {
	describe("estimateTokens", () => {
		it("should estimate tokens as ~4 chars per token", () => {
			expect(estimateTokens("hello")).toBe(2); // 5 chars / 4 = 1.25 → 2
			expect(estimateTokens("hello world")).toBe(3); // 11 chars / 4 = 2.75 → 3
			expect(estimateTokens("")).toBe(0);
		});
	});

	describe("extractKeywords", () => {
		it("should extract meaningful keywords from a query", () => {
			const keywords = extractKeywords(
				"What is the meeting agenda for project Alpha?"
			);

			expect(keywords).toContain("meeting");
			expect(keywords).toContain("agenda");
			expect(keywords).toContain("project");
			expect(keywords).toContain("alpha");
		});

		it("should filter out stop words", () => {
			const keywords = extractKeywords("What is the meaning of life?");

			expect(keywords).not.toContain("what");
			expect(keywords).not.toContain("is");
			expect(keywords).not.toContain("the");
			expect(keywords).not.toContain("of");
			expect(keywords).toContain("meaning");
			expect(keywords).toContain("life");
		});

		it("should filter out short words", () => {
			const keywords = extractKeywords("A is to be or not to be");

			expect(keywords).toHaveLength(0);
		});

		it("should handle empty input", () => {
			expect(extractKeywords("")).toHaveLength(0);
		});

		it("should lowercase keywords", () => {
			const keywords = extractKeywords("HELLO World JavaScript");

			expect(keywords).toContain("hello");
			expect(keywords).toContain("world");
			expect(keywords).toContain("javascript");
		});

		it("should remove punctuation", () => {
			const keywords = extractKeywords("Hello, world! How's it going?");

			expect(keywords).toContain("hello");
			expect(keywords).toContain("world");
			expect(keywords).toContain("going");
		});
	});

	describe("calculateScore", () => {
		it("should return 0 for empty keywords", () => {
			const score = calculateScore("some content", "filename", []);

			expect(score).toBe(0);
		});

		it("should score higher for more keyword matches", () => {
			const content = "meeting agenda meeting notes from the meeting";

			const scoreMeeting = calculateScore(content, "file", ["meeting"]);
			const scoreAgenda = calculateScore(content, "file", ["agenda"]);

			expect(scoreMeeting).toBeGreaterThan(scoreAgenda);
		});

		it("should give bonus for filename matches", () => {
			const content = "some project notes";

			const scoreWithFilename = calculateScore(content, "project-plan", [
				"project",
			]);
			const scoreWithoutFilename = calculateScore(content, "random-file", [
				"project",
			]);

			expect(scoreWithFilename).toBeGreaterThan(scoreWithoutFilename);
		});

		it("should normalize by content length", () => {
			const shortContent = "meeting meeting";
			const longContent =
				"meeting " + "x ".repeat(1000) + "meeting";

			const shortScore = calculateScore(shortContent, "file", ["meeting"]);
			const longScore = calculateScore(longContent, "file", ["meeting"]);

			// Short content with same matches should score higher
			expect(shortScore).toBeGreaterThan(longScore);
		});
	});

	describe("trimToTokenBudget", () => {
		it("should return content unchanged if within budget", () => {
			const content = "Short content";
			const result = trimToTokenBudget(content, 100);

			expect(result).toBe(content);
		});

		it("should trim content that exceeds budget", () => {
			const content = "a".repeat(1000);
			const result = trimToTokenBudget(content, 50);

			// 50 tokens * 4 chars = 200 chars max
			expect(result.length).toBeLessThanOrEqual(210); // Allow for [...] suffix
		});

		it("should try to end at paragraph boundary", () => {
			const content =
				"First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
			const result = trimToTokenBudget(content, 12); // ~48 chars

			expect(result).toContain("First paragraph");
			expect(result).toContain("[...]");
		});

		it("should try to end at sentence boundary", () => {
			const content =
				"First sentence. Second sentence. Third sentence.";
			const result = trimToTokenBudget(content, 10); // ~40 chars

			expect(result).toContain("[...]");
		});

		it("should handle content with no natural boundaries", () => {
			const content = "a".repeat(500);
			const result = trimToTokenBudget(content, 10);

			expect(result).toContain("[...]");
			expect(result.length).toBeLessThanOrEqual(50);
		});
	});
});

describe("VaultContextProvider", () => {
	// Integration tests would require mocking the Obsidian App,
	// which is complex. The unit tests above cover the core logic.
	// For full integration testing, consider using the plugin in a
	// test vault or creating more sophisticated mocks.

	it("should have exported utility functions for testing", () => {
		expect(extractKeywords).toBeDefined();
		expect(calculateScore).toBeDefined();
		expect(trimToTokenBudget).toBeDefined();
		expect(estimateTokens).toBeDefined();
	});
});


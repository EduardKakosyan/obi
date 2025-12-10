import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LMClient, LMClientError, createLMClient } from "./lmClient";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("LMClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("chat", () => {
		it("should send a chat request and return the assistant message", async () => {
			const mockResponse = {
				id: "test-id",
				object: "chat.completion",
				created: Date.now(),
				model: "test-model",
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: "Hello! How can I help you?",
						},
						finish_reason: "stop",
					},
				],
			};

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			});

			const client = new LMClient({
				endpoint: "http://localhost:1234/v1",
				model: "test-model",
			});

			const result = await client.chat([
				{ role: "user", content: "Hello" },
			]);

			expect(result).toEqual({
				role: "assistant",
				content: "Hello! How can I help you?",
			});

			expect(mockFetch).toHaveBeenCalledWith(
				"http://localhost:1234/v1/chat/completions",
				expect.objectContaining({
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model: "test-model",
						messages: [{ role: "user", content: "Hello" }],
						stream: false,
					}),
				})
			);
		});

		it("should include authorization header when apiKey is provided", async () => {
			const mockResponse = {
				id: "test-id",
				object: "chat.completion",
				created: Date.now(),
				model: "test-model",
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: "Response" },
						finish_reason: "stop",
					},
				],
			};

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			});

			const client = new LMClient({
				endpoint: "http://localhost:1234/v1",
				model: "test-model",
				apiKey: "test-api-key",
			});

			await client.chat([{ role: "user", content: "Hello" }]);

			expect(mockFetch).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer test-api-key",
					},
				})
			);
		});

		it("should throw LMClientError on HTTP error response", async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
				text: () => Promise.resolve("Server error details"),
			});

			const client = new LMClient({
				endpoint: "http://localhost:1234/v1",
				model: "test-model",
			});

			await expect(
				client.chat([{ role: "user", content: "Hello" }])
			).rejects.toThrow(LMClientError);

			try {
				await client.chat([{ role: "user", content: "Hello" }]);
			} catch (error) {
				expect(error).toBeInstanceOf(LMClientError);
				expect((error as LMClientError).statusCode).toBe(500);
			}
		});

		it("should throw LMClientError when no choices are returned", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						id: "test-id",
						choices: [],
					}),
			});

			const client = new LMClient({
				endpoint: "http://localhost:1234/v1",
				model: "test-model",
			});

			await expect(
				client.chat([{ role: "user", content: "Hello" }])
			).rejects.toThrow("No response choices returned from LM Studio");
		});

		it("should throw LMClientError on network error", async () => {
			mockFetch.mockRejectedValueOnce(new Error("Network failure"));

			const client = new LMClient({
				endpoint: "http://localhost:1234/v1",
				model: "test-model",
			});

			await expect(
				client.chat([{ role: "user", content: "Hello" }])
			).rejects.toThrow("Network error: Network failure");
		});
	});

	describe("updateConfig", () => {
		it("should update client configuration", async () => {
			const mockResponse = {
				id: "test-id",
				object: "chat.completion",
				created: Date.now(),
				model: "new-model",
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: "Response" },
						finish_reason: "stop",
					},
				],
			};

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			});

			const client = new LMClient({
				endpoint: "http://localhost:1234/v1",
				model: "old-model",
			});

			client.updateConfig({ model: "new-model" });

			await client.chat([{ role: "user", content: "Hello" }]);

			expect(mockFetch).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					body: expect.stringContaining('"model":"new-model"'),
				})
			);
		});
	});

	describe("createLMClient", () => {
		it("should create a client from settings", () => {
			const client = createLMClient({
				endpoint: "http://test:8080/v1",
				model: "my-model",
				apiKey: "my-key",
			});

			expect(client).toBeInstanceOf(LMClient);
		});

		it("should handle empty apiKey", () => {
			const client = createLMClient({
				endpoint: "http://test:8080/v1",
				model: "my-model",
				apiKey: "",
			});

			expect(client).toBeInstanceOf(LMClient);
		});
	});
});


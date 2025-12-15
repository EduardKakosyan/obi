import { requestUrl } from "obsidian";
import { ChatMessage } from "../types";
import { ILMClient, LLMClientError } from "./types";

export interface GeminiLMClientConfig {
	apiKey: string;
	model: string;
	timeout?: number;
}

interface GeminiContent {
	role: "user" | "model";
	parts: Array<{ text: string }>;
}

interface GeminiResponse {
	candidates?: Array<{
		content: {
			parts: Array<{ text: string }>;
			role: string;
		};
		finishReason: string;
	}>;
	error?: {
		code: number;
		message: string;
		status: string;
	};
}

/**
 * Client for communicating with Google's Gemini API
 */
export class GeminiLMClient implements ILMClient {
	private config: GeminiLMClientConfig;
	private baseUrl = "https://generativelanguage.googleapis.com/v1beta";

	constructor(config: GeminiLMClientConfig) {
		this.config = {
			timeout: 60000, // 60 second default timeout
			...config,
		};
	}

	/**
	 * Convert ChatMessage array to Gemini format
	 * Gemini expects "user" and "model" roles, with system instructions handled separately
	 */
	private convertToGeminiFormat(messages: ChatMessage[]): {
		contents: GeminiContent[];
		systemInstruction?: { parts: Array<{ text: string }> };
	} {
		const contents: GeminiContent[] = [];
		let systemInstruction: { parts: Array<{ text: string }> } | undefined;

		for (const message of messages) {
			if (message.role === "system") {
				// Combine all system messages into system instruction
				if (!systemInstruction) {
					systemInstruction = { parts: [] };
				}
				systemInstruction.parts.push({ text: message.content });
			} else {
				// Map "assistant" to "model" for Gemini
				const role = message.role === "assistant" ? "model" : "user";
				contents.push({
					role,
					parts: [{ text: message.content }],
				});
			}
		}

		// Ensure conversation starts with user message (Gemini requirement)
		// If it starts with model, prepend an empty user turn
		if (contents.length > 0 && contents[0].role === "model") {
			contents.unshift({
				role: "user",
				parts: [{ text: "(continuing conversation)" }],
			});
		}

		return { contents, systemInstruction };
	}

	/**
	 * Send a chat completion request to Gemini
	 */
	async chat(messages: ChatMessage[]): Promise<ChatMessage> {
		const url = `${this.baseUrl}/models/${this.config.model}:generateContent?key=${this.config.apiKey}`;

		const { contents, systemInstruction } =
			this.convertToGeminiFormat(messages);

		const requestBody: Record<string, unknown> = {
			contents,
			generationConfig: {
				temperature: 0.7,
				maxOutputTokens: 8192,
			},
		};

		if (systemInstruction) {
			requestBody.systemInstruction = systemInstruction;
		}

		try {
			const response = await requestUrl({
				url,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(requestBody),
				throw: false,
			});

			if (response.status !== 200) {
				const errorData = response.json as GeminiResponse;
				const errorMessage =
					errorData?.error?.message || response.text || "Unknown error";
				throw new LLMClientError(
					`Gemini API error: ${errorMessage}`,
					response.status,
					response.text
				);
			}

			const data: GeminiResponse = response.json;

			if (!data.candidates || data.candidates.length === 0) {
				throw new LLMClientError("No response candidates returned from Gemini");
			}

			const candidate = data.candidates[0];
			if (!candidate.content?.parts || candidate.content.parts.length === 0) {
				throw new LLMClientError("Empty response from Gemini");
			}

			// Combine all text parts
			const responseText = candidate.content.parts
				.map((part) => part.text)
				.join("");

			return {
				role: "assistant",
				content: responseText,
			};
		} catch (error) {
			if (error instanceof LLMClientError) {
				throw error;
			}

			if (error instanceof Error) {
				throw new LLMClientError(`Gemini request failed: ${error.message}`);
			}

			throw new LLMClientError("Unknown error occurred");
		}
	}

	/**
	 * Update the client configuration
	 */
	updateConfig(config: Partial<GeminiLMClientConfig>) {
		this.config = { ...this.config, ...config };
	}

	/**
	 * Test connection to Gemini API
	 */
	async testConnection(): Promise<boolean> {
		try {
			const response = await this.chat([
				{ role: "user", content: "Say 'ok' and nothing else." },
			]);
			return !!response.content;
		} catch (e) {
			console.error("[Obi] Gemini LLM test failed:", e);
			return false;
		}
	}
}

/**
 * Create a GeminiLMClient from plugin settings
 */
export function createGeminiLMClient(settings: {
	geminiApiKey: string;
	geminiModel: string;
}): GeminiLMClient {
	return new GeminiLMClient({
		apiKey: settings.geminiApiKey,
		model: settings.geminiModel,
	});
}


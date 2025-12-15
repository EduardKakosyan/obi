import { ChatMessage, LMStudioResponse } from "../types";
import { ILMClient, LLMClientError } from "./types";

export interface LocalLMClientConfig {
	endpoint: string;
	model: string;
	apiKey?: string;
	timeout?: number;
}

// Re-export for backwards compatibility
export { LLMClientError as LMClientError } from "./types";

/**
 * Client for communicating with LM Studio's OpenAI-compatible API
 */
export class LocalLMClient implements ILMClient {
	private config: LocalLMClientConfig;

	constructor(config: LocalLMClientConfig) {
		this.config = {
			timeout: 60000, // 60 second default timeout
			...config,
		};
	}

	/**
	 * Send a chat completion request to LM Studio
	 */
	async chat(messages: ChatMessage[]): Promise<ChatMessage> {
		const url = `${this.config.endpoint}/chat/completions`;

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};

		if (this.config.apiKey) {
			headers["Authorization"] = `Bearer ${this.config.apiKey}`;
		}

		const body = JSON.stringify({
			model: this.config.model,
			messages: messages,
			stream: false,
		});

		const controller = new AbortController();
		const timeoutId = setTimeout(
			() => controller.abort(),
			this.config.timeout
		);

		try {
			const response = await fetch(url, {
				method: "POST",
				headers,
				body,
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				const responseBody = await response.text();
				throw new LLMClientError(
					`LM Studio API error: ${response.status} ${response.statusText}`,
					response.status,
					responseBody
				);
			}

			const data: LMStudioResponse = await response.json();

			if (!data.choices || data.choices.length === 0) {
				throw new LLMClientError("No response choices returned from LM Studio");
			}

			return data.choices[0].message;
		} catch (error) {
			clearTimeout(timeoutId);

			if (error instanceof LLMClientError) {
				throw error;
			}

			if (error instanceof Error) {
				if (error.name === "AbortError") {
					throw new LLMClientError(
						`Request timed out after ${this.config.timeout}ms`
					);
				}
				throw new LLMClientError(`Network error: ${error.message}`);
			}

			throw new LLMClientError("Unknown error occurred");
		}
	}

	/**
	 * Update the client configuration
	 */
	updateConfig(config: Partial<LocalLMClientConfig>) {
		this.config = { ...this.config, ...config };
	}

	/**
	 * Test connection to the LM Studio server
	 */
	async testConnection(): Promise<boolean> {
		try {
			const response = await this.chat([
				{ role: "user", content: "Hello" },
			]);
			return !!response.content;
		} catch {
			return false;
		}
	}
}

/**
 * Backwards compatibility alias
 */
export const LMClient = LocalLMClient;

/**
 * Create a LocalLMClient instance from plugin settings
 */
export function createLMClient(settings: {
	endpoint: string;
	model: string;
	apiKey: string;
}): LocalLMClient {
	return new LocalLMClient({
		endpoint: settings.endpoint,
		model: settings.model,
		apiKey: settings.apiKey || undefined,
	});
}

/**
 * Create a LocalLMClient instance from plugin settings (explicit name)
 */
export function createLocalLMClient(settings: {
	endpoint: string;
	model: string;
	apiKey: string;
}): LocalLMClient {
	return new LocalLMClient({
		endpoint: settings.endpoint,
		model: settings.model,
		apiKey: settings.apiKey || undefined,
	});
}

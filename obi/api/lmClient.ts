import { ChatMessage, LMStudioResponse } from "../types";
import { ToolDefinition, ToolCall, ToolResult, LLMResponse } from "../tools/types";
import { ILMClient, ChatOptions, LLMClientError } from "./types";

export interface LocalLMClientConfig {
	endpoint: string;
	model: string;
	apiKey?: string;
	timeout?: number;
}

// Re-export for backwards compatibility
export { LLMClientError as LMClientError } from "./types";

/** OpenAI-compatible tool definition format */
interface OpenAITool {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: {
			type: "object";
			properties: Record<string, unknown>;
			required?: string[];
		};
	};
}

/** OpenAI-compatible tool call in response */
interface OpenAIToolCall {
	id: string;
	type: "function";
	function: {
		name: string;
		arguments: string; // JSON string
	};
}

/** Extended response type that includes tool calls */
interface OpenAIResponse {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: Array<{
		index: number;
		message: {
			role: "assistant";
			content: string | null;
			tool_calls?: OpenAIToolCall[];
		};
		finish_reason: string;
	}>;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

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
	 * Convert our tool definitions to OpenAI format
	 */
	private convertToolsToOpenAIFormat(tools: ToolDefinition[]): OpenAITool[] {
		return tools.map((tool) => ({
			type: "function" as const,
			function: {
				name: tool.name,
				description: tool.description,
				parameters: {
					type: "object",
					properties: tool.parameters.properties,
					required: tool.parameters.required,
				},
			},
		}));
	}

	/**
	 * Build messages array including tool results if provided
	 */
	private buildMessages(
		messages: ChatMessage[],
		toolResults?: ToolResult[]
	): Array<Record<string, unknown>> {
		const result: Array<Record<string, unknown>> = messages.map((m) => ({
			role: m.role,
			content: m.content,
		}));

		// Add tool results as tool response messages
		if (toolResults && toolResults.length > 0) {
			for (const toolResult of toolResults) {
				result.push({
					role: "tool",
					tool_call_id: toolResult.callId,
					content: toolResult.content,
				});
			}
		}

		return result;
	}

	/**
	 * Send a chat completion request to LM Studio
	 */
	async chat(
		messages: ChatMessage[],
		options?: ChatOptions
	): Promise<LLMResponse> {
		const url = `${this.config.endpoint}/chat/completions`;

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};

		if (this.config.apiKey) {
			headers["Authorization"] = `Bearer ${this.config.apiKey}`;
		}

		const requestBody: Record<string, unknown> = {
			model: this.config.model,
			messages: this.buildMessages(messages, options?.toolResults),
			stream: false,
		};

		// Add tools if provided
		if (options?.tools && options.tools.length > 0) {
			requestBody.tools = this.convertToolsToOpenAIFormat(options.tools);
			requestBody.tool_choice = "auto";
		}

		const controller = new AbortController();
		const timeoutId = setTimeout(
			() => controller.abort(),
			this.config.timeout
		);

		try {
			const response = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(requestBody),
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

			const data: OpenAIResponse = await response.json();

			if (!data.choices || data.choices.length === 0) {
				throw new LLMClientError(
					"No response choices returned from LM Studio"
				);
			}

			const choice = data.choices[0];

			// Check if response contains tool calls
			if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
				const toolCalls: ToolCall[] = choice.message.tool_calls.map(
					(tc) => {
						let args: Record<string, unknown> = {};
						try {
							args = JSON.parse(tc.function.arguments);
						} catch {
							console.warn(
								`[Obi] Failed to parse tool arguments: ${tc.function.arguments}`
							);
						}

						return {
							id: tc.id,
							name: tc.function.name,
							arguments: args,
						};
					}
				);

				return { toolCalls };
			}

			// Regular text response
			return {
				message: {
					role: "assistant",
					content: choice.message.content || "",
				},
			};
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
			return !!response.message?.content;
		} catch {
			return false;
		}
	}

	/**
	 * LM Studio supports OpenAI-compatible function calling
	 * (depends on the model loaded, but we assume it does)
	 */
	supportsTools(): boolean {
		return true;
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

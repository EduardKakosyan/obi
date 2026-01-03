import { requestUrl } from "obsidian";
import { ChatMessage } from "../types";
import {
	ToolDefinition,
	ToolCall,
	ToolResult,
	LLMResponse,
} from "../tools/types";
import { ILMClient, ChatOptions, LLMClientError } from "./types";

export interface GeminiLMClientConfig {
	apiKey: string;
	model: string;
	timeout?: number;
}

/** Gemini content part - can be text or function call/response */
interface GeminiPart {
	text?: string;
	functionCall?: {
		name: string;
		args: Record<string, unknown>;
	};
	functionResponse?: {
		name: string;
		response: {
			content: string;
		};
	};
}

interface GeminiContent {
	role: "user" | "model";
	parts: GeminiPart[];
}

/** Gemini function declaration format */
interface GeminiFunctionDeclaration {
	name: string;
	description: string;
	parameters: {
		type: "object";
		properties: Record<string, unknown>;
		required?: string[];
	};
}

interface GeminiResponse {
	candidates?: Array<{
		content: {
			parts: GeminiPart[];
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
	 * Extract tool name from callId
	 * CallId format: "toolName::timestamp::index"
	 */
	private extractToolNameFromCallId(callId: string): string {
		// Split by :: separator (used to avoid conflicts with underscores in tool names)
		const parts = callId.split("::");
		if (parts.length >= 1 && parts[0]) {
			return parts[0];
		}
		// Fallback: try underscore separator for backwards compatibility
		// This handles older format but may fail for multi-underscore tool names
		return callId.split("_")[0] || "unknown";
	}

	/**
	 * Convert tool definitions to Gemini function declaration format
	 */
	private convertToolsToGeminiFormat(tools: ToolDefinition[]): {
		functionDeclarations: GeminiFunctionDeclaration[];
	} {
		return {
			functionDeclarations: tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				parameters: {
					type: "object",
					properties: tool.parameters.properties,
					required: tool.parameters.required,
				},
			})),
		};
	}

	/**
	 * Convert ChatMessage array to Gemini format
	 * Gemini expects "user" and "model" roles, with system instructions handled separately
	 */
	private convertToGeminiFormat(
		messages: ChatMessage[],
		toolResults?: ToolResult[]
	): {
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

		// Add tool results as function responses if provided
		if (toolResults && toolResults.length > 0) {
			// Tool results should be added as a user message with functionResponse parts
			const functionResponseParts: GeminiPart[] = toolResults.map(
				(result) => ({
					functionResponse: {
						name: this.extractToolNameFromCallId(result.callId),
						response: {
							content: result.content,
						},
					},
				})
			);

			contents.push({
				role: "user",
				parts: functionResponseParts,
			});
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
	async chat(
		messages: ChatMessage[],
		options?: ChatOptions
	): Promise<LLMResponse> {
		const url = `${this.baseUrl}/models/${this.config.model}:generateContent?key=${this.config.apiKey}`;

		const { contents, systemInstruction } = this.convertToGeminiFormat(
			messages,
			options?.toolResults
		);

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

		// Add tools if provided
		if (options?.tools && options.tools.length > 0) {
			requestBody.tools = [
				this.convertToolsToGeminiFormat(options.tools),
			];
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
					errorData?.error?.message ||
					response.text ||
					"Unknown error";
				throw new LLMClientError(
					`Gemini API error: ${errorMessage}`,
					response.status,
					response.text
				);
			}

			const data: GeminiResponse = response.json;

			if (!data.candidates || data.candidates.length === 0) {
				throw new LLMClientError(
					"No response candidates returned from Gemini"
				);
			}

			const candidate = data.candidates[0];
			if (
				!candidate.content?.parts ||
				candidate.content.parts.length === 0
			) {
				throw new LLMClientError("Empty response from Gemini");
			}

			// Check if response contains function calls
			const functionCalls = candidate.content.parts.filter(
				(part) => part.functionCall
			);

			if (functionCalls.length > 0) {
				// Convert Gemini function calls to our ToolCall format
				// Use :: as separator to avoid conflicts with underscores in tool names
				const toolCalls: ToolCall[] = functionCalls.map(
					(part, index) => ({
						id: `${
							part.functionCall!.name
						}::${Date.now()}::${index}`,
						name: part.functionCall!.name,
						arguments: part.functionCall!.args,
					})
				);

				return { toolCalls };
			}

			// Regular text response
			const textParts = candidate.content.parts.filter(
				(part) => part.text
			);
			const responseText = textParts.map((part) => part.text).join("");

			return {
				message: {
					role: "assistant",
					content: responseText,
				},
			};
		} catch (error) {
			if (error instanceof LLMClientError) {
				throw error;
			}

			if (error instanceof Error) {
				throw new LLMClientError(
					`Gemini request failed: ${error.message}`
				);
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
			return !!response.message?.content;
		} catch (e) {
			console.error("[Obi] Gemini LLM test failed:", e);
			return false;
		}
	}

	/**
	 * Gemini supports function calling
	 */
	supportsTools(): boolean {
		return true;
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

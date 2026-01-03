/** A single message in the chat history */
export interface ChatMessage {
	role: "user" | "assistant" | "system";
	content: string;
}

/** Response structure from the LM Studio API */
export interface LMStudioResponse {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: Array<{
		index: number;
		message: ChatMessage;
		finish_reason: string;
	}>;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

/** A context snippet extracted from a vault file */
export interface ContextSnippet {
	/** Path to the source file */
	filePath: string;
	/** The actual content snippet */
	content: string;
	/** Relevance score (higher is more relevant) */
	score: number;
}


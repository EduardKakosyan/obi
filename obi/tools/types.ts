/**
 * JSON Schema property definition for tool parameters
 */
export interface JSONSchemaProperty {
	type: "string" | "number" | "boolean" | "array" | "object";
	description?: string;
	enum?: string[];
	items?: JSONSchemaProperty;
	properties?: Record<string, JSONSchemaProperty>;
	required?: string[];
}

/**
 * JSON Schema for tool parameters
 */
export interface ToolParametersSchema {
	type: "object";
	properties: Record<string, JSONSchemaProperty>;
	required?: string[];
}

/**
 * Definition of a tool that can be called by the LLM
 */
export interface ToolDefinition {
	/** Unique name of the tool */
	name: string;
	/** Human-readable description of what the tool does */
	description: string;
	/** JSON Schema defining the tool's parameters */
	parameters: ToolParametersSchema;
}

/**
 * A tool call requested by the LLM
 */
export interface ToolCall {
	/** Unique ID for this tool call (used to match results) */
	id: string;
	/** Name of the tool to execute */
	name: string;
	/** Arguments to pass to the tool (parsed from JSON) */
	arguments: Record<string, unknown>;
}

/**
 * Result of executing a tool
 */
export interface ToolResult {
	/** ID of the tool call this result corresponds to */
	callId: string;
	/** Whether the tool executed successfully */
	success: boolean;
	/** Result content (success message or error details) */
	content: string;
}

/**
 * Response from an LLM that may contain text or tool calls
 */
export interface LLMResponse {
	/** Text message from the assistant (if not a tool call) */
	message?: {
		role: "assistant";
		content: string;
	};
	/** Tool calls requested by the assistant */
	toolCalls?: ToolCall[];
}


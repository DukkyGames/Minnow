const MAX_TOOL_CALL_SCHEMA_BRANCHES = 8;
const TOOL_CALL_SCHEMA_NAME = "minnow_tool_calls";
function buildToolCallResponseFormat(tools) {
  if (tools.length === 0) return null;
  const limited = tools.slice(0, MAX_TOOL_CALL_SCHEMA_BRANCHES);
  const toolBranches = limited.map((tool) => {
    const name = tool.function.name;
    const params = tool.function.parameters ?? { type: "object", properties: {} };
    return {
      type: "object",
      properties: {
        name: { type: "string", const: name },
        arguments: params
      },
      required: ["name", "arguments"],
      additionalProperties: false
    };
  });
  const itemSchema = toolBranches.length === 1 ? toolBranches[0] : { oneOf: toolBranches };
  return {
    type: "json_schema",
    json_schema: {
      name: TOOL_CALL_SCHEMA_NAME,
      strict: true,
      schema: {
        type: "object",
        properties: {
          tool_calls: {
            type: "array",
            items: itemSchema,
            minItems: 1,
            maxItems: MAX_TOOL_CALL_SCHEMA_BRANCHES
          }
        },
        required: ["tool_calls"],
        additionalProperties: false
      }
    }
  };
}
export {
  MAX_TOOL_CALL_SCHEMA_BRANCHES,
  buildToolCallResponseFormat
};

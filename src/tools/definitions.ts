/**
 * Built-in tool catalog for LM Studio function calling.
 * Browser-native tools run in TS; server-required tools proxy to /api/tools.
 */

/** Tool grouping for settings UI and documentation. */
export type ToolCategory = 'web' | 'utility' | 'files' | 'git' | 'code' | 'agents';

/** OpenAI-compatible function tool schema sent to chat completions. */
export interface OpenAIFunctionDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

/** One catalog entry: metadata plus the API function definition. */
export interface ToolDefinition {
  id: string;
  label: string;
  description: string;
  category: ToolCategory;
  serverRequired: boolean;
  requiresKey?: boolean;
  keyId?: string;
  definition: OpenAIFunctionDefinition;
}

/** Builds a function schema; `name` matches the executor entry point. */
function toolSchema(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required?: string[],
): OpenAIFunctionDefinition {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        ...(required && required.length > 0 ? { required } : {}),
      },
    },
  };
}

/**
 * All built-in tools (9 browser-native, 23 server-required).
 * Function `name` in each schema matches execution routing (browser or server).
 */
export const BUILT_IN_TOOLS: ToolDefinition[] = [
  // --- Browser-native (serverRequired: false) ---
  {
    id: 'get_datetime',
    label: 'Date & time',
    description: 'Returns the current date and time in ISO 8601 format.',
    category: 'utility',
    serverRequired: false,
    definition: toolSchema(
      'get_datetime',
      'Get the current date and time as an ISO 8601 string.',
      {},
    ),
  },
  {
    id: 'calculate',
    label: 'Calculate',
    description: 'Evaluates a safe math expression using JavaScript Math.',
    category: 'utility',
    serverRequired: false,
    definition: toolSchema(
      'calculate',
      'Evaluate a mathematical expression (numbers, + - * / % parentheses, Math functions).',
      {
        expression: {
          type: 'string',
          description: 'Math expression to evaluate, e.g. "(2 + 3) * 4"',
        },
      },
      ['expression'],
    ),
  },
  {
    id: 'web_search',
    label: 'Web search',
    description: 'Search the web via Brave API when a key is set; otherwise uses DuckDuckGo on the server.',
    category: 'web',
    serverRequired: false,
    requiresKey: true,
    keyId: 'braveApiKey',
    definition: toolSchema(
      'web_search',
      'Search the web for up-to-date information. Uses Brave Search when api_key is provided.',
      {
        query: { type: 'string', description: 'Search query' },
        api_key: {
          type: 'string',
          description: 'Optional Brave Search API key (overrides saved key)',
        },
      },
      ['query'],
    ),
  },
  {
    id: 'wikipedia_search',
    label: 'Wikipedia',
    description: 'Search Wikipedia summaries via the public REST API.',
    category: 'web',
    serverRequired: false,
    definition: toolSchema(
      'wikipedia_search',
      'Search Wikipedia and return article summaries.',
      {
        query: { type: 'string', description: 'Topic or search terms' },
      },
      ['query'],
    ),
  },
  {
    id: 'fetch_web_content',
    label: 'Fetch page',
    description: 'Fetches a URL and returns stripped plain text (about 8KB max). Subject to CORS in the browser.',
    category: 'web',
    serverRequired: false,
    definition: toolSchema(
      'fetch_web_content',
      'Fetch a web page URL and return its main text content (HTML stripped, length capped).',
      {
        url: { type: 'string', description: 'HTTP or HTTPS URL to fetch' },
      },
      ['url'],
    ),
  },
  {
    id: 'rag_web_content',
    label: 'Web RAG',
    description: 'Fetches a page and returns sentences most relevant to a query.',
    category: 'web',
    serverRequired: false,
    definition: toolSchema(
      'rag_web_content',
      'Fetch a web page and return text snippets most relevant to the query.',
      {
        url: { type: 'string', description: 'HTTP or HTTPS URL to fetch' },
        query: { type: 'string', description: 'What to extract from the page' },
      },
      ['url', 'query'],
    ),
  },
  {
    id: 'read_clipboard',
    label: 'Read clipboard',
    description: 'Reads plain text from the system clipboard (requires permission).',
    category: 'utility',
    serverRequired: false,
    definition: toolSchema(
      'read_clipboard',
      'Read plain text from the clipboard.',
      {},
    ),
  },
  {
    id: 'write_clipboard',
    label: 'Write clipboard',
    description: 'Writes plain text to the system clipboard.',
    category: 'utility',
    serverRequired: false,
    definition: toolSchema(
      'write_clipboard',
      'Write plain text to the clipboard.',
      {
        text: { type: 'string', description: 'Text to copy to the clipboard' },
      },
      ['text'],
    ),
  },
  {
    id: 'get_system_info',
    label: 'System info',
    description: 'Returns browser, screen, and device information from the client.',
    category: 'utility',
    serverRequired: false,
    definition: toolSchema(
      'get_system_info',
      'Get browser user agent, screen size, and related client environment info.',
      {},
    ),
  },

  // --- Server-required (serverRequired: true) ---
  {
    id: 'list_directory',
    label: 'List directory',
    description: 'Lists files and folders in a directory under the project.',
    category: 'files',
    serverRequired: true,
    definition: toolSchema(
      'list_directory',
      'List entries in a directory (names and file/directory type).',
      {
        path: {
          type: 'string',
          description: 'Relative path from project root, or "." for root',
        },
      },
      ['path'],
    ),
  },
  {
    id: 'read_file',
    label: 'Read file',
    description: 'Reads the full text content of a file.',
    category: 'files',
    serverRequired: true,
    definition: toolSchema(
      'read_file',
      'Read a UTF-8 text file from the project.',
      {
        path: { type: 'string', description: 'Relative file path' },
      },
      ['path'],
    ),
  },
  {
    id: 'read_file_range',
    label: 'Read file lines',
    description: 'Reads a line range from a text file (1-based line numbers).',
    category: 'files',
    serverRequired: true,
    definition: toolSchema(
      'read_file_range',
      'Read a range of lines from a text file (inclusive, 1-based).',
      {
        path: { type: 'string', description: 'Relative file path' },
        start_line: { type: 'integer', description: 'First line number (1-based)' },
        end_line: { type: 'integer', description: 'Last line number (inclusive)' },
      },
      ['path', 'start_line', 'end_line'],
    ),
  },
  {
    id: 'save_file',
    label: 'Save file',
    description: 'Creates or overwrites a file with the given content.',
    category: 'files',
    serverRequired: true,
    definition: toolSchema(
      'save_file',
      'Write content to a file (creates or overwrites).',
      {
        path: { type: 'string', description: 'Relative file path' },
        content: { type: 'string', description: 'Full file content' },
      },
      ['path', 'content'],
    ),
  },
  {
    id: 'append_file',
    label: 'Append file',
    description: 'Appends text to the end of a file.',
    category: 'files',
    serverRequired: true,
    definition: toolSchema(
      'append_file',
      'Append text to the end of a file.',
      {
        path: { type: 'string', description: 'Relative file path' },
        content: { type: 'string', description: 'Text to append' },
      },
      ['path', 'content'],
    ),
  },
  {
    id: 'insert_at_line',
    label: 'Insert at line',
    description: 'Inserts text at a specific line in a file.',
    category: 'files',
    serverRequired: true,
    definition: toolSchema(
      'insert_at_line',
      'Insert lines at a given line number in a file (1-based).',
      {
        path: { type: 'string', description: 'Relative file path' },
        line_number: { type: 'integer', description: 'Line index to insert before (1-based)' },
        content: { type: 'string', description: 'Text to insert (may include newlines)' },
      },
      ['path', 'line_number', 'content'],
    ),
  },
  {
    id: 'replace_text_in_file',
    label: 'Replace in file',
    description: 'Replaces occurrences of text in a file.',
    category: 'files',
    serverRequired: true,
    definition: toolSchema(
      'replace_text_in_file',
      'Replace all occurrences of search text with replacement text in a file.',
      {
        path: { type: 'string', description: 'Relative file path' },
        search: { type: 'string', description: 'Text to find' },
        replace: { type: 'string', description: 'Replacement text' },
      },
      ['path', 'search', 'replace'],
    ),
  },
  {
    id: 'search_in_file',
    label: 'Search in file',
    description: 'Finds lines matching a pattern in a file.',
    category: 'files',
    serverRequired: true,
    definition: toolSchema(
      'search_in_file',
      'Search for lines matching a regex pattern in a file.',
      {
        path: { type: 'string', description: 'Relative file path' },
        pattern: { type: 'string', description: 'Regular expression pattern' },
      },
      ['path', 'pattern'],
    ),
  },
  {
    id: 'make_directory',
    label: 'Make directory',
    description: 'Creates a directory (and parents if needed).',
    category: 'files',
    serverRequired: true,
    definition: toolSchema(
      'make_directory',
      'Create a directory, including parent directories if needed.',
      {
        path: { type: 'string', description: 'Relative directory path' },
      },
      ['path'],
    ),
  },
  {
    id: 'move_file',
    label: 'Move / rename',
    description: 'Moves or renames a file or directory.',
    category: 'files',
    serverRequired: true,
    definition: toolSchema(
      'move_file',
      'Move or rename a file or directory.',
      {
        source: { type: 'string', description: 'Source relative path' },
        destination: { type: 'string', description: 'Destination relative path' },
      },
      ['source', 'destination'],
    ),
  },
  {
    id: 'copy_file',
    label: 'Copy file',
    description: 'Copies a file to a new path.',
    category: 'files',
    serverRequired: true,
    definition: toolSchema(
      'copy_file',
      'Copy a file to a new path.',
      {
        source: { type: 'string', description: 'Source relative path' },
        destination: { type: 'string', description: 'Destination relative path' },
      },
      ['source', 'destination'],
    ),
  },
  {
    id: 'delete_path',
    label: 'Delete path',
    description: 'Deletes a file or directory.',
    category: 'files',
    serverRequired: true,
    definition: toolSchema(
      'delete_path',
      'Delete a file or directory (recursive for directories).',
      {
        path: { type: 'string', description: 'Relative path to delete' },
      },
      ['path'],
    ),
  },
  {
    id: 'find_files',
    label: 'Find files',
    description: 'Recursively finds files matching a glob-style pattern.',
    category: 'files',
    serverRequired: true,
    definition: toolSchema(
      'find_files',
      'Find files under a directory matching a glob-style pattern.',
      {
        pattern: { type: 'string', description: 'Glob pattern, e.g. "**/*.ts"' },
        path: {
          type: 'string',
          description: 'Root directory to search (default ".")',
        },
      },
      ['pattern'],
    ),
  },
  {
    id: 'get_file_metadata',
    label: 'File metadata',
    description: 'Returns size, modification time, and type for a path.',
    category: 'files',
    serverRequired: true,
    definition: toolSchema(
      'get_file_metadata',
      'Get file or directory metadata (size, mtime, is directory).',
      {
        path: { type: 'string', description: 'Relative path' },
      },
      ['path'],
    ),
  },
  {
    id: 'git_status',
    label: 'Git status',
    description: 'Shows porcelain git status for the repository.',
    category: 'git',
    serverRequired: true,
    definition: toolSchema(
      'git_status',
      'Show git working tree status (porcelain format).',
      {},
    ),
  },
  {
    id: 'git_diff',
    label: 'Git diff',
    description: 'Shows git diff for staged or unstaged changes.',
    category: 'git',
    serverRequired: true,
    definition: toolSchema(
      'git_diff',
      'Show git diff for changes.',
      {
        path: { type: 'string', description: 'Optional file path to limit diff' },
        staged: {
          type: 'boolean',
          description: 'If true, diff staged (--cached) changes',
        },
      },
    ),
  },
  {
    id: 'git_log',
    label: 'Git log',
    description: 'Shows recent commit history on one line each.',
    category: 'git',
    serverRequired: true,
    definition: toolSchema(
      'git_log',
      'Show recent git commits (oneline).',
      {
        count: {
          type: 'integer',
          description: 'Number of commits to show (default 10)',
        },
      },
    ),
  },
  {
    id: 'git_add',
    label: 'Git add',
    description: 'Stages files for commit.',
    category: 'git',
    serverRequired: true,
    definition: toolSchema(
      'git_add',
      'Stage files for commit.',
      {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths to stage, or ["." ] for all',
        },
      },
      ['paths'],
    ),
  },
  {
    id: 'git_commit',
    label: 'Git commit',
    description: 'Creates a commit with the given message.',
    category: 'git',
    serverRequired: true,
    definition: toolSchema(
      'git_commit',
      'Create a git commit with a message.',
      {
        message: { type: 'string', description: 'Commit message' },
      },
      ['message'],
    ),
  },
  {
    id: 'git_checkout',
    label: 'Git checkout',
    description: 'Checks out a branch, optionally creating it.',
    category: 'git',
    serverRequired: true,
    definition: toolSchema(
      'git_checkout',
      'Checkout a git branch.',
      {
        branch: { type: 'string', description: 'Branch name' },
        create: {
          type: 'boolean',
          description: 'If true, create branch with -b before checkout',
        },
      },
      ['branch'],
    ),
  },
  {
    id: 'execute_command',
    label: 'Run command',
    description: 'Runs a shell command in the project directory (30s timeout).',
    category: 'code',
    serverRequired: true,
    definition: toolSchema(
      'execute_command',
      'Execute a shell command and return stdout and stderr.',
      {
        command: { type: 'string', description: 'Shell command to run' },
      },
      ['command'],
    ),
  },
  {
    id: 'run_javascript',
    label: 'Run JavaScript',
    description: 'Runs JavaScript via Node and returns output.',
    category: 'code',
    serverRequired: true,
    definition: toolSchema(
      'run_javascript',
      'Run JavaScript code with Node.js and return output.',
      {
        code: { type: 'string', description: 'JavaScript source to execute' },
      },
      ['code'],
    ),
  },
  {
    id: 'run_python',
    label: 'Run Python',
    description: 'Runs Python code and returns output.',
    category: 'code',
    serverRequired: true,
    definition: toolSchema(
      'run_python',
      'Run Python code and return output.',
      {
        code: { type: 'string', description: 'Python source to execute' },
      },
      ['code'],
    ),
  },
  // --- Sub-agents (browser orchestrator, Step 09) ---
  {
    id: 'spawn_sub_agent',
    label: 'Spawn sub-agent',
    description:
      'Starts an isolated sub-agent with its own model, tools, and context; returns a JSON summary.',
    category: 'agents',
    serverRequired: false,
    definition: toolSchema(
      'spawn_sub_agent',
      'Spawn a sub-agent of the given type to complete a task in isolation.',
      {
        type: {
          type: 'string',
          description: 'Sub-agent type id (e.g. generalPurpose, explore, shell)',
        },
        task: { type: 'string', description: 'Task description for the sub-agent' },
        wait: {
          type: 'boolean',
          description: 'If true (default), block until the sub-agent finishes',
        },
      },
      ['type', 'task'],
    ),
  },
  {
    id: 'cancel_sub_agent',
    label: 'Cancel sub-agent',
    description: 'Cancels a running or queued sub-agent by run id.',
    category: 'agents',
    serverRequired: false,
    definition: toolSchema(
      'cancel_sub_agent',
      'Cancel a sub-agent run by run_id.',
      {
        run_id: { type: 'string', description: 'Run id returned from spawn_sub_agent' },
        reason: { type: 'string', description: 'Optional cancellation reason' },
      },
      ['run_id'],
    ),
  },
];

/** Look up a catalog entry by stable tool id. */
export function getToolById(id: string): ToolDefinition | undefined {
  return BUILT_IN_TOOLS.find((tool) => tool.id === id);
}

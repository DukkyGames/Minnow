/**
 * Built-in tool catalog for LM Studio function calling.
 * Browser-native tools run in TS; server-required tools proxy to /api/tools.
 */

import {
  ASK_QUESTION_TOOL_DESCRIPTION,
  askQuestionItemSchema,
} from './ask-question-schema';

/** Tool grouping for settings UI and documentation. */
export type ToolCategory =
  | 'web'
  | 'utility'
  | 'files'
  | 'git'
  | 'code'
  | 'agents'
  | 'browser'
  | 'lsp';

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
  /** Requires Electron desktop shell with embedded preview WebContentsView. */
  previewRequired?: boolean;
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
 * All built-in tools: browser-routed handlers plus server-required tools (see `serverRequired` flags).
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
    id: 'check_reef_widget',
    label: 'Check reef widget',
    description:
      'Validate a reef-widget fence body (static lint + optional off-DOM iframe probe). Returns JSON { ok, errors, warnings }.',
    category: 'utility',
    serverRequired: false,
    definition: toolSchema(
      'check_reef_widget',
      'Validate reef-widget HTML before finishing a Reef reply. Pass the fence body (not markdown delimiters). Returns JSON with ok, errors, and warnings.',
      {
        html: {
          type: 'string',
          description: 'reef-widget fence body HTML/CSS/JS fragment',
        },
      },
      ['html'],
    ),
  },
  {
    id: 'web_search',
    label: 'Web search',
    description:
      'Search the web using the provider selected in Settings (Brave, Tavily, or DuckDuckGo).',
    category: 'web',
    serverRequired: false,
    requiresKey: false,
    definition: toolSchema(
      'web_search',
      'Search the web for up-to-date information. Provider is configured in Settings → Tools (Brave API, Tavily API, or DuckDuckGo via local server).',
      {
        query: { type: 'string', description: 'Search query' },
        api_key: {
          type: 'string',
          description: 'Optional Brave Search API key (overrides saved key when Brave is selected)',
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
    description:
      'Fetches a URL and returns stripped plain text (about 8KB max). Uses server HTTP fetch when `npm start` is running; browser path is CORS-limited.',
    category: 'web',
    serverRequired: false,
    definition: toolSchema(
      'fetch_web_content',
      'Fetch a web page URL and return its main text content (HTML stripped, length capped). Prefer npm start for reliable fetch without browser CORS limits.',
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
  {
    id: 'ask_question',
    label: 'Ask question',
    description:
      'Show one or more multiple-choice questions at the bottom of the chat and wait until the user submits answers or cancels.',
    category: 'utility',
    serverRequired: false,
    definition: toolSchema(
      'ask_question',
      ASK_QUESTION_TOOL_DESCRIPTION,
      {
        title: {
          type: 'string',
          description: 'Optional short category or context label shown above the questions.',
        },
        questions: {
          type: 'array',
          description:
            'Required. One object per card (1–10). Each object must have id, prompt, and options (not "question", "choices", or string options).',
          minItems: 1,
          maxItems: 10,
          items: askQuestionItemSchema,
        },
      },
      ['questions'],
    ),
  },
  {
    id: 'set_chat_mode',
    label: 'Set chat mode',
    description:
      'Switch the active chat operating mode (General, Build, Plan, Orchestrate, Research, Reef) after the user chooses a handoff option.',
    category: 'utility',
    serverRequired: false,
    definition: toolSchema(
      'set_chat_mode',
      'Set the active chat operating mode. Use only after the user selects a mode switch (never auto-switch without consent).',
      {
        mode_id: {
          type: 'string',
          enum: ['general', 'build', 'plan', 'orchestrate', 'research', 'reef', 'debug'],
          description: 'Target operating mode for the active chat',
        },
      },
      ['mode_id'],
    ),
  },
  {
    id: 'create_chat_with_mode',
    label: 'Create chat with mode',
    description:
      'Create a new chat with a preset operating mode, optional Orchestrate plan path, and optional seed user message.',
    category: 'utility',
    serverRequired: false,
    definition: toolSchema(
      'create_chat_with_mode',
      'Create and activate a new chat with the given mode. For Orchestrate handoff, pass plan_path and optional initial_user_message (e.g. Execute plan at documentation/plans/foo.md).',
      {
        mode_id: {
          type: 'string',
          enum: ['general', 'build', 'plan', 'orchestrate', 'research', 'reef', 'debug'],
          description: 'Operating mode for the new chat',
        },
        plan_path: {
          type: 'string',
          description:
            'Workspace-relative plan path for Orchestrate (documentation/plans/*.md)',
        },
        initial_user_message: {
          type: 'string',
          description: 'Optional first user message seeded into the new chat history',
        },
      },
      ['mode_id'],
    ),
  },
  {
    id: 'propose_mode_switch',
    label: 'Propose mode switch',
    description:
      'Show standard mode-handoff multiple-choice cards (plan complete, wrong mode, Reef widget offer).',
    category: 'utility',
    serverRequired: false,
    definition: toolSchema(
      'propose_mode_switch',
      'Ask the user a standard mode-handoff question via the ask_question UI. Situations: plan_complete, implement_in_wrong_mode, plan_in_build, reef_visualization.',
      {
        situation: {
          type: 'string',
          enum: [
            'plan_complete',
            'implement_in_wrong_mode',
            'plan_in_build',
            'reef_visualization',
          ],
          description: 'Which handoff preset to show',
        },
        plan_path: {
          type: 'string',
          description: 'Plan file path when situation is plan_complete',
        },
      },
      ['situation'],
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
    id: 'grep',
    label: 'Grep / Search workspace',
    description:
      'Search file contents under a directory (ripgrep-style). Respects .gitignore.',
    category: 'files',
    serverRequired: true,
    definition: toolSchema(
      'grep',
      'Search file contents under a workspace directory. Returns path:line:snippet lines. Respects .gitignore. Use search_in_file when you already know the file path.',
      {
        pattern: {
          type: 'string',
          description: 'Regex pattern, or literal string when literal is true',
        },
        path: {
          type: 'string',
          description: 'Directory or file to search under (default ".")',
        },
        glob: {
          type: 'string',
          description: 'Optional file glob filter, e.g. "**/*.{ts,tsx}"',
        },
        case_insensitive: {
          type: 'boolean',
          description: 'Case-insensitive search (default false)',
        },
        literal: {
          type: 'boolean',
          description: 'Treat pattern as a fixed string, not regex (default false)',
        },
        context: {
          type: 'number',
          description: 'Lines of context before/after each match (0-5, default 0)',
        },
        head_limit: {
          type: 'number',
          description: 'Max matching lines to return (default 200, max 500)',
        },
      },
      ['pattern'],
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
    id: 'start_background_command',
    label: 'Start background command',
    description:
      'Starts a long-running shell command (dev server) with no timeout; returns runId and log path.',
    category: 'code',
    serverRequired: true,
    definition: toolSchema(
      'start_background_command',
      'Start a detached background command in the workspace. Use for dev servers (npm run dev, vite, etc.).',
      {
        command: { type: 'string', description: 'Shell command to run' },
        cwd: {
          type: 'string',
          description: 'Working directory relative to workspace root (default .)',
        },
      },
      ['command'],
    ),
  },
  {
    id: 'stop_background_command',
    label: 'Stop background command',
    description: 'Stops a background command started with start_background_command.',
    category: 'code',
    serverRequired: true,
    definition: toolSchema(
      'stop_background_command',
      'Stop a background command by run_id.',
      {
        run_id: { type: 'string', description: 'runId from start_background_command' },
      },
      ['run_id'],
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
      'Starts an isolated sub-agent with its own model, tools, and context. By default returns immediately; the summary is delivered automatically when the run finishes.',
    category: 'agents',
    serverRequired: false,
    definition: toolSchema(
      'spawn_sub_agent',
      'Spawn a sub-agent of the given type to complete a task in isolation.',
      {
        type: {
          type: 'string',
          description:
            'Sub-agent type id (e.g. generalPurpose, explore, shell, reef-widget)',
        },
        task: { type: 'string', description: 'Task description for the sub-agent' },
        wait: {
          type: 'boolean',
          description:
            'If true, block until the sub-agent finishes and return the aggregate JSON in this tool result. Default false — you do not need to poll; completion is pushed as a new turn.',
        },
        category: {
          type: 'string',
          enum: ['build', 'fix', 'test', 'research'],
          description: 'Board category for Orchestrate agent grid (required in Orchestrate)',
        },
        board_task_id: {
          type: 'string',
          description: 'Linked board task id (e.g. W1-A) from board_init',
        },
      },
      ['type', 'task'],
    ),
  },
  {
    id: 'board_init',
    label: 'Board init',
    description:
      'Initialize Orchestrate Kanban board after read_file + parsing Wave Breakdown. Requires non-empty tasks and waves arrays.',
    category: 'agents',
    serverRequired: false,
    definition: toolSchema(
      'board_init',
      'Create or replace orchestrateBoard. Call only after parsing the plan: pass plan_path plus every task (tasks[].id) and wave (waves[].id). plan_path alone fails validation.',
      {
        plan_path: {
          type: 'string',
          description:
            'Workspace-relative plan path (e.g. documentation/plans/my-feature.md)',
        },
        tasks: {
          type: 'array',
          description:
            'All tasks from the plan Wave Breakdown. Each item uses id (not task_id), title, wave, category.',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Stable task id from plan headings (e.g. W1-A)',
              },
              title: { type: 'string', description: 'Short task title' },
              wave: {
                type: 'string',
                description: 'Wave id string or number; must match a waves[].id',
              },
              category: {
                type: 'string',
                enum: ['build', 'fix', 'test', 'research'],
                description: 'Sub-agent category for this task',
              },
              build: {
                type: 'string',
                description: 'Optional build spec from the plan (stored on the card)',
              },
              test: {
                type: 'string',
                description: 'Optional test spec from the plan (stored on the card)',
              },
              agent_type: {
                type: 'string',
                description: 'Optional default sub-agent type id (e.g. generalPurpose, explore)',
              },
            },
            required: ['id', 'title', 'wave', 'category'],
          },
        },
        waves: {
          type: 'array',
          description: 'Wave ids referenced by tasks[].wave',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Wave id (e.g. W1 or 1)',
              },
            },
            required: ['id'],
          },
        },
      },
      ['plan_path', 'tasks', 'waves'],
    ),
  },
  {
    id: 'board_update_task',
    label: 'Board update task',
    description: 'Update one board task status and metadata after board_init.',
    category: 'agents',
    serverRequired: false,
    definition: toolSchema(
      'board_update_task',
      'Patch one task by task_id (not id). Requires board_init first.',
      {
        task_id: {
          type: 'string',
          description:
            'Task id from board_init tasks[].id (e.g. W1-A). Do not use the field name id.',
        },
        status: {
          type: 'string',
          enum: ['planned', 'in_progress', 'testing', 'complete', 'failed', 'blocked'],
          description: 'New task status',
        },
        run_id: { type: 'string', description: 'Optional assigned sub-agent run id' },
        files_changed: { type: 'array', description: 'Paths changed on complete' },
        notes: { type: 'string' },
        error: { type: 'string' },
      },
      ['task_id', 'status'],
    ),
  },
  {
    id: 'board_get_state',
    label: 'Board get state',
    description: 'Return full Orchestrate board JSON for resume or UI.',
    category: 'agents',
    serverRequired: false,
    definition: toolSchema('board_get_state', 'Read orchestrateBoard snapshot.', {}, []),
  },
  {
    id: 'bug_add',
    label: 'Bug add',
    description: 'Add a bug card to the Reported column (All bugs screen).',
    category: 'agents',
    serverRequired: false,
    definition: toolSchema(
      'bug_add',
      'File a new bug on the bug tracker board.',
      {
        title: { type: 'string', description: 'Short bug title' },
        description: { type: 'string', description: 'Reproduction steps and context' },
        severity: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Triage severity',
        },
        bug_id: { type: 'string', description: 'Optional stable id (auto-generated if omitted)' },
      },
      ['title'],
    ),
  },
  {
    id: 'bug_update',
    label: 'Bug update',
    description: 'Update bug column, notes, or plan path (All bugs screen).',
    category: 'agents',
    serverRequired: false,
    definition: toolSchema(
      'bug_update',
      'Patch one bug card by bug_id.',
      {
        bug_id: { type: 'string', description: 'Bug card id' },
        column: {
          type: 'string',
          enum: ['reported', 'investigating', 'planned', 'fixing', 'complete'],
        },
        notes: { type: 'string' },
        plan_path: { type: 'string', description: 'Workspace-relative fix plan path' },
        investigate_run_id: { type: 'string' },
        plan_run_id: { type: 'string' },
      },
      ['bug_id'],
    ),
  },
  {
    id: 'bug_get_state',
    label: 'Bug get state',
    description: 'Return full bug board JSON (All bugs screen).',
    category: 'agents',
    serverRequired: false,
    definition: toolSchema('bug_get_state', 'Read all bugs from ~/.minnow/bugs/state.json.', {}, []),
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
  {
    id: 'list_sub_agents',
    label: 'List sub-agents',
    description:
      'Lists sub-agent runs for this chat session (queued, running, or finished), including prior parent turns.',
    category: 'agents',
    serverRequired: false,
    definition: toolSchema(
      'list_sub_agents',
      'Return run ids, types, status, and short task previews for this chat session.',
      {},
      [],
    ),
  },
  {
    id: 'get_sub_agent_status',
    label: 'Get sub-agent status',
    description:
      'Reads live status, summary (when complete), tool counts, and a short preview of the latest transcript for one run id.',
    category: 'agents',
    serverRequired: false,
    definition: toolSchema(
      'get_sub_agent_status',
      'Inspect one sub-agent run in this chat session (any parent turn).',
      {
        run_id: { type: 'string', description: 'Run id from spawn_sub_agent or list_sub_agents' },
      },
      ['run_id'],
    ),
  },
  // --- Built-in preview browser (Electron WebContentsView) ---
  {
    id: 'browser_list',
    label: 'Browser list tabs',
    description: 'Shows the active built-in preview panel URL and title.',
    category: 'browser',
    serverRequired: false,
    previewRequired: true,
    definition: toolSchema(
      'browser_list',
      'List the shared built-in preview browser (single visible panel).',
      {},
    ),
  },
  {
    id: 'browser_navigate',
    label: 'Browser navigate',
    description: 'Navigate the built-in preview panel (allowlist enforced).',
    category: 'browser',
    serverRequired: false,
    previewRequired: true,
    definition: toolSchema(
      'browser_navigate',
      'Navigate the built-in preview browser to a URL (opens the panel).',
      {
        url: { type: 'string', description: 'URL to navigate to' },
      },
      ['url'],
    ),
  },
  {
    id: 'request_browser_origin_access',
    label: 'Request browser origin access',
    description:
      'Apply browser allowlist approval after ask_question, or show ask_question if decision omitted.',
    category: 'browser',
    serverRequired: false,
    definition: toolSchema(
      'request_browser_origin_access',
      [
        'Apply browser navigation allowlist approval for browser_navigate.',
        'Preferred flow: call ask_question first (options once / persist / deny), then call this tool with decision "once" or "persist".',
        'If decision is omitted and the origin is blocked, the client shows the same ask_question cards.',
      ].join(' '),
      {
        url: { type: 'string', description: 'Full http(s) URL the agent wants to open' },
        decision: {
          type: 'string',
          enum: ['once', 'persist'],
          description:
            'User choice from ask_question (once = single navigation, persist = add origin pattern). Omit to prompt via ask_question.',
        },
      },
      ['url'],
    ),
  },
  {
    id: 'browser_snapshot',
    label: 'Browser snapshot',
    description: 'DOM snapshot with [uid] markers for click/fill.',
    category: 'browser',
    serverRequired: false,
    previewRequired: true,
    definition: toolSchema(
      'browser_snapshot',
      'Capture a DOM snapshot of the preview page (required before click/fill).',
      {},
    ),
  },
  {
    id: 'browser_click',
    label: 'Browser click',
    description: 'Click an element by snapshot uid.',
    category: 'browser',
    serverRequired: false,
    previewRequired: true,
    definition: toolSchema(
      'browser_click',
      'Click an element identified by uid from browser_snapshot.',
      {
        uid: { type: 'number', description: 'Element uid from snapshot' },
      },
      ['uid'],
    ),
  },
  {
    id: 'browser_fill',
    label: 'Browser fill',
    description: 'Fill an input by snapshot uid.',
    category: 'browser',
    serverRequired: false,
    previewRequired: true,
    definition: toolSchema(
      'browser_fill',
      'Fill an input identified by uid from browser_snapshot.',
      {
        uid: { type: 'number', description: 'Element uid from snapshot' },
        value: { type: 'string', description: 'Text to enter' },
      },
      ['uid', 'value'],
    ),
  },
  {
    id: 'browser_eval',
    label: 'Browser eval',
    description: 'Evaluate JavaScript in the page context.',
    category: 'browser',
    serverRequired: false,
    previewRequired: true,
    definition: toolSchema(
      'browser_eval',
      'Run JavaScript in the built-in preview page (full page context).',
      {
        expression: { type: 'string', description: 'JavaScript expression to evaluate' },
      },
      ['expression'],
    ),
  },
  {
    id: 'browser_screenshot',
    label: 'Browser screenshot',
    description: 'Capture a PNG screenshot of the preview panel.',
    category: 'browser',
    serverRequired: false,
    previewRequired: true,
    definition: toolSchema(
      'browser_screenshot',
      'Capture a PNG screenshot of the built-in preview browser.',
      {},
    ),
  },
  {
    id: 'load_impeccable_context',
    label: 'Load Impeccable context',
    description:
      'Load PRODUCT.md, DESIGN.md, and optional .impeccable/design.json from the workspace as JSON.',
    category: 'utility',
    serverRequired: true,
    definition: toolSchema(
      'load_impeccable_context',
      'Returns JSON with product, design, hasDesignJson, and designJson (null until sidecar exists). Use before UI edits (not a workspace-relative node path).',
      {},
      [],
    ),
  },
  {
    id: 'run_impeccable',
    label: 'Run Impeccable',
    description:
      'Run Impeccable CLI/script runner only (detect, live) — not harness commands (teach, audit, shape, …).',
    category: 'utility',
    serverRequired: true,
    definition: toolSchema(
      'run_impeccable',
      'Spawn npx impeccable <command> or the live script in the project root (60s timeout). Use /impeccable <cmd> for teach, audit, shape, craft, polish, and other harness commands.',
      {
        command: {
          type: 'string',
          description: 'CLI/script sub-command only: detect or live',
        },
        target: {
          type: 'string',
          description: 'Optional target path or URL passed to the command',
        },
      },
      ['command'],
    ),
  },
  {
    id: 'save_memory',
    label: 'Save memory',
    description:
      'Persist a note for future chats (preferences, decisions, project facts). Requires npm start.',
    category: 'utility',
    serverRequired: true,
    definition: toolSchema(
      'save_memory',
      'Save a durable memory entry under ~/.minnow/memory for retrieval in later sessions. Use when the user asks you to remember something, or when you learn a stable preference, convention, or project fact worth carrying into future chats. Do not save secrets, one-off task state, or ephemeral details.',
      {
        title: {
          type: 'string',
          description: 'Short label for the memory (e.g. "Preferred test runner")',
        },
        body: {
          type: 'string',
          description: 'Full note text to store',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for retrieval (e.g. ["testing", "preferences"])',
        },
      },
      ['title', 'body'],
    ),
  },
  {
    id: 'get_lsp_diagnostics',
    label: 'LSP diagnostics',
    description: 'Formatted language-server diagnostics for a project file.',
    category: 'lsp',
    serverRequired: true,
    definition: toolSchema(
      'get_lsp_diagnostics',
      'Returns LSP diagnostics for a relative file path (requires npm start).',
      {
        path: {
          type: 'string',
          description: 'Project-relative file path (e.g. src/main.ts)',
        },
      },
      ['path'],
    ),
  },
  {
    id: 'list_lsp_servers',
    label: 'List LSP servers',
    description: 'List configured language servers and running state.',
    category: 'lsp',
    serverRequired: true,
    definition: toolSchema(
      'list_lsp_servers',
      'JSON list of LSP server ids, labels, enabled flags, and running state.',
      {},
    ),
  },
];

/** Look up a catalog entry by stable tool id. */
export function getToolById(id: string): ToolDefinition | undefined {
  return BUILT_IN_TOOLS.find((tool) => tool.id === id);
}

'use strict';

const { hookBlock, toolInput } = require('./common');

const SELECT_DESCRIPTIONS = {
  AskUserQuestion: "AskUserQuestion -- Ask the user a question and wait for their answer.\n  question: string  -- the question to display\n  Returns: the user's text response.",
  TodoWrite: "TodoWrite -- Overwrite the entire todo list atomically.\n  todos: array of {content:string, status:'pending'|'in_progress'|'completed', activeForm:string}\n    - content: imperative form\n    - activeForm: present-continuous form -- REQUIRED\n  Always include ALL todos; partial writes delete missing entries.",
  WebFetch: 'WebFetch -- Fetch content from a URL.\n  url: string\n  prompt: string\n  Returns: extracted text content.',
  WebSearch: 'WebSearch -- Search the web.\n  query: string\n  Returns: list of results with title, url, snippet.',
  Monitor: 'Monitor -- Stream stdout lines from a background process as notifications.\n  command: string',
  CronCreate: "CronCreate -- Schedule a recurring remote agent trigger.\n  schedule: string\n  prompt: string\n  description: string",
  CronDelete: 'CronDelete -- Delete a scheduled trigger by id.\n  id: string',
  CronList: 'CronList -- List all scheduled triggers.',
  EnterPlanMode: 'EnterPlanMode -- Switch to plan-only mode. No parameters.',
  ExitPlanMode: 'ExitPlanMode -- Exit plan mode. No parameters.',
  EnterWorktree: "EnterWorktree -- Create an isolated git worktree for Agent isolation='worktree'. No parameters.",
  ExitWorktree: 'ExitWorktree -- Clean up and exit the current git worktree. No parameters.',
  TaskOutput: 'TaskOutput -- Read output from a background Agent task.\n  task_id: string',
  TaskStop: 'TaskStop -- Stop a running background Agent task.\n  task_id: string',
  PushNotification: 'PushNotification -- Send a notification to the user.\n  message: string',
  RemoteTrigger: 'RemoteTrigger -- Manually fire a scheduled trigger immediately.\n  id: string',
  NotebookEdit: "NotebookEdit -- Edit a Jupyter notebook cell.\n  notebook_path: string\n  cell_id: string\n  new_source: string\n  cell_type: 'code'|'markdown'",
  mcp__claude_ai_Google_Drive__authenticate: 'mcp__claude_ai_Google_Drive__authenticate -- Start Google Drive OAuth flow. No parameters.',
  mcp__claude_ai_Google_Drive__complete_authentication: 'mcp__claude_ai_Google_Drive__complete_authentication -- Complete Google Drive OAuth.\n  code: string',
};

const TOOL_MANIFEST = `TOOL MANIFEST -- use these directly, no ToolSearch needed.

RULES: Read/Grep/Glob ALWAYS over Bash for file reads and searches.

NATIVE:
  Read, Grep, Glob, Edit, Write, Bash, Agent, TodoWrite

HME via Bash:
  i/review, i/learn, i/trace, i/status, i/hme, i/evolve

DEFERRED:
  AskUserQuestion, WebFetch, WebSearch, Monitor, CronCreate, CronDelete,
  CronList, RemoteTrigger, EnterPlanMode, ExitPlanMode, EnterWorktree,
  ExitWorktree, TaskOutput, TaskStop, PushNotification, NotebookEdit,
  mcp__claude_ai_Google_Drive__authenticate,
  mcp__claude_ai_Google_Drive__complete_authentication

Usage: ToolSearch query="select:ToolName" to get full schema for any deferred tool.`;

async function pretoolToolSearch(stdinJson) {
  const query = toolInput(stdinJson).query || '';
  if (query.startsWith('select:')) {
    const wanted = query.slice('select:'.length);
    const key = Object.keys(SELECT_DESCRIPTIONS).find((name) => wanted.startsWith(name));
    if (key) return hookBlock(SELECT_DESCRIPTIONS[key]);
  }
  return hookBlock(TOOL_MANIFEST);
}

module.exports = { pretoolToolSearch };

/**
 * ANSI color codes for terminal output.
 */
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

/**
 * Formats a message with color.
 */
const colorize = (text: string, color: keyof typeof colors): string => {
  return `${colors[color]}${text}${colors.reset}`;
};

/**
 * Formats the user prompt.
 */
const formatUserPrompt = (): string => {
  return colorize('You: ', 'cyan');
};

/**
 * Formats the assistant name.
 */
const formatAssistantName = (name: string): string => {
  return colorize(`${name}: `, 'magenta');
};

/**
 * Formats a system message (info, warnings, etc).
 */
const formatSystem = (message: string): string => {
  return colorize(message, 'gray');
};

/**
 * Formats an error message.
 */
const formatError = (message: string): string => {
  return colorize(`Error: ${message}`, 'red');
};

/**
 * Formats a success message.
 */
const formatSuccess = (message: string): string => {
  return colorize(message, 'green');
};

/**
 * Formats a command (like /new, /quit).
 */
const formatCommand = (command: string): string => {
  return colorize(command, 'yellow');
};

/**
 * Prints a separator line.
 */
const printSeparator = (): void => {
  console.log(colorize('─'.repeat(50), 'dim'));
};

/**
 * Clears the terminal screen.
 */
const clearScreen = (): void => {
  process.stdout.write('\x1b[2J\x1b[0f');
};

/**
 * Prints the welcome banner.
 */
const printBanner = (name: string): void => {
  console.log();
  console.log(colorize(`  ╔════════════════════════════════════════╗`, 'bright'));
  console.log(colorize(`  ║`, 'bright') + colorize(`  ${name.padEnd(36)}`, 'magenta') + colorize(`║`, 'bright'));
  console.log(
    colorize(`  ║`, 'bright') + colorize(`  Your Personal AI Assistant           `, 'dim') + colorize(`║`, 'bright'),
  );
  console.log(colorize(`  ╚════════════════════════════════════════╝`, 'bright'));
  console.log();
};

/**
 * Prints the help text.
 */
const printHelp = (): void => {
  console.log();
  console.log(colorize('Commands:', 'bright'));
  console.log(`  ${formatCommand('/new')}      - Start a new conversation`);
  console.log(`  ${formatCommand('/history')}  - Show conversation history`);
  console.log(`  ${formatCommand('/clear')}    - Clear the screen`);
  console.log(`  ${formatCommand('/help')}     - Show this help`);
  console.log(`  ${formatCommand('/quit')}     - Exit the CLI`);
  console.log(`  ${formatCommand('/exit')}     - Exit the CLI`);
  console.log();
};

/**
 * Formats a warning message.
 */
const formatWarning = (message: string): string => {
  return colorize(message, 'yellow');
};

/**
 * Formats a risk level for display.
 */
const formatRiskLevel = (level: string): string => {
  switch (level) {
    case 'low':
      return colorize(level, 'green');
    case 'medium':
      return colorize(level, 'yellow');
    case 'high':
      return colorize(level, 'red');
    case 'critical':
      return `${colors.bright}${colors.red}${level}${colors.reset}`;
    default:
      return level;
  }
};

/**
 * Prints an interrupt approval prompt.
 */
const printApprovalPrompt = (
  prompt: string,
  toolCall?: { toolName: string; riskLevel: string; riskReason: string; input: unknown },
): void => {
  console.log();
  console.log(colorize('─'.repeat(50), 'yellow'));
  console.log(formatWarning('Approval Required'));
  console.log(colorize('─'.repeat(50), 'yellow'));
  console.log();
  console.log(prompt);
  console.log();

  if (toolCall) {
    console.log(colorize('Tool: ', 'dim') + toolCall.toolName);
    console.log(colorize('Risk: ', 'dim') + formatRiskLevel(toolCall.riskLevel));
    console.log(colorize('Reason: ', 'dim') + toolCall.riskReason);
    console.log(colorize('Input:', 'dim'));
    console.log(colorize(JSON.stringify(toolCall.input, null, 2), 'gray'));
  }

  console.log();
  console.log(colorize('─'.repeat(50), 'yellow'));
};

/**
 * Wraps text at a given width.
 */
const wrapText = (text: string, width = 80): string => {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= width) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines.join('\n');
};

export {
  colors,
  colorize,
  formatUserPrompt,
  formatAssistantName,
  formatSystem,
  formatError,
  formatSuccess,
  formatCommand,
  formatWarning,
  formatRiskLevel,
  printSeparator,
  clearScreen,
  printBanner,
  printHelp,
  printApprovalPrompt,
  wrapText,
};

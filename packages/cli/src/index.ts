export interface CliResult {
  command: string;
}

export const runCli = (args: string[]): CliResult => {
  const command = args[0] ?? 'help';
  return { command };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runCli(process.argv.slice(2));
  console.log(`OXE CLI placeholder. Command: ${result.command}`);
}

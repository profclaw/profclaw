import { Command } from 'commander';

const BASH_COMPLETION = `
# profClaw bash completion
_profclaw_completion() {
  local cur prev words cword
  _init_completion || return

  local commands="task ticket summary agent config cost serve tools auth setup onboard plugin chat tunnel skill memory status session doctor provider mcp browser devices daemon completion canvas webhooks channels security logs models nodes tui"

  case "$prev" in
    profclaw)
      COMPREPLY=($(compgen -W "$commands" -- "$cur"))
      return;;
    task)
      COMPREPLY=($(compgen -W "list create show update delete run" -- "$cur"))
      return;;
    session)
      COMPREPLY=($(compgen -W "list show kill clear" -- "$cur"))
      return;;
    tunnel)
      COMPREPLY=($(compgen -W "status start stop tailscale" -- "$cur"))
      return;;
    provider)
      COMPREPLY=($(compgen -W "list add remove test default models" -- "$cur"))
      return;;
    browser)
      COMPREPLY=($(compgen -W "open screenshot close pages" -- "$cur"))
      return;;
    devices)
      COMPREPLY=($(compgen -W "list pair unpair info" -- "$cur"))
      return;;
    daemon)
      COMPREPLY=($(compgen -W "install uninstall start stop status logs" -- "$cur"))
      return;;
    canvas)
      COMPREPLY=($(compgen -W "list show render clear" -- "$cur"))
      return;;
    webhooks)
      COMPREPLY=($(compgen -W "list create delete test history" -- "$cur"))
      return;;
    channels)
      COMPREPLY=($(compgen -W "list enable disable config test" -- "$cur"))
      return;;
    security)
      COMPREPLY=($(compgen -W "status set-policy audit approve deny" -- "$cur"))
      return;;
    models)
      COMPREPLY=($(compgen -W "list info set-default aliases test" -- "$cur"))
      return;;
    nodes)
      COMPREPLY=($(compgen -W "list add remove sync status" -- "$cur"))
      return;;
  esac

  COMPREPLY=($(compgen -W "$commands" -- "$cur"))
}

complete -F _profclaw_completion profclaw
`;

const ZSH_COMPLETION = `
#compdef profclaw

_profclaw() {
  local -a commands subcommands

  commands=(
    'task:Manage tasks'
    'session:Manage chat sessions'
    'tunnel:Manage tunnels'
    'provider:Manage AI providers'
    'browser:Control CDP browser'
    'devices:Manage paired devices'
    'daemon:Manage system service'
    'completion:Generate shell completions'
    'canvas:Canvas control'
    'webhooks:Manage webhooks'
    'channels:Channel configuration'
    'security:Security policy management'
    'logs:View filtered logs'
    'models:Model configuration'
    'nodes:Node operations'
    'tui:Terminal dashboard'
    'serve:Start the server'
    'status:Show system status'
    'doctor:Run diagnostics'
    'auth:Manage auth'
    'setup:Run setup wizard'
    'config:Manage configuration'
    'plugin:Manage plugins'
    'skill:Manage skills'
    'memory:Manage memory'
    'mcp:Manage MCP servers'
    'agent:Manage agents'
    'chat:Interactive chat'
  )

  _arguments \\
    '(-v --version)'{-v,--version}'[Show version]' \\
    '--json[Output as JSON]' \\
    '-q[Quiet mode]' \\
    '1:command:->cmd' \\
    '*::arg:->args'

  case $state in
    cmd)
      _describe 'commands' commands;;
    args)
      case $words[1] in
        task) subcommands=('list' 'create' 'show' 'update' 'delete' 'run'); _describe 'subcommands' subcommands;;
        session) subcommands=('list' 'show' 'kill' 'clear'); _describe 'subcommands' subcommands;;
        browser) subcommands=('open' 'screenshot' 'close' 'pages'); _describe 'subcommands' subcommands;;
        daemon) subcommands=('install' 'uninstall' 'start' 'stop' 'status' 'logs'); _describe 'subcommands' subcommands;;
        models) subcommands=('list' 'info' 'set-default' 'aliases' 'test'); _describe 'subcommands' subcommands;;
        nodes) subcommands=('list' 'add' 'remove' 'sync' 'status'); _describe 'subcommands' subcommands;;
        security) subcommands=('status' 'set-policy' 'audit' 'approve' 'deny'); _describe 'subcommands' subcommands;;
      esac;;
  esac
}

_profclaw
`;

const FISH_COMPLETION = `
# profClaw fish completion

set -l commands task ticket summary agent config cost serve tools auth setup onboard plugin chat tunnel skill memory status session doctor provider mcp browser devices daemon completion canvas webhooks channels security logs models nodes tui

complete -c profclaw -f -n '__fish_use_subcommand' -a "$commands"

complete -c profclaw -n '__fish_seen_subcommand_from task' -a 'list create show update delete run' -f
complete -c profclaw -n '__fish_seen_subcommand_from session' -a 'list show kill clear' -f
complete -c profclaw -n '__fish_seen_subcommand_from tunnel' -a 'status start stop tailscale' -f
complete -c profclaw -n '__fish_seen_subcommand_from provider' -a 'list add remove test default models' -f
complete -c profclaw -n '__fish_seen_subcommand_from browser' -a 'open screenshot close pages' -f
complete -c profclaw -n '__fish_seen_subcommand_from devices' -a 'list pair unpair info' -f
complete -c profclaw -n '__fish_seen_subcommand_from daemon' -a 'install uninstall start stop status logs' -f
complete -c profclaw -n '__fish_seen_subcommand_from canvas' -a 'list show render clear' -f
complete -c profclaw -n '__fish_seen_subcommand_from webhooks' -a 'list create delete test history' -f
complete -c profclaw -n '__fish_seen_subcommand_from channels' -a 'list enable disable config test' -f
complete -c profclaw -n '__fish_seen_subcommand_from security' -a 'status set-policy audit approve deny' -f
complete -c profclaw -n '__fish_seen_subcommand_from models' -a 'list info set-default aliases test' -f
complete -c profclaw -n '__fish_seen_subcommand_from nodes' -a 'list add remove sync status' -f

complete -c profclaw -l json -d 'Output as JSON'
complete -c profclaw -l quiet -s q -d 'Quiet mode'
complete -c profclaw -l version -s v -d 'Show version'
`;

export function completionCommands(): Command {
  const cmd = new Command('completion')
    .description('Generate shell completion scripts');

  cmd
    .command('bash')
    .description('Generate bash completion script')
    .action(() => {
      process.stdout.write(BASH_COMPLETION.trimStart());
    });

  cmd
    .command('zsh')
    .description('Generate zsh completion script')
    .action(() => {
      process.stdout.write(ZSH_COMPLETION.trimStart());
    });

  cmd
    .command('fish')
    .description('Generate fish completion script')
    .action(() => {
      process.stdout.write(FISH_COMPLETION.trimStart());
    });

  return cmd;
}

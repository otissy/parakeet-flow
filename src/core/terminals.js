'use strict';
/* What counts as a terminal. Shared by the per-app tone table (core/tone.js: terminals get the "code" profile) and by
   the "new line" key choice (typer/newline.js).
   In a classic console window the window's owner is the program running in it (cmd, powershell, node, claude ...), not
   conhost, so those program names are listed too (measured: a console window holding node.exe reports proc "node.exe"). */
const TERMINAL_PROCS = ['conhost', 'openconsole', 'windowsterminal', 'windowsterminalpreview', 'wt', 'cmd', 'powershell', 'pwsh', 'powershell_ise',
  'node', 'claude', 'python', 'pythonw', 'py', 'bash', 'sh', 'zsh', 'wsl', 'wslhost', 'ubuntu', 'debian', 'mintty', 'alacritty', 'wezterm-gui', 'wezterm', 'kitty',
  'putty', 'ghostty', 'tabby', 'hyper', 'codex', 'opencode', 'gemini'];
/** window classes that are a terminal whatever the process is called */
const TERMINAL_CLASSES = ['consolewindowclass', 'cascadia_hosting_window_class', 'mintty', 'org.wezfurlong.wezterm', 'pseudoconsolewindow'];
/** window titles that mean a console (a title like "Claude Code" is NOT listed: a browser tab can carry it) */
const TERMINAL_TITLES = ['command prompt', 'windows powershell'];

module.exports = { TERMINAL_PROCS, TERMINAL_CLASSES, TERMINAL_TITLES };

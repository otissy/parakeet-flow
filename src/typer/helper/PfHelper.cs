// pf-helper: the one native piece of parakeet-flow. Built from this file by win32-typer.js with the
// .NET Framework csc that ships with Windows (no downloaded binaries). One persistent process:
//   polls the hotkey / Esc with GetAsyncKeyState (~30 ms) and the foreground window,
//   and types with SendInput(KEYEVENTF_UNICODE) on request.
// stdin  (one command per line):
//   HOTKEY <vk>[+<vk>...]        set the hold-to-talk combo (decimal or 0xHEX); empty line disables
//   TYPE <id> <hwnd> <base64 UTF-16LE text>   (a '\n' in the text is Shift+Enter; '\r' is dropped)
//   BS   <id> <hwnd> <count>
//   FG                           report the foreground window now
//   PRESS <vk> down|up           only with --test: synthesize a physical-looking key event (used by the tests)
//   QUIT
// stdout: READY | KEY down|up | ESC | FG <hwnd> <pid> <proc> <base64 title> | OK <id> | REFUSED <id>
// TYPE/BS are refused when the foreground window is not <hwnd> at the moment of sending.
// Dictated text is never written anywhere by this process.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class PfHelper
{
    const uint INPUT_KEYBOARD = 1, KEYEVENTF_KEYUP = 2, KEYEVENTF_UNICODE = 4;
    const ushort VK_BACK = 0x08, VK_ESCAPE = 0x1B;

    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }

    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);

    static readonly object outLock = new object();
    static volatile int[] hotkey = new int[0];
    static IntPtr lastFg = IntPtr.Zero;
    static bool testMode = false;

    static void Out(string s) { lock (outLock) { Console.Out.WriteLine(s); Console.Out.Flush(); } }

    static INPUT Key(ushort vk, ushort scan, uint flags)
    {
        INPUT i = new INPUT(); i.type = INPUT_KEYBOARD;
        i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags;
        return i;
    }

    static bool IsModifier(int vk) { return vk == 0x10 || vk == 0x11 || vk == 0x12 || (vk >= 0xA0 && vk <= 0xA5) || vk == 0x5B || vk == 0x5C; }

    static List<INPUT> WithModifiersReleased(List<INPUT> body)
    {
        // a held Ctrl/Alt/Win turns Backspace into word-delete etc.: release them around the batch, then press again
        List<ushort> held = new List<ushort>();
        foreach (int vk in hotkey) if (IsModifier(vk) && (GetAsyncKeyState(vk) & 0x8000) != 0) held.Add((ushort)vk);
        if (held.Count == 0) return body;
        List<INPUT> all = new List<INPUT>();
        foreach (ushort vk in held) all.Add(Key(vk, 0, KEYEVENTF_KEYUP));
        all.AddRange(body);
        foreach (ushort vk in held) all.Add(Key(vk, 0, 0));
        return all;
    }

    static void Send(List<INPUT> list)
    {
        List<INPUT> all = WithModifiersReleased(list);
        INPUT[] arr = all.ToArray();
        SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
    }

    static string FgLine()
    {
        IntPtr h = GetForegroundWindow();
        if (h == IntPtr.Zero) return "FG 0 0 - ";
        uint pid; GetWindowThreadProcessId(h, out pid);
        string proc = "?";
        try { proc = Process.GetProcessById((int)pid).ProcessName.Replace(' ', '_'); } catch { }
        StringBuilder sb = new StringBuilder(256); GetWindowText(h, sb, 256);
        string title = Convert.ToBase64String(Encoding.UTF8.GetBytes(sb.ToString()));
        return "FG " + h.ToInt64() + " " + pid + " " + proc + " " + title;
    }

    static void Poll()
    {
        bool down = false, esc = false;
        while (true)
        {
            int[] hk = hotkey;
            bool now = hk.Length > 0;
            foreach (int vk in hk) if ((GetAsyncKeyState(vk) & 0x8000) == 0) { now = false; break; }
            if (now != down) { down = now; Out(down ? "KEY down" : "KEY up"); }
            bool e = (GetAsyncKeyState(VK_ESCAPE) & 0x8000) != 0;
            if (e && !esc) Out("ESC");
            esc = e;
            IntPtr fg = GetForegroundWindow();
            if (fg != lastFg) { lastFg = fg; Out(FgLine()); }
            Thread.Sleep(30);
        }
    }

    static void SetHotkey(string spec)
    {
        List<int> vks = new List<int>();
        foreach (string p in spec.Split(new char[] { '+' }, StringSplitOptions.RemoveEmptyEntries))
        {
            string t = p.Trim();
            try { vks.Add(t.StartsWith("0x") ? Convert.ToInt32(t.Substring(2), 16) : Convert.ToInt32(t)); } catch { }
        }
        hotkey = vks.ToArray();
    }

    static void Main(string[] args)
    {
        foreach (string x in args) if (x == "--test") testMode = true;
        Console.InputEncoding = Encoding.UTF8;
        Thread poll = new Thread(Poll); poll.IsBackground = true; poll.Start();
        Out("READY");
        string line;
        while ((line = Console.In.ReadLine()) != null)
        {
            string[] a = line.Split(' ');
            try
            {
                switch (a[0])
                {
                    case "HOTKEY": SetHotkey(a.Length > 1 ? a[1] : ""); break;
                    case "FG": Out(FgLine()); break;
                    case "QUIT": return;
                    case "PRESS":
                        if (testMode && a.Length > 2) { List<INPUT> k = new List<INPUT>(); k.Add(Key((ushort)int.Parse(a[1]), 0, a[2] == "up" ? KEYEVENTF_KEYUP : 0)); SendInput(1, k.ToArray(), Marshal.SizeOf(typeof(INPUT))); }
                        break;
                    case "TYPE":
                    case "BS":
                    {
                        string id = a[1]; long want = long.Parse(a[2]);
                        if (GetForegroundWindow().ToInt64() != want) { Out("REFUSED " + id); break; }
                        List<INPUT> l = new List<INPUT>();
                        if (a[0] == "TYPE")
                        {
                            string text = Encoding.Unicode.GetString(Convert.FromBase64String(a[3]));
                            foreach (char c in text)
                            {
                                if (c == '\r') continue;
                                // "new line" voice command: Shift+Enter, a soft break that never sends a chat message
                                if (c == '\n') { l.Add(Key(0x10, 0, 0)); l.Add(Key(0x0D, 0, 0)); l.Add(Key(0x0D, 0, KEYEVENTF_KEYUP)); l.Add(Key(0x10, 0, KEYEVENTF_KEYUP)); continue; }
                                l.Add(Key(0, c, KEYEVENTF_UNICODE));
                                l.Add(Key(0, c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
                            }
                        }
                        else
                        {
                            int n = int.Parse(a[3]);
                            for (int i = 0; i < n; i++) { l.Add(Key(VK_BACK, 0, 0)); l.Add(Key(VK_BACK, 0, KEYEVENTF_KEYUP)); }
                        }
                        if (l.Count > 0) Send(l);
                        Out("OK " + id);
                        break;
                    }
                }
            }
            catch (Exception) { if (a.Length > 1) Out("REFUSED " + a[1]); }
        }
    }
}

// pf-helper: the one native piece of parakeet-flow. Built from this file by win32-typer.js with the
// .NET Framework csc that ships with Windows (no downloaded binaries). One persistent process:
//   polls the hotkey / Esc with GetAsyncKeyState (~30 ms) and the foreground window,
//   and types with SendInput(KEYEVENTF_UNICODE) on request.
// stdin  (one command per line):
//   HOTKEY <vk>[+<vk>...]        set the hold-to-talk combo (decimal or 0xHEX); empty line disables
//   TYPE <id> <hwnd> <base64 UTF-16LE text>   (a '\n' in the text is Shift+Enter; '\r' is dropped)
//   BS   <id> <hwnd> <count>
//   FG                           report the foreground window now
//   CLAIM 0|1                    1 = swallow the hotkey's non-modifier key while its modifiers are held (Ctrl+Space);
//                                0 = never swallow anything. Lone-key hotkeys (Pause) are never swallowed.
//   TOGGLE <vk>                  the toggle key (CapsLock = 20): every fresh press prints TOGGLE. When the key is CapsLock
//                                the hook swallows it (down, auto-repeat, up) so Windows never flips the caps state or LED;
//                                any other toggle key is only reported. 0 = off: the key behaves normally again at once.
//                                The helper never sends a CapsLock key itself and never reads the caps state.
//   PRESS <vk> down|up [hwnd]    only with --test: inject a key event; with hwnd, refused unless that window is foreground
//   SIM <vk> down|up             only with --test: feed a PHYSICAL key event to the hook logic, no OS event at all
//   CAPTURE 0|1                  only with --test: Send() reports the key sequence it would send (SENT ...) instead of sending
//   SIMMID <vk>                  only with --test: the next Send() sees the physical key-up of <vk> after it decided, before it sent
//   SIMLATE <vk>                 only with --test: same, but after the list of keys to restore is fixed (exercises the final check)
//   NORELEASE 0|1                only with --test: do not release modifiers around typing (the control experiment)
//   DUMP                         only with --test: DUMP hook=<0|1> claim=<0|1> chord=<0|1> released=<n>
//   QUIT
// stdout: READY | KEY down|up | TOGGLE | ESC | FG <hwnd> <pid> <proc> <base64 title> | OK <id> | REFUSED <id> | SENT ... | SIM swallow|pass | DUMP ...
//
// Hotkey = a chord. With a non-modifier key in it (Ctrl+Space) the chord starts only when that key goes down while
// every modifier is ALREADY down (a lone Ctrl, a lone Space, or Space then Ctrl never start it). It is tracked by a
// low-level keyboard hook that ignores the events this process injects itself (tagged SELF). With CLAIM 1 the hook
// swallows the chord's key (down, auto-repeat and up) so the focused app never sees Ctrl+Space (IME toggle, VS Code
// completion); Ctrl alone and Space alone always pass. Without the hook (install failed) it polls GetAsyncKeyState.
//
// Ctrl held + Backspace = delete a word. So around every TYPE/BS the held chord modifiers get a LOGICAL key-up
// (injected, in the same SendInput call as the keystrokes) and afterwards a key-down again only if the user still
// holds them. If the user lets go mid-burst the hook swallows that physical key-up (the app already saw one), and a
// final check sends an up if a down went out after the physical release. Apps never see a stuck or unmatched modifier.
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
    const uint KEYEVENTF_EXTENDEDKEY = 1;
    static readonly IntPtr SELF = new IntPtr(0x50464C57);     // dwExtraInfo on every event this process injects
    const int WH_KEYBOARD_LL = 13, WM_KEYDOWN = 0x100, WM_KEYUP = 0x101, WM_SYSKEYDOWN = 0x104, WM_SYSKEYUP = 0x105;

    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }

    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    delegate IntPtr LowLevelProc(int code, IntPtr wParam, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)] struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public POINT pt; }
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, LowLevelProc proc, IntPtr mod, uint thread);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);

    static readonly object outLock = new object();
    static volatile int[] hotkey = new int[0];
    static IntPtr lastFg = IntPtr.Zero;
    static bool testMode = false, capture = false, noRelease = false;
    static int simMid = 0, simLate = 0;

    // ---- hotkey / hook state, all guarded by st ----
    static readonly object st = new object();
    static readonly bool[] phys = new bool[256];                   // physical key state as the hook saw it (never our own events)
    static readonly HashSet<int> swallowed = new HashSet<int>();   // chord keys whose down we swallowed: swallow repeats and the up too
    static readonly HashSet<int> released = new HashSet<int>();    // modifiers we logically released and have not restored yet
    static int trigger = 0;                                        // the one non-modifier key of the hotkey, 0 if none
    static bool claim = false, chordHeld = false, hookOk = false;
    static int toggleVk = 0, togglePending = 0;                    // toggle key (0 = off); presses not yet reported (the hook never does I/O)
    static bool toggleSw = false;                                  // a CapsLock down was swallowed: swallow its repeats and its up, even if the feature is switched off meanwhile
    static IntPtr hookHandle = IntPtr.Zero;
    static LowLevelProc hookProc;                                  // kept in a static so the GC never frees the delegate

    static void Out(string s) { lock (outLock) { Console.Out.WriteLine(s); Console.Out.Flush(); } }

    static INPUT Key(ushort vk, ushort scan, uint flags)
    {
        INPUT i = new INPUT(); i.type = INPUT_KEYBOARD;
        i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags;
        return i;
    }

    static bool IsModifier(int vk) { return vk == 0x10 || vk == 0x11 || vk == 0x12 || (vk >= 0xA0 && vk <= 0xA5) || vk == 0x5B || vk == 0x5C; }

    // the physical keys a hotkey modifier stands for (generic Ctrl = either Ctrl)
    static int[] Specific(int vk)
    {
        if (vk == 0x10) return new int[] { 0xA0, 0xA1 };
        if (vk == 0x11) return new int[] { 0xA2, 0xA3 };
        if (vk == 0x12) return new int[] { 0xA4, 0xA5 };
        return new int[] { vk };
    }
    static bool IsDownLocked(int vk) { foreach (int k in Specific(vk)) if (phys[k]) return true; return phys[vk]; }
    static bool ModsDownLocked()
    {
        foreach (int vk in hotkey) if (IsModifier(vk) && !IsDownLocked(vk)) return false;
        return true;
    }
    static bool IsChordModifierLocked(int vk)
    {
        foreach (int h in hotkey) if (IsModifier(h) && (h == vk || Array.IndexOf(Specific(h), vk) >= 0)) return true;
        return false;
    }

    // What happens to one PHYSICAL key event: true = swallow it. Must stay fast (the OS gives a hook 300 ms).
    static bool OnKey(int vk, bool down)
    {
        lock (st)
        {
            bool was = phys[vk];
            phys[vk] = down;
            bool ours = !down && released.Remove(vk);                 // a modifier whose up we already sent: swallow the real one
            if (vk == 0x14 && toggleSw) { if (!down) toggleSw = false; return true; }          // rest of a swallowed CapsLock press
            if (toggleVk != 0 && vk == toggleVk)
            {
                if (down && !was) togglePending++;
                if (vk == 0x14) { if (down) toggleSw = true; return true; }                      // CapsLock: never reaches Windows, state and LED untouched
            }
            if (trigger != 0)
            {
                if (down)
                {
                    if (swallowed.Contains(vk)) return true;           // auto-repeat of a swallowed chord key
                    if (vk == trigger && !was && !chordHeld && ModsDownLocked())
                    {
                        chordHeld = true;
                        if (claim) { swallowed.Add(vk); return true; }
                    }
                }
                else
                {
                    if (vk == trigger) chordHeld = false;
                    else if (chordHeld && IsChordModifierLocked(vk) && !ModsDownLocked()) chordHeld = false;
                    if (swallowed.Remove(vk)) return true;
                }
            }
            else if (hotkey.Length > 0)
            {
                bool all = true;
                foreach (int h in hotkey) if (!IsDownLocked(h)) { all = false; break; }
                chordHeld = all;
            }
            return ours;
        }
    }

    static IntPtr HookCb(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0 && !capture)      // capture = a simulated test: real keys on this machine are never tracked or swallowed
        {
            KBDLLHOOKSTRUCT k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            if (k.dwExtraInfo != SELF && k.vkCode < 256)
            {
                int m = wParam.ToInt32();
                bool down = m == WM_KEYDOWN || m == WM_SYSKEYDOWN;
                bool up = m == WM_KEYUP || m == WM_SYSKEYUP;
                if ((down || up) && OnKey((int)k.vkCode, down)) return new IntPtr(1);
            }
        }
        return CallNextHookEx(hookHandle, code, wParam, lParam);
    }

    static void HookThread()
    {
        hookProc = HookCb;
        hookHandle = SetWindowsHookEx(WH_KEYBOARD_LL, hookProc, GetModuleHandle(null), 0);
        hookOk = hookHandle != IntPtr.Zero;
        MSG msg;
        if (hookOk) while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
    }

    static INPUT Mod(int vk, bool up)
    {
        return Key((ushort)vk, 0, (up ? KEYEVENTF_KEYUP : 0) | ((vk == 0xA3 || vk == 0xA5 || vk == 0x5B || vk == 0x5C) ? KEYEVENTF_EXTENDEDKEY : 0));
    }

    static void Emit(List<INPUT> list)
    {
        INPUT[] arr = list.ToArray();
        for (int i = 0; i < arr.Length; i++) arr[i].u.ki.dwExtraInfo = SELF;
        if (capture)
        {
            StringBuilder sb = new StringBuilder("SENT");
            foreach (INPUT i in arr)
                sb.Append(' ').Append(i.u.ki.wVk != 0 ? i.u.ki.wVk.ToString("X2") : "c" + i.u.ki.wScan.ToString("X")).Append((i.u.ki.dwFlags & KEYEVENTF_KEYUP) != 0 ? ":U" : ":D");
            Out(sb.ToString());
            return;
        }
        SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
    }

    static void Send(List<INPUT> body)
    {
        List<int> held = new List<int>(), restore = new List<int>();
        if (!noRelease)
            lock (st)
            {
                foreach (int h in hotkey)
                {
                    if (!IsModifier(h)) continue;
                    foreach (int k in Specific(h))
                    {
                        bool down = hookOk ? phys[k] : (GetAsyncKeyState(k) & 0x8000) != 0;
                        if (down && !held.Contains(k)) { held.Add(k); released.Add(k); phys[k] = true; }
                    }
                }
            }
        if (simMid != 0) { int m = simMid; simMid = 0; OnKey(m, false); }      // test hook: the user lets go after the decision
        lock (st) { foreach (int k in held) if (phys[k]) restore.Add(k); }
        if (simLate != 0) { int m = simLate; simLate = 0; OnKey(m, false); }   // test hook: ... or after the restore list is fixed
        // ONE SendInput call, so nothing can interleave: the app sees  up, keystrokes, down  and never Ctrl+Backspace.
        // The down is only sent for keys still physically held.
        List<INPUT> all = new List<INPUT>();
        foreach (int k in held) all.Add(Mod(k, true));
        all.AddRange(body);
        foreach (int k in restore) all.Add(Mod(k, false));
        Emit(all);
        if (held.Count > 0)
            lock (st)
            {
                // released during the burst but the down already went out: send the matching up
                List<INPUT> fix = new List<INPUT>();
                foreach (int k in restore) if (!phys[k]) fix.Add(Mod(k, true));
                if (fix.Count > 0) Emit(fix);
                foreach (int k in held) released.Remove(k);
            }
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
        bool down = false, esc = false, tglPrev = false;
        while (true)
        {
            int tv = toggleVk, tp = 0;
            if (tv != 0 && !hookOk) { bool t = (GetAsyncKeyState(tv) & 0x8000) != 0; if (t && !tglPrev) lock (st) { togglePending++; } tglPrev = t; }
            lock (st) { tp = togglePending; togglePending = 0; }
            for (int i = 0; i < tp; i++) Out("TOGGLE");
            int[] hk = hotkey;
            bool now;
            if (hookOk) lock (st) { now = hk.Length > 0 && chordHeld; }
            else
            {
                now = hk.Length > 0;
                foreach (int vk in hk) if ((GetAsyncKeyState(vk) & 0x8000) == 0) { now = false; break; }
            }
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
        lock (st)
        {
            int plain = 0, which = 0;
            foreach (int v in vks) if (!IsModifier(v)) { plain++; which = v; }
            hotkey = vks.ToArray();
            // swallowing only makes sense for "modifier(s) + one key"; a lone key (Pause) or a modifiers-only combo is never swallowed
            trigger = (plain == 1 && vks.Count > 1) ? which : 0;
            chordHeld = false; swallowed.Clear();
        }
    }

    static void TestSim(int vk, bool down)
    {
        bool sw = OnKey(vk, down);
        Out("SIM " + (sw ? "swallow" : "pass"));
    }

    static void Main(string[] args)
    {
        foreach (string x in args) if (x == "--test") testMode = true;
        Console.InputEncoding = Encoding.UTF8;
        Thread hook = new Thread(HookThread); hook.IsBackground = true; hook.Start();
        for (int w = 0; w < 100 && hookHandle == IntPtr.Zero && hook.IsAlive; w++) Thread.Sleep(10);
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
                    case "TOGGLE": lock (st) { toggleVk = a.Length > 1 ? int.Parse(a[1]) : 0; if (toggleVk == 0) togglePending = 0; } break;
                    case "CLAIM": lock (st) { claim = a.Length > 1 && a[1] == "1"; if (!claim) swallowed.Clear(); } break;
                    case "CAPTURE": if (testMode) capture = a.Length > 1 && a[1] == "1"; break;
                    case "NORELEASE": if (testMode) noRelease = a.Length > 1 && a[1] == "1"; break;
                    case "SIMMID": if (testMode && a.Length > 1) simMid = int.Parse(a[1]); break;
                    case "SIMLATE": if (testMode && a.Length > 1) simLate = int.Parse(a[1]); break;
                    case "SIM": if (testMode && a.Length > 2) TestSim(int.Parse(a[1]), a[2] == "down"); break;
                    case "DUMP":
                        if (testMode) lock (st) { Out("DUMP hook=" + (hookOk ? 1 : 0) + " claim=" + (claim ? 1 : 0) + " chord=" + (chordHeld ? 1 : 0) + " released=" + released.Count + " swallowed=" + swallowed.Count + " toggle=" + toggleVk + " tsw=" + (toggleSw ? 1 : 0)); }
                        break;
                    case "QUIT": return;
                    case "PRESS":
                        if (testMode && a.Length > 2)
                        {
                            // refuse unless the named window is foreground: a test never presses keys into anything else
                            if (a.Length > 3 && GetForegroundWindow().ToInt64() != long.Parse(a[3])) { Out("REFUSED press"); break; }
                            List<INPUT> k = new List<INPUT>(); k.Add(Key((ushort)int.Parse(a[1]), 0, a[2] == "up" ? KEYEVENTF_KEYUP : 0));
                            SendInput(1, k.ToArray(), Marshal.SizeOf(typeof(INPUT)));
                        }
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

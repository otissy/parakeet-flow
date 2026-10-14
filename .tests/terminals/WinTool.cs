// WinTool: test-only helper for the terminal tests. Launches a console program in a NEW console window placed off-screen,
// finds the window by its unique title, brings it to the foreground (AttachThreadInput), and closes it again.
// It never sends a key. Usage:
//   WinTool launch <x> <y> <title> <exe> [args...]   -> OK <hwnd> <pid>
//   WinTool launchgui <x> <y> <titleSubstring> <exe> [args...]   (no new console; finds a top-level window whose title contains the text)
//   WinTool fg <hwnd>      -> OK 1|0
//   WinTool curfg          -> OK <hwnd>
//   WinTool mods           -> OK <mask of physically held modifiers>
//   WinTool rect <hwnd>    -> OK l t r b
//   WinTool move <hwnd> <x> <y> <w> <h>
//   WinTool close <hwnd>   -> WM_CLOSE
//   WinTool kill <pid>
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class WinTool
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO { public int cb; public string lpReserved, lpDesktop, lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int l, t, r, b; }
    delegate bool EnumProc(IntPtr h, IntPtr p);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h, bool alt);
    [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action, uint p1, IntPtr p2, uint flags);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);

    static IntPtr FindByTitle(string part)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, p) =>
        {
            if (!IsWindowVisible(h)) return true;
            StringBuilder sb = new StringBuilder(512); GetWindowText(h, sb, 512);
            if (sb.ToString().IndexOf(part, StringComparison.OrdinalIgnoreCase) >= 0) { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    static bool Try(IntPtr h)
    {
        IntPtr cur = GetForegroundWindow();
        uint pid; uint curT = GetWindowThreadProcessId(cur, out pid), me = GetCurrentThreadId();
        bool att = curT != 0 && curT != me && AttachThreadInput(me, curT, true);
        ShowWindow(h, 5); BringWindowToTop(h); SetForegroundWindow(h);
        if (att) AttachThreadInput(me, curT, false);
        Thread.Sleep(150);
        return GetForegroundWindow() == h;
    }

    static bool Foreground(IntPtr h)
    {
        if (GetForegroundWindow() == h) return true;
        if (Try(h)) return true;
        SwitchToThisWindow(h, true); Thread.Sleep(150);
        if (GetForegroundWindow() == h) return true;
        // the foreground lock: set its timeout to 0 for the moment of the switch, then put the old value back (not persisted)
        IntPtr buf = Marshal.AllocHGlobal(4);
        try
        {
            SystemParametersInfo(0x2000, 0, buf, 0);                // SPI_GETFOREGROUNDLOCKTIMEOUT
            int old = Marshal.ReadInt32(buf);
            SystemParametersInfo(0x2001, 0, IntPtr.Zero, 0);        // SPI_SETFOREGROUNDLOCKTIMEOUT = 0 (volatile)
            bool ok = Try(h);
            SystemParametersInfo(0x2001, 0, new IntPtr(old), 0);
            if (ok) return true;
        }
        finally { Marshal.FreeHGlobal(buf); }
        // last resort, only when the current foreground is the desktop shell (an Alt tap there does nothing)
        StringBuilder t = new StringBuilder(64); GetWindowText(GetForegroundWindow(), t, 64);
        if (t.Length == 0 || t.ToString() == "Program Manager")
        {
            keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
            return Try(h);
        }
        return false;
    }

    static int Main(string[] a)
    {
        try
        {
            switch (a[0])
            {
                case "launch":
                case "launchgui":
                {
                    bool gui = a[0] == "launchgui";
                    STARTUPINFO si = new STARTUPINFO(); si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
                    si.dwFlags = 0x4 | 0x1; si.dwX = int.Parse(a[1]); si.dwY = int.Parse(a[2]); si.wShowWindow = 4;   // USEPOSITION | USESHOWWINDOW (SW_SHOWNOACTIVATE)
                    string title = a[3];
                    if (!gui) si.lpTitle = title;
                    StringBuilder cmd = new StringBuilder();
                    for (int i = 4; i < a.Length; i++) { if (cmd.Length > 0) cmd.Append(' '); cmd.Append(a[i].IndexOf(' ') >= 0 ? "\"" + a[i] + "\"" : a[i]); }
                    PROCESS_INFORMATION pi;
                    if (!CreateProcess(null, cmd, IntPtr.Zero, IntPtr.Zero, false, gui ? 0u : 0x10u, IntPtr.Zero, null, ref si, out pi)) { Console.WriteLine("ERR createprocess " + Marshal.GetLastWin32Error()); return 1; }
                    IntPtr h = IntPtr.Zero;
                    for (int i = 0; i < 300 && h == IntPtr.Zero; i++) { h = FindByTitle(title); if (h == IntPtr.Zero) Thread.Sleep(100); }
                    if (h == IntPtr.Zero) { Console.WriteLine("ERR window not found pid=" + pi.dwProcessId); return 2; }
                    Console.WriteLine("OK " + h.ToInt64() + " " + pi.dwProcessId);
                    return 0;
                }
                case "fg": Console.WriteLine("OK " + (Foreground(new IntPtr(long.Parse(a[1]))) ? 1 : 0)); return 0;
                case "mods":   // bit mask of PHYSICALLY held modifiers right now (1 shift, 2 ctrl, 4 alt, 8 win): a test never types while the user holds one
                {
                    int m = 0;
                    if ((GetAsyncKeyState(0x10) & 0x8000) != 0) m |= 1;
                    if ((GetAsyncKeyState(0x11) & 0x8000) != 0) m |= 2;
                    if ((GetAsyncKeyState(0x12) & 0x8000) != 0) m |= 4;
                    if ((GetAsyncKeyState(0x5B) & 0x8000) != 0 || (GetAsyncKeyState(0x5C) & 0x8000) != 0) m |= 8;
                    Console.WriteLine("OK " + m); return 0;
                }
                case "curfg": Console.WriteLine("OK " + GetForegroundWindow().ToInt64()); return 0;
                case "rect": { RECT r; GetWindowRect(new IntPtr(long.Parse(a[1])), out r); Console.WriteLine("OK " + r.l + " " + r.t + " " + r.r + " " + r.b); return 0; }
                case "move": MoveWindow(new IntPtr(long.Parse(a[1])), int.Parse(a[2]), int.Parse(a[3]), int.Parse(a[4]), int.Parse(a[5]), true); Console.WriteLine("OK"); return 0;
                case "close": PostMessage(new IntPtr(long.Parse(a[1])), 0x10, IntPtr.Zero, IntPtr.Zero); Console.WriteLine("OK"); return 0;
                case "kill": try { Process.GetProcessById(int.Parse(a[1])).Kill(); } catch { } Console.WriteLine("OK"); return 0;
            }
        }
        catch (Exception e) { Console.WriteLine("ERR " + e.Message); return 3; }
        Console.WriteLine("ERR usage"); return 4;
    }
}

import sys
p = sys.argv[1] + '/src/typer/helper/PfHelper.cs'
s = open(p, encoding='utf8').read()
old = '''                        if (l.Count > 0) Send(l);
                        Out("OK " + id);'''
new = '''                        bool paced = a[0] == "TYPE" && a.Length > 5 && a[5] == "p";
                        if (paced && l.Count > 96)      // slices of ~24 characters, 8 ms apart; a slice only ends after a unicode key-up, never inside a Shift+Enter / Ctrl+J group
                        {
                            int i = 0;
                            while (i < l.Count)
                            {
                                int n = Math.Min(48, l.Count - i);
                                while (i + n < l.Count && !(l[i + n - 1].u.ki.wVk == 0 && (l[i + n - 1].u.ki.dwFlags & KEYEVENTF_KEYUP) != 0)) n++;
                                Send(l.GetRange(i, n)); i += n;
                                Thread.Sleep(8);
                            }
                        }
                        else if (l.Count > 0) Send(l);
                        Out("OK " + id);'''
assert s.count(old) == 1
open(p, 'w', encoding='utf8').write(s.replace(old, new))
print('ok')

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const supported = process.platform === 'win32';
const NOT_SUPPORTED = 'El Betatester visual por ahora solo funciona en Windows y Linux (X11).';

const SRC = `using System;
using System.Runtime.InteropServices;
using System.Text;
public class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int size);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr e);
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  static string Esc(string s) { return s.Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"").Replace("\\r", " ").Replace("\\n", " ").Replace("\\t", " "); }
  static string Info(IntPtr h, bool needTitle) {
    if (!IsWindowVisible(h) || IsIconic(h)) return null;
    StringBuilder t = new StringBuilder(512);
    GetWindowText(h, t, 512);
    string title = t.ToString();
    if (needTitle && title.Length == 0) return null;
    RECT r;
    if (DwmGetWindowAttribute(h, 9, out r, 16) != 0) GetWindowRect(h, out r);
    int w = r.R - r.L; int hh = r.B - r.T;
    if (w < 50 || hh < 50) return null;
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    return "{\\"hwnd\\":" + h.ToInt64() + ",\\"pid\\":" + pid + ",\\"x\\":" + r.L + ",\\"y\\":" + r.T + ",\\"w\\":" + w + ",\\"h\\":" + hh + ",\\"title\\":\\"" + Esc(title) + "\\"}";
  }
  public static string List() {
    StringBuilder sb = new StringBuilder("[");
    bool first = true;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      string i = Info(h, true);
      if (i != null) { if (!first) sb.Append(","); first = false; sb.Append(i); }
      return true;
    }, IntPtr.Zero);
    sb.Append("]");
    return sb.ToString();
  }
  public static long Fg() { return GetForegroundWindow().ToInt64(); }
  public static bool Focus(long hwnd) {
    IntPtr h = new IntPtr(hwnd);
    if (IsIconic(h)) ShowWindow(h, 9);
    SetForegroundWindow(h);
    System.Threading.Thread.Sleep(200);
    if (GetForegroundWindow() == h) return true;
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(h);
    System.Threading.Thread.Sleep(250);
    return GetForegroundWindow() == h;
  }
  public static string Prep(long hwnd) {
    IntPtr h = new IntPtr(hwnd);
    if (!IsWindow(h)) return "gone";
    if (!Focus(hwnd)) return "nofocus";
    string i = Info(h, false);
    return i == null ? "gone" : i;
  }
  public static void Click(int x, int y, int button, int count) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(80);
    uint down = button == 1 ? 0x0008u : 0x0002u;
    uint up = button == 1 ? 0x0010u : 0x0004u;
    for (int i = 0; i < count; i++) {
      mouse_event(down, 0, 0, 0, UIntPtr.Zero);
      mouse_event(up, 0, 0, 0, UIntPtr.Zero);
      System.Threading.Thread.Sleep(70);
    }
  }
  public static void Wheel(int x, int y, int delta) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(60);
    mouse_event(0x0800, 0, 0, unchecked((uint)delta), UIntPtr.Zero);
  }
  public static void TypeText(string s) {
    foreach (char c in s) {
      if (c == '\\r') continue;
      INPUT[] a = new INPUT[2];
      a[0].type = 1; a[1].type = 1;
      if (c == '\\n') { a[0].u.ki.wVk = 0x0D; a[1].u.ki.wVk = 0x0D; a[1].u.ki.dwFlags = 2; }
      else { a[0].u.ki.wScan = c; a[0].u.ki.dwFlags = 4; a[1].u.ki.wScan = c; a[1].u.ki.dwFlags = 6; }
      SendInput(2, a, Marshal.SizeOf(typeof(INPUT)));
      System.Threading.Thread.Sleep(10);
    }
  }
  public static void Keys(int[] vks) {
    for (int i = 0; i < vks.Length; i++) keybd_event((byte)vks[i], 0, 0, UIntPtr.Zero);
    for (int i = vks.Length - 1; i >= 0; i--) keybd_event((byte)vks[i], 0, 2, UIntPtr.Zero);
  }
  public static void Close(long hwnd) { PostMessage(new IntPtr(hwnd), 0x10, IntPtr.Zero, IntPtr.Zero); }
}`;

const HASH = crypto.createHash('sha1').update(SRC).digest('hex').slice(0, 10);

const HEADER = `$ErrorActionPreference = 'Stop'
$src = @'
${SRC}
'@
$dll = Join-Path $env:TEMP 'rsagent-w-${HASH}.dll'
try {
  if (!(Test-Path $dll)) { Add-Type -TypeDefinition $src -OutputAssembly $dll }
  if (-not ('W' -as [type])) { Add-Type -Path $dll }
} catch {
  if (-not ('W' -as [type])) { Add-Type -TypeDefinition $src }
}
[W]::SetProcessDPIAware() | Out-Null
function Prep($h) {
  $r = [W]::Prep([long]$h)
  if ($r -eq 'gone' -or $r -eq 'nofocus') { throw $r }
  return ($r | ConvertFrom-Json)
}
`;

const cleanErr = s => String(s).split('\n').map(l => l.trim()).filter(l => l && !/^(At |\+|CategoryInfo|FullyQualifiedErrorId|\s*~)/.test(l)).join(' ').slice(0, 300);

let seq = 0;
async function ps(body, params = {}, signal, timeout = 45000) {
  if (!supported) throw new Error(NOT_SUPPORTED);
  const file = path.join(os.tmpdir(), `rsagent-${process.pid}-${++seq}.ps1`);
  fs.writeFileSync(file, '\ufeff' + HEADER + `$p = ConvertFrom-Json @'\n${JSON.stringify(params)}\n'@\n` + body);
  try {
    return await new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, signal }, (err, out, errout) => {
        if (err) return reject(err.name === 'AbortError' ? err : new Error(cleanErr(errout || err.message)));
        resolve(String(out).trim());
      });
    });
  } finally { fs.rm(file, { force: true }, () => {}); }
}

const arr = x => (Array.isArray(x) ? x : x ? [x] : []);

async function list(signal) {
  const out = await ps('[W]::List()', {}, signal);
  return JSON.parse(out || '[]');
}

async function foreground(signal) {
  return Number(await ps('[W]::Fg()', {}, signal));
}

const OCR = `Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $m = $asTask.MakeGenericMethod($type); $t = $m.Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($p.file)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$sbmp = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$eng = $null
if ($p.lang) { $lg = New-Object Windows.Globalization.Language($p.lang); if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($lg)) { $eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lg) } }
if (-not $eng) { $eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if (-not $eng) { throw 'OCR no disponible: instala un idioma de Windows con reconocimiento de texto.' }
$res = Await ($eng.RecognizeAsync($sbmp)) ([Windows.Media.Ocr.OcrResult])
$out = @()
$li = 0
foreach ($ln in $res.Lines) { foreach ($w in $ln.Words) { $b = $w.BoundingRect; $out += [pscustomobject]@{ t = $w.Text; x = [int]$b.X; y = [int]$b.Y; w = [int]$b.Width; h = [int]$b.Height; l = $li } }; $li++ }
`;

const SNAP = `$o = Prep $p.hwnd
Add-Type -AssemblyName System.Drawing
$sc = [double]$p.scale
$x = [int]($o.x + $p.rx); $y = [int]($o.y + $p.ry); $w = [int]$p.rw; $h = [int]$p.rh
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x, $y, 0, 0, $bmp.Size)
$g.Dispose()
if ($sc -ne 1) {
  $n = New-Object System.Drawing.Bitmap([int]($w * $sc), [int]($h * $sc))
  $g2 = [System.Drawing.Graphics]::FromImage($n)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.DrawImage($bmp, 0, 0, $n.Width, $n.Height)
  $g2.Dispose(); $bmp.Dispose(); $bmp = $n
}
New-Item -ItemType Directory -Force -Path (Split-Path $p.file) | Out-Null
$bmp.Save($p.file, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
${OCR}
@{ win = $o; words = @($out) } | ConvertTo-Json -Depth 5 -Compress
`;

async function snap({ hwnd, region, scale = 1, file, lang }, signal) {
  const out = await ps(SNAP, { hwnd, rx: region.x, ry: region.y, rw: region.w, rh: region.h, scale, file, lang: lang || null }, signal, 60000);
  const j = JSON.parse(out);
  return { win: j.win, words: arr(j.words) };
}

const ACT = (cmd) => `$o = Prep $p.hwnd\n${cmd}\n`;

const click = (hwnd, x, y, { button = 0, count = 1 } = {}, signal) => ps(ACT(`if ($p.x -lt 0 -or $p.y -lt 0 -or $p.x -gt $o.w -or $p.y -gt $o.h) { throw 'outside' }
[W]::Click([int]($o.x + $p.x), [int]($o.y + $p.y), [int]$p.button, [int]$p.count)`), { hwnd, x, y, button, count }, signal);

const type = (hwnd, text, signal) => ps(ACT('[W]::TypeText([string]$p.text)'), { hwnd, text }, signal);

const wheel = (hwnd, x, y, delta, signal) => ps(ACT('[W]::Wheel([int]($o.x + $p.x), [int]($o.y + $p.y), [int]$p.delta)'), { hwnd, x, y, delta }, signal);

const NAMED = { enter: 0x0D, return: 0x0D, tab: 0x09, esc: 0x1B, escape: 0x1B, space: 0x20, backspace: 0x08, delete: 0x2E, del: 0x2E, insert: 0x2D, up: 0x26, down: 0x28, left: 0x25, right: 0x27, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22, ctrl: 0x11, control: 0x11, alt: 0x12, shift: 0x10, win: 0x5B };

function vkOf(k) {
  k = k.trim().toLowerCase();
  if (NAMED[k] != null) return NAMED[k];
  if (/^f([1-9]|1[0-2])$/.test(k)) return 0x6F + Number(k.slice(1));
  if (/^[a-z]$/.test(k)) return k.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(k)) return k.charCodeAt(0);
  throw new Error('Tecla desconocida: ' + k);
}

const parseKeys = combo => String(combo).split('+').map(vkOf);

const keys = (hwnd, combo, signal) => ps(ACT('[W]::Keys([int[]]$p.vks)'), { hwnd, vks: parseKeys(combo) }, signal);

const closeWindow = (hwnd, signal) => ps('[W]::Close([long]$p.hwnd)', { hwnd }, signal);

function killTree(pid) {
  return new Promise(res => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => res()));
}

module.exports = process.platform === 'linux' ? require('./linux') : { supported, NOT_SUPPORTED, SRC, HEADER, list, foreground, snap, click, type, wheel, keys, parseKeys, closeWindow, killTree };

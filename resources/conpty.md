# Bundled ConPTY runtime

`conpty.lock.json` pins `Microsoft.Windows.Console.ConPTY` 1.25.260930003 from Microsoft's NuGet package. It records the archive size and SHA-256, plus the exact archive member, size, and SHA-256 for each native file.

`scripts/prepare-conpty.mjs` prepares `conpty.dll` and `OpenConsole.exe` for x64, x86, and arm64 under `resources/conpty/`. The script verifies the package before extraction and each file before installation. Generated binaries are excluded from Git.

On Windows, `npm ci` prepares the runtime through `postinstall`. Tauri's development and build hooks run the same preparation before Vite. `prepare:conpty` prepares missing or modified files; `check:conpty` verifies existing files without downloading. Valid files are not rewritten.

The script accepts `--archive` for an existing NuGet package, `--cache` for a package cache directory, and `--output` for a different generated-resource directory. Downloads use HTTPS, a 60-second deadline, at most five redirects, and the locked package size limit.

The installer maps these generated files to `conpty/` and includes `licenses/conpty-LICENSE.txt` as `conpty/LICENSE.txt`. The license is Microsoft's MIT notice, with its source URL and SHA-256 recorded in the lock.

The frontend `windowsPty.buildNumber` value `21376` identifies the bundled host's xterm reflow compatibility level. It does not report the Windows version installed on the user's machine. The bundled host supplies modern wrapping behavior even when the operating system is older.

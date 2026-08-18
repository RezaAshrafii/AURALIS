Option Explicit
Dim shell, fso, basePath, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
basePath = fso.GetParentFolderName(WScript.ScriptFullName)
command = Chr(34) & basePath & "\runtime\bun.exe" & Chr(34) & " " & Chr(34) & basePath & "\server.mjs" & Chr(34)
shell.Run command, 0, False

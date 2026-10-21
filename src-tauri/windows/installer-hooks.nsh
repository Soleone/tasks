; Uninstalling keeps Tasks' own app data whatever the confirm page's "Delete the application data"
; box says. It holds the pointer to the Tasks home, the window's size and position and, until the
; owner removes it, the data from before Tasks homes. The bundler has no setting to drop the box, and replacing its whole template
; costs more upkeep than this hook. The Tasks home is a folder the owner chose; nothing here touches it.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
    StrCpy $DeleteAppDataCheckboxState 0
    MessageBox MB_OK|MB_ICONINFORMATION "Tasks keeps its app data in $APPDATA\${BUNDLEID}: it remembers where your Tasks home is. Your tasks are in the Tasks home, which uninstalling never touches. Delete that folder yourself if you won't reinstall." /SD IDOK
  ${EndIf}
!macroend

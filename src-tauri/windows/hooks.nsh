; BooruRamen NSIS installer hooks (bundle.windows.nsis.installerHooks).
;
; The AI tagger model (~470 MB) is downloaded into the WebView's Cache
; Storage, which lives in the app's local data folder rather than the install
; folder. Tauri's uninstaller only removes that folder when "Delete the
; application data" is ticked, so a plain uninstall left the model behind and
; a reinstall found it already downloaded (issue #218).
;
; On a real uninstall (not the silent uninstall an update runs) always remove
; the downloaded model and the booru media cache. Profiles, likes and settings
; are left alone unless the user ticks the checkbox.

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    SetShellVarContext current
    RmDir /r "$LOCALAPPDATA\${BUNDLEID}\EBWebView\Default\Service Worker\CacheStorage"
    RmDir /r "$LOCALAPPDATA\${BUNDLEID}\booru-media"
  ${EndIf}
!macroend

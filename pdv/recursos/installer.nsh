; Chamado pelo desinstalador do NSIS (electron-builder).
; O app se registra em HKCU\...\Run com o nome fixo "CabanaBoemiaPDV"
; (app.setLoginItemSettings em src/main/index.js); sem isto, o Windows
; tentaria abrir o PDV desinstalado a cada login.
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "CabanaBoemiaPDV"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "CabanaBoemiaPDV"
!macroend

; Incluído pelo instalador NSIS (electron-builder).
; O app se registra em HKCU\...\Run com o nome fixo "PDVdoAbatia"
; (app.setLoginItemSettings em src/main/index.js).

; Instalar: o programa antigo ("Cabana Boemia PDV", entrada "CabanaBoemiaPDV")
; deixa de abrir com o Windows, para não abrirem os dois PDVs juntos. O app
; novo também apaga essa entrada ao abrir (caso o antigo a recrie).
!macro customInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "CabanaBoemiaPDV"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "CabanaBoemiaPDV"
!macroend

; Desinstalar: sem isto o Windows tentaria abrir o PDV desinstalado a cada login.
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "PDVdoAbatia"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "PDVdoAbatia"
!macroend

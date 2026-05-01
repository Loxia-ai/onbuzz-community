; Loxia Autopilot One - Windows Installer
; Built with NSIS (Nullsoft Scriptable Install System)

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "WinMessages.nsh"

; =====================
; Installer Attributes
; =====================
Name "Loxia Autopilot One"
OutFile "..\..\dist\LoxiaSetup-${VERSION}.exe"
InstallDir "$PROGRAMFILES\Loxia"
InstallDirRegKey HKLM "Software\Loxia\AutopilotOne" "InstallDir"
RequestExecutionLevel admin

; =====================
; Version Info
; =====================
VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName" "Loxia Autopilot One"
VIAddVersionKey "CompanyName" "Loxia AI"
VIAddVersionKey "LegalCopyright" "Copyright (c) Loxia AI"
VIAddVersionKey "FileDescription" "Loxia Autopilot One Installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

; =====================
; UI Configuration
; =====================
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Welcome to Loxia Autopilot One Setup"
!define MUI_WELCOMEPAGE_TEXT "This wizard will guide you through the installation of Loxia Autopilot One.$\r$\n$\r$\nLoxia is an autonomous AI agent system for software development.$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\loxia.exe"
!define MUI_FINISHPAGE_RUN_PARAMETERS "web"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Loxia Web UI"

; =====================
; Pages
; =====================
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; =====================
; Installation Section
; =====================
Section "Install"
  SetOutPath $INSTDIR

  ; Copy main executable
  File "..\..\dist\loxia.exe"

  ; Store installation folder
  WriteRegStr HKLM "Software\Loxia\AutopilotOne" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\Loxia\AutopilotOne" "Version" "${VERSION}"

  ; Add to system PATH (using registry directly - no plugin needed)
  ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
  StrCpy $0 "$0;$INSTDIR"
  WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$0"
  ; Broadcast environment change
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000

  ; Create Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\Loxia Autopilot"

  ; Main shortcuts with different commands
  CreateShortcut "$SMPROGRAMS\Loxia Autopilot\Loxia Web.lnk" \
    "$INSTDIR\loxia.exe" "web" \
    "$INSTDIR\loxia.exe" 0 SW_SHOWNORMAL \
    "" "Start Loxia Web UI"

  CreateShortcut "$SMPROGRAMS\Loxia Autopilot\Loxia Terminal.lnk" \
    "$INSTDIR\loxia.exe" "terminal" \
    "$INSTDIR\loxia.exe" 0 SW_SHOWNORMAL \
    "" "Start Loxia Terminal UI"

  CreateShortcut "$SMPROGRAMS\Loxia Autopilot\Loxia Serve.lnk" \
    "$INSTDIR\loxia.exe" "serve" \
    "$INSTDIR\loxia.exe" 0 SW_SHOWNORMAL \
    "" "Start Loxia Server (headless)"

  CreateShortcut "$SMPROGRAMS\Loxia Autopilot\Uninstall Loxia.lnk" \
    "$INSTDIR\uninstall.exe" "" \
    "$INSTDIR\uninstall.exe" 0

  ; Create Desktop shortcut (optional - for Web UI)
  CreateShortcut "$DESKTOP\Loxia Autopilot.lnk" \
    "$INSTDIR\loxia.exe" "web" \
    "$INSTDIR\loxia.exe" 0 SW_SHOWNORMAL \
    "" "Start Loxia Autopilot"

  ; Write uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Add to Add/Remove Programs
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\LoxiaAutopilotOne" \
    "DisplayName" "Loxia Autopilot One"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\LoxiaAutopilotOne" \
    "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\LoxiaAutopilotOne" \
    "QuietUninstallString" "$\"$INSTDIR\uninstall.exe$\" /S"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\LoxiaAutopilotOne" \
    "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\LoxiaAutopilotOne" \
    "DisplayIcon" "$INSTDIR\loxia.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\LoxiaAutopilotOne" \
    "Publisher" "Loxia AI"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\LoxiaAutopilotOne" \
    "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\LoxiaAutopilotOne" \
    "URLInfoAbout" "https://loxia.ai"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\LoxiaAutopilotOne" \
    "URLUpdateInfo" "https://github.com/loxia-labs/loxia-autopilot-one/releases"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\LoxiaAutopilotOne" \
    "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\LoxiaAutopilotOne" \
    "NoRepair" 1

  ; Get installed size
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\LoxiaAutopilotOne" \
    "EstimatedSize" "$0"
SectionEnd

; =====================
; Uninstallation Section
; =====================
Section "Uninstall"
  ; Remove files
  Delete "$INSTDIR\loxia.exe"
  Delete "$INSTDIR\uninstall.exe"

  ; Remove installation directory (if empty)
  RMDir "$INSTDIR"

  ; Note: PATH cleanup would require parsing - leaving it for manual cleanup
  ; or next install will just add again

  ; Remove Start Menu shortcuts
  Delete "$SMPROGRAMS\Loxia Autopilot\Loxia Web.lnk"
  Delete "$SMPROGRAMS\Loxia Autopilot\Loxia Terminal.lnk"
  Delete "$SMPROGRAMS\Loxia Autopilot\Loxia Serve.lnk"
  Delete "$SMPROGRAMS\Loxia Autopilot\Uninstall Loxia.lnk"
  RMDir "$SMPROGRAMS\Loxia Autopilot"

  ; Remove Desktop shortcut
  Delete "$DESKTOP\Loxia Autopilot.lnk"

  ; Remove registry entries
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\LoxiaAutopilotOne"
  DeleteRegKey HKLM "Software\Loxia\AutopilotOne"
  DeleteRegKey /ifempty HKLM "Software\Loxia"
SectionEnd

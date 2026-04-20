; resources/installer.nsh
; Aangepast NSIS-script voor TenderTracker installer
; Voegt welkomsttekst, copyright en branding toe aan de Windows-installer.

!macro customHeader
  !system "echo '' > /dev/null"
!macroend

!macro customInit
  ; Toon aangepaste welkomsttekst in de installer
!macroend

!macro customInstall
  ; Schrijf copyright-informatie naar de installatiemap
  FileOpen $0 "$INSTDIR\COPYRIGHT.txt" w
  FileWrite $0 "TenderTracker$\r$\n"
  FileWrite $0 "Copyright (c) 2026 Questric. Alle rechten voorbehouden.$\r$\n"
  FileWrite $0 "$\r$\n"
  FileWrite $0 "Ontwikkeld door Questric voor Van de Kreeke Groep.$\r$\n"
  FileWrite $0 "www.questric.eu$\r$\n"
  FileWrite $0 "$\r$\n"
  FileWrite $0 "DISCLAIMER: De uitkomsten van TenderTracker zijn uitsluitend bedoeld als hulpmiddel.$\r$\n"
  FileWrite $0 "Questric wijst elke aansprakelijkheid af voor onjuiste AI-uitkomsten of$\r$\n"
  FileWrite $0 "beslissingen genomen op basis van de door de applicatie verstrekte informatie.$\r$\n"
  FileClose $0
!macroend

!macro customUnInstall
  Delete "$INSTDIR\COPYRIGHT.txt"
!macroend

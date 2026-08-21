; ADSecurity.iss — Inno Setup script for Identity Sphere (Wisbility)
; Compile on a Windows build agent after prepare-payload.ps1 and runtime binary drops.

#define MyAppName "Identity Sphere"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Wisbility"
#define MyAppExeName "Launch-ADSecurity.ps1"
#define MyAppURL "https://wisibility.ai"

[Setup]
AppId={{A7C3E9F1-2B4D-4E6A-9C8F-1D2E3F4A5B6C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\ADSecurity
DefaultGroupName=Identity Sphere
DisableProgramGroupPage=yes
LicenseFile=
OutputDir=output
OutputBaseFilename=ADSecuritySetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#MyAppName}
CloseApplications=force
SetupLogging=yes
; Configure is invoked from [Code] so we can fail closed and pass -SetupFile
DisableFinishedPage=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"; Flags: checkedonce

[Files]
; Application payload (immutable)
Source: "payload\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "payload\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "plugins\*"; DestDir: "{app}\plugins"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "updater\*"; DestDir: "{app}\updater"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "templates\ADSecurity.API.xml"; DestDir: "{app}\runtime\winsw"; Flags: ignoreversion
Source: "templates\ADSecurity.Mongo.xml"; DestDir: "{app}\runtime\winsw"; Flags: ignoreversion
Source: "templates\mongod.cfg"; DestDir: "{app}\runtime\mongodb"; Flags: ignoreversion
Source: "scripts\*.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion

[Icons]
Name: "{group}\Identity Sphere"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\Launch-ADSecurity.ps1"""; WorkingDir: "{app}"
Name: "{group}\License"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\Launch-ADSecurity.ps1"""; WorkingDir: "{app}"
Name: "{group}\Logs"; Filename: "explorer.exe"; Parameters: """{commonappdata}\ADSecurity\logs"""
Name: "{group}\Repair Installation"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\Repair-ADSecurity.ps1"""; WorkingDir: "{app}"
Name: "{commondesktop}\Identity Sphere"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\Launch-ADSecurity.ps1"""; WorkingDir: "{app}"; Tasks: desktopicon

[Registry]
Root: HKLM; Subkey: "Software\Wisbility\ADSecurity"; ValueType: string; ValueName: "InstallRoot"; ValueData: "{app}"; Flags: uninsdeletekey
Root: HKLM; Subkey: "Software\Wisbility\ADSecurity"; ValueType: string; ValueName: "DataRoot"; ValueData: "{commonappdata}\ADSecurity"
Root: HKLM; Subkey: "Software\Wisbility\ADSecurity"; ValueType: string; ValueName: "ProductVersion"; ValueData: "{#MyAppVersion}"

; Configure runs from CurStepChanged(ssPostInstall) — not [Run] — for SetupFile + fail-closed.

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\Stop-ADSecurityServices.ps1"" -InstallRoot ""{app}"""; RunOnceId: "StopServices"; Flags: runhidden waituntilterminated

[Code]
var
  KeepData: Boolean;
  IsUpgradeMode: Boolean;
  AdminPage: TWizardPage;
  AdminNameEdit: TNewEdit;
  AdminEmailEdit: TNewEdit;
  AdminPhoneEdit: TNewEdit;
  AdminPassEdit: TPasswordEdit;
  AdminPassConfirmEdit: TPasswordEdit;
  LicensePage: TWizardPage;
  LicensePathEdit: TNewEdit;
  LicenseBrowseBtn: TNewButton;
  LicenseInfoMemo: TNewMemo;
  SummaryPage: TWizardPage;
  SummaryMemo: TNewMemo;
  LicenseCustomer: String;
  LicenseEdition: String;
  LicenseExpiry: String;
  LicenseUsers: String;
  ProgressPage: TOutputProgressWizardPage;
  ConfigureFailed: Boolean;
  ConfigureErrorMsg: String;

function JsonEscape(const S: String): String;
var
  I: Integer;
  C: Char;
  OutS: String;
begin
  OutS := '';
  for I := 1 to Length(S) do
  begin
    C := S[I];
    if C = '\' then OutS := OutS + '\\'
    else if C = '"' then OutS := OutS + '\"'
    else if C = #8 then OutS := OutS + '\b'
    else if C = #9 then OutS := OutS + '\t'
    else if C = #10 then OutS := OutS + '\n'
    else if C = #13 then OutS := OutS + '\r'
    else OutS := OutS + C;
  end;
  Result := OutS;
end;

function IsValidEmail(const Email: String): Boolean;
var
  AtPos, DotPos: Integer;
begin
  AtPos := Pos('@', Email);
  DotPos := 0;
  if AtPos > 1 then
    DotPos := Pos('.', Copy(Email, AtPos + 1, Length(Email)));
  Result := (AtPos > 1) and (DotPos > 1) and (Length(Email) < 254);
end;

function PasswordMeetsPolicy(const P: String): Boolean;
var
  I: Integer;
  HasUpper, HasLower, HasDigit, HasSpecial: Boolean;
  C: Char;
begin
  Result := False;
  if Length(P) < 8 then Exit;
  HasUpper := False;
  HasLower := False;
  HasDigit := False;
  HasSpecial := False;
  for I := 1 to Length(P) do
  begin
    C := P[I];
    if (C >= 'A') and (C <= 'Z') then HasUpper := True
    else if (C >= 'a') and (C <= 'z') then HasLower := True
    else if (C >= '0') and (C <= '9') then HasDigit := True
    else HasSpecial := True;
  end;
  Result := HasUpper and HasLower and HasDigit and HasSpecial;
end;

function RegKeyExistsHKLM(const Subkey: String): Boolean;
begin
  Result := RegKeyExists(HKLM, Subkey);
end;

function DetectUpgradeMode(): Boolean;
begin
  Result := RegKeyExistsHKLM('Software\Wisbility\ADSecurity');
end;

procedure LicenseBrowseClick(Sender: TObject);
var
  FileName: String;
  ResultCode: Integer;
  PreviewPath: String;
  Lines: TArrayOfString;
  I: Integer;
  Line: String;
begin
  FileName := LicensePathEdit.Text;
  if GetOpenFileName('Select ADSecurity License', FileName,
     ExpandConstant('{userdocs}'), 'ADSecurity License (*.lic.json)|*.lic.json', 'lic.json') then
  begin
    LicensePathEdit.Text := FileName;
    LicenseCustomer := '';
    LicenseEdition := '';
    LicenseExpiry := '';
    LicenseUsers := '';
    PreviewPath := ExpandConstant('{tmp}\license-preview.txt');
    DeleteFile(PreviewPath);
    { Structural preview only — no cryptographic validation in the installer }
    Exec('powershell.exe',
      '-NoProfile -ExecutionPolicy Bypass -Command "' +
      '$ErrorActionPreference=''Stop''; ' +
      '$raw=Get-Content -LiteralPath ''' + FileName + ''' -Raw; ' +
      '$p=$raw | ConvertFrom-Json; ' +
      '$c=$null; ' +
      'if($p.payload){ ' +
      '$b=$p.payload.Replace(''-'',''+'').Replace(''_'',''/''); ' +
      'while($b.Length % 4){$b+=''=''}; ' +
      '$c=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)) | ConvertFrom-Json ' +
      '} elseif($p.claims){$c=$p.claims} else {$c=$p}; ' +
      '$cust=''''; if($c.customer){ if($c.customer.name){$cust=[string]$c.customer.name} elseif($c.customer -is [string]){$cust=[string]$c.customer} }; ' +
      'if(-not $cust){$cust=[string]$c.customerName}; ' +
      '$ed=[string]$c.edition; if(-not $ed){$ed=[string]$c.productEdition}; ' +
      '$ex=[string]$c.expiresAt; if(-not $ex){$ex=[string]$c.expiry}; ' +
      '$us=''''; if($c.maxUsers){$us=[string]$c.maxUsers} elseif($c.seats){$us=[string]$c.seats}; ' +
      '@(\"Customer=$cust\",\"Edition=$ed\",\"Expiry=$ex\",\"Users=$us\") | Set-Content -LiteralPath ''' + PreviewPath + ''' -Encoding ASCII"',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

    LicenseInfoMemo.Lines.Clear;
    if (ResultCode = 0) and LoadStringsFromFile(PreviewPath, Lines) then
    begin
      for I := 0 to GetArrayLength(Lines) - 1 do
      begin
        Line := Lines[I];
        if Pos('Customer=', Line) = 1 then LicenseCustomer := Copy(Line, 10, Length(Line));
        if Pos('Edition=', Line) = 1 then LicenseEdition := Copy(Line, 9, Length(Line));
        if Pos('Expiry=', Line) = 1 then LicenseExpiry := Copy(Line, 8, Length(Line));
        if Pos('Users=', Line) = 1 then LicenseUsers := Copy(Line, 7, Length(Line));
      end;
      LicenseInfoMemo.Lines.Add('File: ' + ExtractFileName(FileName));
      LicenseInfoMemo.Lines.Add('Customer: ' + LicenseCustomer);
      LicenseInfoMemo.Lines.Add('Edition: ' + LicenseEdition);
      LicenseInfoMemo.Lines.Add('Expiry: ' + LicenseExpiry);
      LicenseInfoMemo.Lines.Add('Users: ' + LicenseUsers);
      LicenseInfoMemo.Lines.Add('');
      LicenseInfoMemo.Lines.Add('Validation: Pending backend verification');
    end
    else
    begin
      LicenseInfoMemo.Lines.Add('Could not parse license JSON structurally.');
      LicenseInfoMemo.Lines.Add('Select a valid *.lic.json file.');
    end;
  end;
end;

procedure UpdateSummaryMemo;
var
  Shortcut: String;
begin
  if WizardIsTaskSelected('desktopicon') then Shortcut := 'Yes' else Shortcut := 'No';
  SummaryMemo.Lines.Clear;
  SummaryMemo.Lines.Add('ADSecurity Installation Summary');
  SummaryMemo.Lines.Add('');
  SummaryMemo.Lines.Add('Install Folder');
  SummaryMemo.Lines.Add('  ' + WizardDirValue);
  SummaryMemo.Lines.Add('');
  SummaryMemo.Lines.Add('Administrator');
  SummaryMemo.Lines.Add('  ' + Trim(AdminNameEdit.Text));
  SummaryMemo.Lines.Add('  ' + Trim(AdminEmailEdit.Text));
  SummaryMemo.Lines.Add('');
  SummaryMemo.Lines.Add('License');
  SummaryMemo.Lines.Add('  ' + LicenseEdition);
  SummaryMemo.Lines.Add('Customer');
  SummaryMemo.Lines.Add('  ' + LicenseCustomer);
  SummaryMemo.Lines.Add('Expiry');
  SummaryMemo.Lines.Add('  ' + LicenseExpiry);
  SummaryMemo.Lines.Add('');
  SummaryMemo.Lines.Add('Desktop Shortcut');
  SummaryMemo.Lines.Add('  ' + Shortcut);
  SummaryMemo.Lines.Add('');
  SummaryMemo.Lines.Add('Click Install to begin.');
end;

procedure InitializeWizard;
var
  CurTop: Integer;
begin
  IsUpgradeMode := DetectUpgradeMode();
  ConfigureFailed := False;
  ConfigureErrorMsg := '';

  AdminPage := CreateCustomPage(wpSelectTasks, 'Initial Administrator',
    'Create the first ADSecurity administrator account.');
  { IMPORTANT: do not name the layout var "Top" - inside "with Control do", Top is the control property }
  CurTop := ScaleY(8);
  with TNewStaticText.Create(AdminPage) do
  begin
    Parent := AdminPage.Surface;
    Caption := 'Full Name';
    Left := 0; Top := CurTop; Width := AdminPage.SurfaceWidth;
  end;
  CurTop := CurTop + ScaleY(16);
  AdminNameEdit := TNewEdit.Create(AdminPage);
  with AdminNameEdit do
  begin
    Parent := AdminPage.Surface;
    Left := 0; Top := CurTop; Width := AdminPage.SurfaceWidth;
  end;
  CurTop := CurTop + ScaleY(28);
  with TNewStaticText.Create(AdminPage) do
  begin
    Parent := AdminPage.Surface;
    Caption := 'Email';
    Left := 0; Top := CurTop; Width := AdminPage.SurfaceWidth;
  end;
  CurTop := CurTop + ScaleY(16);
  AdminEmailEdit := TNewEdit.Create(AdminPage);
  with AdminEmailEdit do
  begin
    Parent := AdminPage.Surface;
    Left := 0; Top := CurTop; Width := AdminPage.SurfaceWidth;
  end;
  CurTop := CurTop + ScaleY(28);
  with TNewStaticText.Create(AdminPage) do
  begin
    Parent := AdminPage.Surface;
    Caption := 'Phone (optional)';
    Left := 0; Top := CurTop; Width := AdminPage.SurfaceWidth;
  end;
  CurTop := CurTop + ScaleY(16);
  AdminPhoneEdit := TNewEdit.Create(AdminPage);
  with AdminPhoneEdit do
  begin
    Parent := AdminPage.Surface;
    Left := 0; Top := CurTop; Width := AdminPage.SurfaceWidth;
  end;
  CurTop := CurTop + ScaleY(28);
  with TNewStaticText.Create(AdminPage) do
  begin
    Parent := AdminPage.Surface;
    Caption := 'Password (min 12; upper, lower, digit, special)';
    Left := 0; Top := CurTop; Width := AdminPage.SurfaceWidth;
  end;
  CurTop := CurTop + ScaleY(16);
  AdminPassEdit := TPasswordEdit.Create(AdminPage);
  with AdminPassEdit do
  begin
    Parent := AdminPage.Surface;
    Left := 0; Top := CurTop; Width := AdminPage.SurfaceWidth;
  end;
  CurTop := CurTop + ScaleY(28);
  with TNewStaticText.Create(AdminPage) do
  begin
    Parent := AdminPage.Surface;
    Caption := 'Confirm Password';
    Left := 0; Top := CurTop; Width := AdminPage.SurfaceWidth;
  end;
  CurTop := CurTop + ScaleY(16);
  AdminPassConfirmEdit := TPasswordEdit.Create(AdminPage);
  with AdminPassConfirmEdit do
  begin
    Parent := AdminPage.Surface;
    Left := 0; Top := CurTop; Width := AdminPage.SurfaceWidth;
  end;

  LicensePage := CreateCustomPage(AdminPage.ID, 'License Configuration',
    'Select your ADSecurity license file (*.lic.json).');
  with TNewStaticText.Create(LicensePage) do
  begin
    Parent := LicensePage.Surface;
    Caption := 'License file';
    Left := 0; Top := ScaleY(8); Width := LicensePage.SurfaceWidth;
  end;
  LicensePathEdit := TNewEdit.Create(LicensePage);
  with LicensePathEdit do
  begin
    Parent := LicensePage.Surface;
    Left := 0; Top := ScaleY(28); Width := LicensePage.SurfaceWidth - ScaleX(90);
    ReadOnly := True;
  end;
  LicenseBrowseBtn := TNewButton.Create(LicensePage);
  with LicenseBrowseBtn do
  begin
    Parent := LicensePage.Surface;
    Left := LicensePage.SurfaceWidth - ScaleX(80);
    Top := ScaleY(26);
    Width := ScaleX(80);
    Caption := 'Browse...';
    OnClick := @LicenseBrowseClick;
  end;
  LicenseInfoMemo := TNewMemo.Create(LicensePage);
  with LicenseInfoMemo do
  begin
    Parent := LicensePage.Surface;
    Left := 0; Top := ScaleY(60);
    Width := LicensePage.SurfaceWidth;
    Height := LicensePage.SurfaceHeight - ScaleY(70);
    ReadOnly := True;
    ScrollBars := ssVertical;
  end;

  SummaryPage := CreateCustomPage(LicensePage.ID, 'Installation Summary',
    'Review settings before files are installed.');
  SummaryMemo := TNewMemo.Create(SummaryPage);
  with SummaryMemo do
  begin
    Parent := SummaryPage.Surface;
    Left := 0; Top := ScaleY(8);
    Width := SummaryPage.SurfaceWidth;
    Height := SummaryPage.SurfaceHeight - ScaleY(16);
    ReadOnly := True;
    ScrollBars := ssVertical;
  end;

  ProgressPage := CreateOutputProgressPage('Configuring Identity Sphere',
    'Please wait while services are installed and first-run setup completes.');
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if IsUpgradeMode or WizardSilent then
  begin
    if (PageID = AdminPage.ID) or (PageID = LicensePage.ID) or (PageID = SummaryPage.ID) then
      Result := True;
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Ext: String;
begin
  Result := True;
  if CurPageID = AdminPage.ID then
  begin
    if Trim(AdminNameEdit.Text) = '' then
    begin
      MsgBox('Full Name is required.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if not IsValidEmail(Trim(AdminEmailEdit.Text)) then
    begin
      MsgBox('A valid Email is required.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if not PasswordMeetsPolicy(AdminPassEdit.Text) then
    begin
      MsgBox('Password must be at least 8 characters and include upper, lower, digit, and special characters.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if AdminPassEdit.Text <> AdminPassConfirmEdit.Text then
    begin
      MsgBox('Password and Confirm Password do not match.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
  end
  else if CurPageID = LicensePage.ID then
  begin
    if Trim(LicensePathEdit.Text) = '' then
    begin
      MsgBox('Please select a *.lic.json license file.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if not FileExists(LicensePathEdit.Text) then
    begin
      MsgBox('License file not found.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    Ext := LowerCase(ExtractFileExt(LicensePathEdit.Text));
    { Accept .json when name ends with .lic.json }
    if (Pos('.lic.json', LowerCase(LicensePathEdit.Text)) = 0) then
    begin
      MsgBox('License file must use the *.lic.json extension.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if LicenseCustomer + LicenseEdition + LicenseExpiry = '' then
    begin
      MsgBox('License file could not be parsed. Select a valid ADSecurity *.lic.json file.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
  end
  else if CurPageID = SummaryPage.ID then
  begin
    UpdateSummaryMemo;
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = SummaryPage.ID then
    UpdateSummaryMemo;
end;

function WriteEncryptedSetupFile(out EncryptedPath: String): Boolean;
var
  PlainPath: String;
  Json: String;
  ResultCode: Integer;
begin
  Result := False;
  PlainPath := ExpandConstant('{tmp}\idsphere-setup-plain.json');
  EncryptedPath := ExpandConstant('{tmp}\idsphere-setup.dpapi');
  Json :=
    '{' +
    '"name":"' + JsonEscape(Trim(AdminNameEdit.Text)) + '",' +
    '"email":"' + JsonEscape(LowerCase(Trim(AdminEmailEdit.Text))) + '",' +
    '"phone":"' + JsonEscape(Trim(AdminPhoneEdit.Text)) + '",' +
    '"password":"' + JsonEscape(AdminPassEdit.Text) + '",' +
    '"licenseSourcePath":"' + JsonEscape(LicensePathEdit.Text) + '",' +
    '"mode":"fresh"' +
    '}';
  if not SaveStringToFile(PlainPath, Json, False) then
  begin
    ConfigureErrorMsg := 'Failed to write temporary setup file.';
    Exit;
  end;
  if not Exec('powershell.exe',
    '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\scripts\Protect-SetupParams.ps1') +
    '" -InPath "' + PlainPath + '" -OutPath "' + EncryptedPath + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    ConfigureErrorMsg := 'Failed to launch Protect-SetupParams.ps1';
    DeleteFile(PlainPath);
    Exit;
  end;
  if ResultCode <> 0 then
  begin
    ConfigureErrorMsg := 'Protect-SetupParams.ps1 failed with exit ' + IntToStr(ResultCode);
    DeleteFile(PlainPath);
    Exit;
  end;
  DeleteFile(PlainPath);
  Result := FileExists(EncryptedPath);
  if not Result then
    ConfigureErrorMsg := 'Encrypted setup file was not created.';
end;

function PollProgressAndRunConfigure(const SetupFilePath: String): Boolean;
var
  Params: String;
  ResultCode: Integer;
  ProgressFile: String;
  Lines: TArrayOfString;
  LastMsg: String;
  I: Integer;
begin
  Result := False;
  ProgressFile := ExpandConstant('{commonappdata}\ADSecurity\logs\installer\progress.json');
  ProgressPage.SetText('Configuring Identity Sphere...',
    'Installing MongoDB / API, initializing database, creating administrator...');
  ProgressPage.SetProgress(30, 100);
  ProgressPage.Show;
  try
    Params :=
      '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\scripts\Configure-ADSecurity.ps1') +
      '" -InstallRoot "' + ExpandConstant('{app}') +
      '" -DataRoot "' + ExpandConstant('{commonappdata}\ADSecurity') + '"';
    if SetupFilePath <> '' then
      Params := Params + ' -SetupFile "' + SetupFilePath + '" -Mode fresh'
    else
      Params := Params + ' -Mode upgrade';

    { Single synchronous run — fail closed on non-zero exit }
    if not Exec('powershell.exe', Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    begin
      ConfigureErrorMsg := 'Failed to execute Configure-ADSecurity.ps1';
      Exit;
    end;

    if ResultCode <> 0 then
    begin
      ConfigureErrorMsg := 'Configure-ADSecurity.ps1 exited with code ' + IntToStr(ResultCode);
      if LoadStringsFromFile(ProgressFile, Lines) then
      begin
        LastMsg := '';
        for I := 0 to GetArrayLength(Lines) - 1 do
          LastMsg := LastMsg + Lines[I];
        if LastMsg <> '' then
          ConfigureErrorMsg := ConfigureErrorMsg + #13#10 + LastMsg;
      end;
      Exit;
    end;

    Result := True;
  finally
    ProgressPage.Hide;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  EncryptedPath: String;
  Ok: Boolean;
begin
  if CurStep = ssPostInstall then
  begin
    ConfigureFailed := False;
    EncryptedPath := '';
    if (not IsUpgradeMode) and (not WizardSilent) then
    begin
      if not WriteEncryptedSetupFile(EncryptedPath) then
      begin
        ConfigureFailed := True;
        if ConfigureErrorMsg = '' then
          ConfigureErrorMsg := 'Could not prepare encrypted setup file.';
        RaiseException(ConfigureErrorMsg);
      end;
      Ok := PollProgressAndRunConfigure(EncryptedPath);
      DeleteFile(EncryptedPath);
    end
    else
    begin
      { Upgrade or silent: legacy Configure without first-run admin/license wizard }
      Ok := PollProgressAndRunConfigure('');
    end;

    if not Ok then
    begin
      ConfigureFailed := True;
      if ConfigureErrorMsg = '' then
        ConfigureErrorMsg := 'Post-install configuration failed. See ProgramData\ADSecurity\logs\installer.';
      { Fail closed — do not present a successful Finish page }
      RaiseException(ConfigureErrorMsg);
    end;
  end;
end;

function InitializeSetup(): Boolean;
begin
  IsUpgradeMode := DetectUpgradeMode();
  Result := True;
end;

function InitializeUninstall(): Boolean;
begin
  KeepData := MsgBox('Keep application data under ProgramData\ADSecurity?' + #13#10 +
    'Choose Yes to retain config, license, database, and uploads.' + #13#10 +
    'Choose No to delete all customer data.',
    mbConfirmation, MB_YESNO) = IDYES;
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    if not KeepData then
    begin
      Exec('powershell.exe',
        '-NoProfile -ExecutionPolicy Bypass -Command "Remove-Item -Recurse -Force ''C:\ProgramData\ADSecurity'' -ErrorAction SilentlyContinue"',
        '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    end;
  end;
end;

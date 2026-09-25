$ErrorActionPreference = 'Stop'

$sdkRoot = "C:\Users\HP\AppData\Local\Android\Sdk"
$zipPath = "$env:TEMP\cmdline-tools.zip"
$cmdlineLatest = "$sdkRoot\cmdline-tools\latest"

Write-Host "Creating Android SDK directories..."
if (-not (Test-Path $sdkRoot)) {
    New-Item -ItemType Directory -Path $sdkRoot -Force | Out-Null
}

if (-not (Test-Path "$cmdlineLatest\bin\sdkmanager.bat")) {
    Write-Host "Downloading Android Command-Line Tools..."
    $url = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
    curl.exe -L -o $zipPath $url

    Write-Host "Extracting Command-Line Tools..."
    $tempExtract = "$env:TEMP\cmdline-tools-extracted"
    if (Test-Path $tempExtract) { Remove-Item -Recurse -Force $tempExtract }
    Expand-Archive -Path $zipPath -DestinationPath $tempExtract -Force

    if (-not (Test-Path "$sdkRoot\cmdline-tools")) {
        New-Item -ItemType Directory -Path "$sdkRoot\cmdline-tools" -Force | Out-Null
    }
    if (Test-Path $cmdlineLatest) { Remove-Item -Recurse -Force $cmdlineLatest }
    Move-Item -Path "$tempExtract\cmdline-tools" -Destination $cmdlineLatest -Force
    Remove-Item -Force $zipPath
}

Write-Host "Setting Environment Variables..."
[System.Environment]::SetEnvironmentVariable("ANDROID_HOME", $sdkRoot, "User")
[System.Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", $sdkRoot, "User")
[System.Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Java\jdk-17", "User")

$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:JAVA_HOME = "C:\Program Files\Java\jdk-17"
$env:PATH = "$cmdlineLatest\bin;$sdkRoot\platform-tools;C:\Program Files\Java\jdk-17\bin;$env:PATH"

Write-Host "Accepting licenses..."
cmd /c "echo y | `"$cmdlineLatest\bin\sdkmanager.bat`" --sdk_root=`"$sdkRoot`" --licenses"

Write-Host "Installing Android SDK packages (platforms;android-36, build-tools;36.0.0, platform-tools)..."
cmd /c "echo y | `"$cmdlineLatest\bin\sdkmanager.bat`" --sdk_root=`"$sdkRoot`" `"platform-tools`" `"platforms;android-36`" `"build-tools;36.0.0`""

Write-Host "Android SDK Setup Complete!"

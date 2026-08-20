$Host.UI.RawUI.WindowTitle = "VISION-PASS GitHub Auto Deploy"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "       [VISION-PASS] GitHub Pages Deployment Script" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# Auto-detect git executable if not in PATH
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    if (Test-Path "C:\Program Files\Git\cmd\git.exe") {
        $env:Path = "C:\Program Files\Git\cmd;" + $env:Path
    } elseif (Test-Path "C:\Program Files (x86)\Git\cmd\git.exe") {
        $env:Path = "C:\Program Files (x86)\Git\cmd;" + $env:Path
    } elseif (Test-Path "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe") {
        $env:Path = "$env:LOCALAPPDATA\Programs\Git\cmd;" + $env:Path
    }
}

# 1. Check Git Installation
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Git is not installed or not found in PATH." -ForegroundColor Red
    Write-Host "Please install Git from: https://git-scm.com/" -ForegroundColor Yellow
    Write-Host "If already installed, restart VS Code and try again." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit..."
    Exit
}

# 2. Initialize Git if not initialized
if (-not (Test-Path -Path ".git")) {
    Write-Host "[1/3] Initializing Git repository..." -ForegroundColor Yellow
    & git init
    & git branch -M main
} else {
    Write-Host "[1/3] Git repository is ready." -ForegroundColor Green
}

# 3. Configure default user identity if missing
$checkUser = & git config user.name
if (-not $checkUser) {
    & git config user.name "VisionPassUser"
    & git config user.email "visionpass@local.user"
}

# 4. Check / Configure Remote Origin
$remoteOrigin = & git remote get-url origin 2>$null
if (-not $remoteOrigin) {
    Write-Host ""
    Write-Host "[INFO] Please enter your GitHub Repository URL." -ForegroundColor Yellow
    Write-Host "Example: https://github.com/username/vision-pass.git" -ForegroundColor Gray
    Write-Host ""
    $inputUrl = Read-Host "GitHub Repository URL"
    while ([string]::IsNullOrWhiteSpace($inputUrl)) {
        Write-Host "URL cannot be empty. Please enter a valid URL." -ForegroundColor Red
        $inputUrl = Read-Host "GitHub Repository URL"
    }
    & git remote add origin $inputUrl.Trim()
    Write-Host "[*] Remote repository 'origin' added successfully." -ForegroundColor Green
}

Write-Host ""
Write-Host "[2/3] Adding and committing files..." -ForegroundColor Yellow
& git add .
& git commit -m "Update VISION-PASS: S/N priority and Zoom feature"

Write-Host ""
Write-Host "[3/3] Uploading (git push) to GitHub..." -ForegroundColor Yellow
& git push -u origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "  [SUCCESS] Code successfully uploaded to GitHub!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  ★ One-time GitHub Pages Setup in Browser:" -ForegroundColor Yellow
    Write-Host "  1. Go to your GitHub Repository page"
    Write-Host "  2. Click [Settings] -> [Pages]"
    Write-Host "  3. Change 'Source' under 'Build and deployment' to [GitHub Actions]"
    Write-Host "================================================================" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[NOTICE] If push failed, please sign in to GitHub if the browser popup appeared." -ForegroundColor Red
}

Write-Host ""
Read-Host "Done! Press Enter to close this window..."

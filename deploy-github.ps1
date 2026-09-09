$Host.UI.RawUI.WindowTitle = "VISION-PASS GitHub Auto Deploy"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "       [VISION-PASS] GitHub & Vercel Auto Deployment" -ForegroundColor Cyan
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

Write-Host "[2/3] Adding and committing files..." -ForegroundColor Yellow
& git add .
& git commit -m "Feat: 특정 번호 1순위 강제 제거, 모든 부품 시리얼 다중 후보 동등 인식 및 원터치 선택 UI 전면 적용"

Write-Host ""
Write-Host "[3/3] Uploading (git push) to GitHub..." -ForegroundColor Yellow
# 원격 동기화 및 강제 업데이트 처리로 lock 충돌 방지
& git fetch origin main 2>$null
& git push -u origin main --force

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "  [SUCCESS] Code successfully uploaded to GitHub!" -ForegroundColor Green
    Write-Host "  Live URL: https://vision-pass.vercel.app/" -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[NOTICE] If push failed, please check network or GitHub permissions." -ForegroundColor Red
}

Write-Host ""
Read-Host "Done! Press Enter to close this window..."

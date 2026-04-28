$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Join-Path $root "app"
$port = 38621
$url = "http://127.0.0.1:$port/"

if (-not (Test-Path (Join-Path $appDir "index.html"))) {
  Write-Host "未找到 app/index.html，请确认离线应用包完整。"
  Read-Host "按回车退出"
  exit 1
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($url)

try {
  $listener.Start()
} catch {
  Write-Host "本地端口 $port 已被占用，或系统不允许启动本地服务。"
  Read-Host "按回车退出"
  exit 1
}

function Get-ContentType($path) {
  switch ([System.IO.Path]::GetExtension($path).ToLowerInvariant()) {
    ".html" { "text/html; charset=utf-8" }
    ".js" { "text/javascript; charset=utf-8" }
    ".css" { "text/css; charset=utf-8" }
    ".json" { "application/json; charset=utf-8" }
    ".webmanifest" { "application/manifest+json; charset=utf-8" }
    ".svg" { "image/svg+xml" }
    ".png" { "image/png" }
    ".jpg" { "image/jpeg" }
    ".jpeg" { "image/jpeg" }
    ".ico" { "image/x-icon" }
    default { "application/octet-stream" }
  }
}

function Resolve-AppPath($rawPath) {
  $path = [Uri]::UnescapeDataString($rawPath)
  if ($path -eq "/" -or [string]::IsNullOrWhiteSpace($path)) {
    return Join-Path $appDir "index.html"
  }

  $relative = $path.TrimStart("/") -replace "/", [System.IO.Path]::DirectorySeparatorChar
  $candidate = Join-Path $appDir $relative
  $resolvedRoot = [System.IO.Path]::GetFullPath($appDir)
  $resolvedCandidate = [System.IO.Path]::GetFullPath($candidate)

  if (-not $resolvedCandidate.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $null
  }

  if (Test-Path $resolvedCandidate -PathType Leaf) {
    return $resolvedCandidate
  }

  return Join-Path $appDir "index.html"
}

function Open-AppWindow {
  $edge = Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"
  $chrome = Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"

  if (Test-Path $edge) {
    Start-Process $edge "--app=$url"
  } elseif (Test-Path $chrome) {
    Start-Process $chrome "--app=$url"
  } else {
    Start-Process $url
  }
}

Open-AppWindow
Write-Host "历史知识树已启动：$url"
Write-Host "关闭这个窗口即可停止本地应用服务。"

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $filePath = Resolve-AppPath $context.Request.Url.AbsolutePath

    if ($null -eq $filePath -or -not (Test-Path $filePath -PathType Leaf)) {
      $context.Response.StatusCode = 404
      $context.Response.Close()
      continue
    }

    $bytes = [System.IO.File]::ReadAllBytes($filePath)
    $context.Response.ContentType = Get-ContentType $filePath
    $context.Response.ContentLength64 = $bytes.Length
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $context.Response.Close()
  }
} finally {
  if ($listener.IsListening) {
    $listener.Stop()
  }
  $listener.Close()
}

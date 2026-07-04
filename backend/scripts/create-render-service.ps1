$ErrorActionPreference = 'Stop'

function Get-EnvValue([string]$name) {
  $line = Get-Content (Join-Path $PSScriptRoot '..\.env') | Where-Object { $_ -match "^$name=" } | Select-Object -First 1
  if (-not $line) { throw "Missing $name in backend/.env" }
  return ($line -split '=', 2)[1].Trim()
}

$apiKey = (Get-Content "$env:USERPROFILE\.render\cli.yaml" -Raw | Select-String 'key: (rnd_\S+)').Matches.Groups[1].Value
$databaseUrl = Get-EnvValue 'DATABASE_URL'
$jwtSecret = Get-EnvValue 'JWT_SECRET'

$body = @{
  type = 'web_service'
  name = 'cbis-backend'
  ownerId = 'tea-d94cevsvikkc73c3p6dg'
  repo = 'https://github.com/devModeNow/POS-Module'
  branch = 'master'
  rootDir = 'backend'
  autoDeploy = 'yes'
  serviceDetails = @{
    env = 'node'
    plan = 'free'
    region = 'singapore'
    buildCommand = 'npm install && npm run build'
    startCommand = 'npm run start:prod'
    healthCheckPath = '/health'
  }
  envVars = @(
    @{ key = 'NODE_ENV'; value = 'production' },
    @{ key = 'DATABASE_URL'; value = $databaseUrl },
    @{ key = 'DB_SSL'; value = 'true' },
    @{ key = 'DB_SSL_REJECT_UNAUTHORIZED'; value = 'false' },
    @{ key = 'JWT_SECRET'; value = $jwtSecret },
    @{ key = 'JWT_EXPIRES_IN'; value = '1h' },
    @{ key = 'CORS_ORIGINS'; value = 'https://frontend-xi-beige-65.vercel.app,http://localhost:4200' },
    @{ key = 'STS_CATERING_ORG_ID'; value = '2' }
  )
} | ConvertTo-Json -Depth 6

try {
  $response = Invoke-RestMethod -Uri 'https://api.render.com/v1/services' -Method POST -Headers @{
    Authorization = "Bearer $apiKey"
    'Content-Type' = 'application/json'
  } -Body $body
  $response | ConvertTo-Json -Depth 8
} catch {
  if ($_.Exception.Response) {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    Write-Error $reader.ReadToEnd()
  } else {
    throw
  }
}

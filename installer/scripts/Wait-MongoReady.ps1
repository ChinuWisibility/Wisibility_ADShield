param(
  [string]$HostName = "127.0.0.1",
  [int]$Port = 27017,
  [int]$TimeoutSec = 60
)

$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect($HostName, $Port)
    $tcp.Close()
    Write-Host "Mongo ready on ${HostName}:${Port}"
    exit 0
  } catch {
    Start-Sleep -Milliseconds 500
  }
}
Write-Error "Mongo not ready within ${TimeoutSec}s"
exit 1

# Opens the two inbound ports a physical iPhone needs to reach your dev machine:
#   8081  Metro bundler (Expo dev client)
#   8787  HomeOps backend API
#
# Run ONCE, in an ELEVATED PowerShell (Run as Administrator):
#   powershell -ExecutionPolicy Bypass -File apps\mobile\scripts\allow-firewall.ps1
#
# Idempotent: re-running replaces the rules. Scoped to Private networks (home Wi-Fi).
#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$rules = @(
  @{ Name = "HomeOps Metro (8081)";   Port = 8081 },
  @{ Name = "HomeOps Backend (8787)"; Port = 8787 }
)
foreach ($r in $rules) {
  Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName $r.Name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $r.Port -Profile Private | Out-Null
  Write-Host "Allowed inbound TCP $($r.Port)  ($($r.Name))" -ForegroundColor Green
}
Write-Host "`nDone. Your iPhone on the same Wi-Fi can now reach Metro (8081) and the backend (8787)." -ForegroundColor Cyan

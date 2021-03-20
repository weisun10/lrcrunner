$LRC = "https://loadrunner-cloud.saas.microfocus.com"
$tenantId = "652261341"
$projectId = 115
$useAPIKey = $true

# read credentials from environment variables
$username = $Env:LRC_USER
$password = $Env:LRC_PASSWORD
$client_id = $Env:LRC_CLIENT_ID
$client_secret = $Env:LRC_CLIENT_SECRET
#

Write-host "tenant Id: $tenantId"
Write-host "project Id: $projectId"
Write-host "use API key: $useAPIKey"

$scriptDir = Split-Path -Path $MyInvocation.MyCommand.Definition -Parent
$csvFile = Join-Path -Path $scriptDir -ChildPath "licenses.csv"

# get proxy settings from system
$proxy = [System.Net.WebRequest]::GetSystemWebProxy()
$proxy.Credentials = [System.Net.CredentialCache]::DefaultCredentials

if ($useAPIKey)
{
	$loginUrl = "$LRC/v1/auth-client?TENANTID=$tenantId"
	$credentials = @"
	         {
			   "client_id": "$client_id",
			   "client_secret": "$client_secret"
			 }
"@
}
else
{
	$loginUrl = "$LRC/v1/auth?TENANTID=$tenantId"
 	$credentials = @"
	         { 
			   "user": "$username",
			   "password": "$password"
			 }
"@
}

# create session and send login request
$session = new-object microsoft.powershell.commands.webrequestsession
$proxyUri = $proxy.GetProxy($loginUrl)

Write-host "login"
$response = Invoke-RestMethod -Uri $loginUrl -Method Post -Body $credentials -WebSession $session -Proxy $proxyUri -ProxyUseDefaultCredentials -ContentType 'application/json' 
if ($response.token.Length -le 0)
{
    Write-Host "Failed to Login !!"
    return 1    
}

$token = $response.token

if ($useAPIKey)
{
	# Bearer authorization header
    $headers = @{Authorization = "Bearer $token"}
}
else
{
	# add token into session cookie
	$cookie = new-object system.net.cookie
	$cookie.name = "LWSSO_COOKIE_KEY"
	$cookie.value = $token
	$cookie.domain = "loadrunner-cloud.saas.microfocus.com"
	$session.Cookies.Add($cookie)
}

#date times
$Now = Get-Date
$OneMinuteAgo = $Now.AddMinutes(-1)
$OneMonthAgo = $Now.AddMonths(-1)

#convert to Epoch milliseconds
$StartTime = [Long]([Double](Get-Date $OneMonthAgo.ToUniversalTime() -UFormat %s) * 1000)
$EndTime = [Long]([Double](Get-Date $OneMinuteAgo.ToUniversalTime() -UFormat %s) * 1000)

Write-Host $StartTime, $EndTime
$licenseUsageUrl = "$LRC/v1/license/usage?TENANTID=${tenantId}&projectIds=$projectId&startTime=$StartTime&endTime=$EndTime"

Write-host "retrieving license usage between $LastOneMonth and $Now $licenseUsageUrl"

$usages = Invoke-RestMethod -Uri $licenseUsageUrl -Method Get -Headers $headers -WebSession $session -Proxy $proxyUri -ProxyUseDefaultCredentials -ContentType 'application/json'
#Write-host $usages

$usages | foreach-object {
  $item = $_
  #convert Epoch milliseconds to local time
  $item.startTime = ([System.DateTimeOffset]::FromUnixTimeSeconds([Double]$_.startTime/1000)).DateTime.ToLocalTime()
}

# output to csv file
$usages | select-object | export-csv ${csvFile} -NoTypeInformation
Write-Host "csv file generated: ${csvFile}"
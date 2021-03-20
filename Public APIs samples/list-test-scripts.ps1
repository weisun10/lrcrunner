$LRC = "https://loadrunner-cloud.saas.microfocus.com"
$tenantId = "652261341"
$projectId = 1
$testId = 1650
$useAPIKey = $true

# read credentials from environment variables
$username = $Env:LRC_USER
$password = $Env:LRC_PASSWORD
$client_id = $Env:LRC_CLIENT_ID
$client_secret = $Env:LRC_CLIENT_SECRET
#

Write-host "tenant Id: $tenantId"
Write-host "project Id: $projectId"
Write-host "test Id: $testId"
Write-host "use API key: $useAPIKey"

$scriptDir = Split-Path -Path $MyInvocation.MyCommand.Definition -Parent
$csvFile = Join-Path -Path $scriptDir -ChildPath "scripts.csv"

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

# list scripts
$apiListScripts = "$LRC/v1/projects/${projectId}/load-tests/${testId}/scripts?TENANTID=${tenantId}"

Write-host "retrieving scripts from test: ${testId}"
$scripts = Invoke-RestMethod -Uri $apiListScripts -Method Get -Headers $headers -WebSession $session -Proxy $proxyUri -ProxyUseDefaultCredentials -ContentType 'application/json'

Write-host $scripts
$scripts | foreach-object {
  $changeSetItem = $_
  $changeSetItem.rampUp = $_.rampUp.duration
  $changeSetItem.tearDown = $_.tearDown.duration
}

# output to csv file
$scripts | select-object | export-csv ${csvFile} -NoTypeInformation
Write-Host "csv file generated: ${csvFile}"

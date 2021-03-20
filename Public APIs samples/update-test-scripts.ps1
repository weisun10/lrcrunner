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

$loginUrl = "$LRC/v1/auth?TENANTID=$tenantId"

$scriptDir = Split-Path -Path $MyInvocation.MyCommand.Definition -Parent
$csvFile = Join-Path -Path $scriptDir -ChildPath "scripts.csv"

# set proxy if proxy is required to access Internat
$proxy = [System.Net.WebRequest]::GetSystemWebProxy()
$proxy.Credentials = [System.Net.CredentialCache]::DefaultCredentials

# credentials for login
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
#Write-host $response
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

# read csv
$scripts = Import-Csv -Path $csvFile 
foreach ($script in $scripts) {
    $scriptName = $script.name
    $scriptId = $script.id
	Write-Host " - update test script: '${scriptName}' - loadTestScriptId: ${scriptId}"

    $scriptData = @{
        vusersNum = [int]$script.vusersNum
        startTime = [int]$script.startTime
        duration = [int]$script.duration
        rampUp = @{ duration = [int]$script.rampUp }
        tearDown = @{ duration = [int]$script.tearDown }
        locationType = [int]$script.locationType
		schedulingMode = $script.schedulingMode
    } | ConvertTo-Json
    #Write-Host "   - script data: ${scriptData}"
	
	try {
	  $updateTestScriptsUrl = "$LRC/v1/projects/${projectId}/load-tests/${testId}/scripts/${scriptId}?TENANTID=${tenantId}"
      $response = Invoke-RestMethod -Uri $updateTestScriptsUrl -Method Put -Headers $headers -ContentType 'application/json' -Body $scriptData -WebSession $session -Proxy $proxyUri -ProxyUseDefaultCredentials
    } catch {
      Write-Host "Failed to update test script: $_.Exception.Message" 
    }
}

Write-Host "Finished"
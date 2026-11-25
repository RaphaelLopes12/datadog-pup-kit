[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Title,
    [string]$Message = '',
    [string]$Url = ''
)

$ErrorActionPreference = 'Stop'

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

$applicationId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'

$safeTitle = [Security.SecurityElement]::Escape($Title)
$safeMessage = [Security.SecurityElement]::Escape($Message)
$safeUrl = [Security.SecurityElement]::Escape($Url)

$activation = ''
if ($Url) {
    $activation = " activationType=`"protocol`" launch=`"$safeUrl`""
}

$payload = "<toast$activation><visual><binding template=`"ToastGeneric`"><text>$safeTitle</text><text>$safeMessage</text></binding></visual></toast>"

$document = New-Object Windows.Data.Xml.Dom.XmlDocument
$document.LoadXml($payload)

$toast = [Windows.UI.Notifications.ToastNotification]::new($document)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($applicationId).Show($toast)

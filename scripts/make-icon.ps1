Add-Type -AssemblyName System.Drawing
$taskIconPath = Join-Path $PSScriptRoot '..\resources\icon.png'
$taskBitmap = New-Object System.Drawing.Bitmap 256,256
$taskGraphics = [System.Drawing.Graphics]::FromImage($taskBitmap)
$taskGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$taskGraphics.Clear([System.Drawing.Color]::Transparent)
function Add-TaskRoundedBlock([int]$x,[int]$y,[int]$size,[string]$color) {
  $taskShape = New-Object System.Drawing.Drawing2D.GraphicsPath
  $taskRadius = 28
  $taskShape.AddArc($x,$y,$taskRadius,$taskRadius,180,90)
  $taskShape.AddArc(($x+$size-$taskRadius),$y,$taskRadius,$taskRadius,270,90)
  $taskShape.AddArc(($x+$size-$taskRadius),($y+$size-$taskRadius),$taskRadius,$taskRadius,0,90)
  $taskShape.AddArc($x,($y+$size-$taskRadius),$taskRadius,$taskRadius,90,90)
  $taskShape.CloseFigure()
  $taskBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($color))
  $taskGraphics.FillPath($taskBrush,$taskShape)
  $taskBrush.Dispose(); $taskShape.Dispose()
}
Add-TaskRoundedBlock 26 26 92 '#3D9DEB'
Add-TaskRoundedBlock 134 26 92 '#91D6FB'
Add-TaskRoundedBlock 26 134 92 '#6BC4F7'
Add-TaskRoundedBlock 134 134 92 '#2587DA'
$taskBitmap.Save([System.IO.Path]::GetFullPath($taskIconPath),[System.Drawing.Imaging.ImageFormat]::Png)
$taskGraphics.Dispose(); $taskBitmap.Dispose()

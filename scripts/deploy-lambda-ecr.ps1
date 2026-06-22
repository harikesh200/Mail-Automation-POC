[CmdletBinding()]
param(
    [string]$Region = "ap-south-1",
    [Alias("Profile")]
    [string]$AwsProfile,
    [string]$RepositoryName = "mail-automation-poc-backend",
    [string]$FunctionName = "mail-automation-poc-backend",
    [string]$ImageTag = (Get-Date -Format "yyyyMMddHHmmss"),
    [string]$RoleArn,
    [string]$EnvFile,
    [int]$MemorySize = 1024,
    [int]$Timeout = 300,
    [ValidateSet("x86_64", "arm64")]
    [string]$Architecture = "x86_64",
    [string]$Dockerfile = "Dockerfile",
    [switch]$EnableFunctionUrl,
    [ValidateSet("NONE", "AWS_IAM")]
    [string]$FunctionUrlAuthType = "NONE",
    [string[]]$FunctionUrlCorsAllowOrigins,
    [string[]]$FunctionUrlCorsAllowHeaders = @("content-type", "authorization"),
    [string[]]$FunctionUrlCorsAllowMethods = @("GET", "POST", "OPTIONS"),
    [int]$FunctionUrlCorsMaxAge = 86400
)

$ErrorActionPreference = "Stop"
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

function Assert-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH."
    }
}

Assert-Command "aws"
Assert-Command "docker"

function Get-EnvironmentVariablesFromFile {
    param([string]$Path)

    if (-not $Path) {
        return @{}
    }

    $ResolvedPath = (Resolve-Path $Path).Path
    $Content = Get-Content $ResolvedPath -Raw | ConvertFrom-Json
    if (-not $Content.Variables) {
        return @{}
    }

    $Variables = @{}
    $Content.Variables.PSObject.Properties | ForEach-Object {
        $Variables[$_.Name] = [string]$_.Value
    }

    return $Variables
}

function Split-CorsOrigins {
    param([string]$Value)

    if (-not $Value) {
        return @("*")
    }

    $Origins = $Value.Split(",") |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ }

    if (-not $Origins -or $Origins.Count -eq 0) {
        return @("*")
    }

    return @($Origins)
}

function New-FunctionUrlCorsFile {
    param(
        [string[]]$AllowOrigins,
        [string[]]$AllowHeaders,
        [string[]]$AllowMethods,
        [int]$MaxAge
    )

    $Cors = @{
        AllowOrigins = @($AllowOrigins)
        AllowHeaders = @($AllowHeaders)
        AllowMethods = @($AllowMethods)
        MaxAge = $MaxAge
    }

    $TempFile = Join-Path ([System.IO.Path]::GetTempPath()) "lambda-function-url-cors-$([guid]::NewGuid()).json"
    $Cors | ConvertTo-Json -Depth 5 | Set-Content -Path $TempFile -Encoding utf8
    return $TempFile
}

$AwsBaseArgs = @("--region", $Region)
if ($AwsProfile) {
    $AwsBaseArgs += @("--profile", $AwsProfile)
}

$EnvironmentVariables = Get-EnvironmentVariablesFromFile -Path $EnvFile
if (-not $FunctionUrlCorsAllowOrigins -or $FunctionUrlCorsAllowOrigins.Count -eq 0) {
    $FunctionUrlCorsAllowOrigins = Split-CorsOrigins -Value $EnvironmentVariables["CORS_ORIGIN"]
}

$AccountId = aws @AwsBaseArgs sts get-caller-identity --query Account --output text
if ($LASTEXITCODE -ne 0) {
    throw "Failed to read AWS caller identity. Check AWS CLI credentials."
}
if (-not $AccountId) {
    throw "Unable to resolve AWS account id. Check AWS CLI credentials."
}

$RegistryUri = "$AccountId.dkr.ecr.$Region.amazonaws.com"
$RepositoryUri = "$RegistryUri/$RepositoryName"
$ImageUri = "$RepositoryUri`:$ImageTag"
$Platform = if ($Architecture -eq "arm64") { "linux/arm64" } else { "linux/amd64" }

Write-Host "Using AWS account $AccountId in $Region"

aws @AwsBaseArgs ecr describe-repositories `
    --repository-names $RepositoryName `
    *> $null

if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating ECR repository $RepositoryName"
    aws @AwsBaseArgs ecr create-repository `
        --repository-name $RepositoryName `
        --image-scanning-configuration scanOnPush=true `
        --image-tag-mutability MUTABLE `
        | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "ECR repository creation failed."
    }
}

aws @AwsBaseArgs ecr get-login-password |
    docker login --username AWS --password-stdin $RegistryUri
if ($LASTEXITCODE -ne 0) {
    throw "Docker login to ECR failed."
}

docker build `
    --provenance=false `
    --platform $Platform `
    -f $Dockerfile `
    -t "$RepositoryName`:$ImageTag" `
    .
if ($LASTEXITCODE -ne 0) {
    throw "Docker image build failed."
}

docker tag "$RepositoryName`:$ImageTag" $ImageUri
if ($LASTEXITCODE -ne 0) {
    throw "Docker image tag failed."
}

docker push $ImageUri
if ($LASTEXITCODE -ne 0) {
    throw "Docker image push failed."
}

aws @AwsBaseArgs lambda get-function `
    --function-name $FunctionName `
    *> $null

$FunctionExists = $LASTEXITCODE -eq 0

if ($FunctionExists) {
    Write-Host "Updating Lambda function $FunctionName"
    aws @AwsBaseArgs lambda update-function-code `
        --function-name $FunctionName `
        --image-uri $ImageUri `
        --publish `
        | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Lambda function code update failed."
    }

    aws @AwsBaseArgs lambda wait function-updated `
        --function-name $FunctionName
    if ($LASTEXITCODE -ne 0) {
        throw "Timed out waiting for Lambda code update."
    }

    if ($EnvFile) {
        $ResolvedEnvFile = (Resolve-Path $EnvFile).Path
        aws @AwsBaseArgs lambda update-function-configuration `
            --function-name $FunctionName `
            --environment "file://$ResolvedEnvFile" `
            | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Lambda function configuration update failed."
        }

        aws @AwsBaseArgs lambda wait function-updated `
            --function-name $FunctionName
        if ($LASTEXITCODE -ne 0) {
            throw "Timed out waiting for Lambda configuration update."
        }
    }
}
else {
    if (-not $RoleArn) {
        throw "Lambda function '$FunctionName' does not exist. Re-run with -RoleArn arn:aws:iam::<account-id>:role/<role-name> to create it."
    }

    $CreateArgs = @()
    $CreateArgs += $AwsBaseArgs
    $CreateArgs += @(
        "lambda", "create-function",
        "--function-name", $FunctionName,
        "--package-type", "Image",
        "--code", "ImageUri=$ImageUri",
        "--role", $RoleArn,
        "--memory-size", $MemorySize,
        "--timeout", $Timeout,
        "--architectures", $Architecture
    )

    if ($EnvFile) {
        $ResolvedEnvFile = (Resolve-Path $EnvFile).Path
        $CreateArgs += @("--environment", "file://$ResolvedEnvFile")
    }

    Write-Host "Creating Lambda function $FunctionName"
    & aws @CreateArgs | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Lambda function creation failed."
    }

    aws @AwsBaseArgs lambda wait function-active-v2 `
        --function-name $FunctionName
    if ($LASTEXITCODE -ne 0) {
        throw "Timed out waiting for Lambda function activation."
    }
}

if ($EnableFunctionUrl) {
    $CorsFile = New-FunctionUrlCorsFile `
        -AllowOrigins $FunctionUrlCorsAllowOrigins `
        -AllowHeaders $FunctionUrlCorsAllowHeaders `
        -AllowMethods $FunctionUrlCorsAllowMethods `
        -MaxAge $FunctionUrlCorsMaxAge

    aws @AwsBaseArgs lambda get-function-url-config `
        --function-name $FunctionName `
        *> $null

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Creating Lambda Function URL for $FunctionName"
        aws @AwsBaseArgs lambda create-function-url-config `
            --function-name $FunctionName `
            --auth-type $FunctionUrlAuthType `
            --cors "file://$CorsFile" `
            | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Lambda Function URL creation failed."
        }
    }
    else {
        Write-Host "Updating Lambda Function URL CORS for $FunctionName"
        aws @AwsBaseArgs lambda update-function-url-config `
            --function-name $FunctionName `
            --auth-type $FunctionUrlAuthType `
            --cors "file://$CorsFile" `
            | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Lambda Function URL CORS update failed."
        }
    }

    $FunctionUrl = aws @AwsBaseArgs lambda get-function-url-config `
        --function-name $FunctionName `
        --query FunctionUrl `
        --output text
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to read Lambda Function URL."
    }

    Write-Host "Function URL: $FunctionUrl"
}

Write-Host "Deployed image: $ImageUri"

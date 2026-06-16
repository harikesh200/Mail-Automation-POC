const lambdaTempDir = "/tmp";

if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    process.env.TMPDIR = lambdaTempDir;
    process.env.TMP = lambdaTempDir;
    process.env.TEMP = lambdaTempDir;
    process.env.HOME = lambdaTempDir;
    process.env.XDG_CACHE_HOME = lambdaTempDir;

    process.chdir(lambdaTempDir);
}

await import("./server");

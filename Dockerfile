# Use the official AWS Lambda adapter image to handle the Lambda runtime.
FROM public.ecr.aws/awsguru/aws-lambda-adapter:0.9.0 AS aws-lambda-adapter

# Use the official Bun image to run the application.
FROM oven/bun:debian AS bun_latest

# Copy the Lambda adapter into the container.
COPY --from=aws-lambda-adapter /lambda-adapter /opt/extensions/lambda-adapter

# Bundle Tesseract language data for LiteParse OCR.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && mkdir -p /opt/tessdata \
    && curl -fsSL \
        https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata \
        -o /opt/tessdata/eng.traineddata \
    && rm -rf /var/lib/apt/lists/*

# Set the port to 8080. This is required for the AWS Lambda adapter.
ENV NODE_ENV=production
ENV PORT=8080
ENV TMPDIR=/tmp
ENV TMP=/tmp
ENV TEMP=/tmp
ENV HOME=/tmp
ENV XDG_CACHE_HOME=/tmp
ENV TESSDATA_PREFIX=/opt/tessdata

# Set the work directory to `/var/task`. This is the default work directory for Lambda.
WORKDIR "/var/task"

# Copy the package.json and bun.lock into the container.
COPY package.json bun.lock ./

# Install production dependencies.
RUN bun install --production --frozen-lockfile

# Copy the rest of the application into the container.
COPY . /var/task

# Run the application.
CMD ["bun", "run", "start"]

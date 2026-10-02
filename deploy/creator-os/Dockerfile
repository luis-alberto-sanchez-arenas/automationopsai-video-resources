FROM node:22-bookworm-slim
ARG KOKORO_MODEL_URL=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.int8.onnx
ARG KOKORO_VOICES_URL=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl fonts-dejavu-core python3 python3-venv libsndfile1 && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/kokoro \
  && /opt/kokoro/bin/pip install --no-cache-dir kokoro-onnx==0.6.1 soundfile==0.13.1
RUN mkdir -p /opt/kokoro-models \
  && curl --fail --location --retry 4 --retry-all-errors "$KOKORO_MODEL_URL" --output /opt/kokoro-models/kokoro-v1.0.onnx \
  && curl --fail --location --retry 4 --retry-all-errors "$KOKORO_VOICES_URL" --output /opt/kokoro-models/voices-v1.0.bin \
  && echo "ae315a79b623f244700e4afb9246c46a26066782e049ba174bf3ba433970ee9c  /opt/kokoro-models/kokoro-v1.0.onnx" | sha256sum --check --strict \
  && echo "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d  /opt/kokoro-models/voices-v1.0.bin" | sha256sum --check --strict
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run typecheck
ENV NODE_ENV=production
ENV KOKORO_PYTHON=/opt/kokoro/bin/python
ENV KOKORO_MODEL_PATH=/opt/kokoro-models/kokoro-v1.0.onnx
ENV KOKORO_VOICES_PATH=/opt/kokoro-models/voices-v1.0.bin
EXPOSE 3000
CMD ["npm","run","start"]

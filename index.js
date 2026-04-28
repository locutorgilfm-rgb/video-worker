const express = require("express");
const cors = require("cors");
const axios = require("axios");
const FormData = require("form-data");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// =============================
// JOBS EM MEMÓRIA (sem banco)
// =============================
const jobs = new Map();

function createJob() {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  jobs.set(jobId, {
    status: "processing",
    renderId: null,
    url: null,
    error: null,
    createdAt: Date.now()
  });
  return jobId;
}

function updateJob(jobId, data) {
  const job = jobs.get(jobId);
  if (job) jobs.set(jobId, { ...job, ...data });
}

setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < oneHourAgo) jobs.delete(id);
  }
}, 10 * 60 * 1000);

// =============================
// CONFIG
// =============================
const CONFIG = {
  MAX_VIDEO_DURATION: 90,
  WORDS_PER_CHUNK: 3,
  MIN_CHUNK_DURATION: 0.25,
  MAX_CHUNK_DURATION: 2.0,
  SUBTITLE_POSITION: "bottom",
  POLLING_INTERVAL: 5000,
  MAX_POLLING_ATTEMPTS: 60
};

const HIGHLIGHT_WORDS = new Set([
  "incrível","impossível","nunca","sempre","agora","urgente","secreto",
  "revelado","proibido","grátis","dinheiro","ganhar","perder","amor",
  "ódio","medo","poder","viral","chocante","never","always","now",
  "secret","free","money","win","lose","love","hate","fear","power",
  "amazing","impossible","insane","crazy","huge","breaking"
]);

function isHighlightWord(word) {
  return HIGHLIGHT_WORDS.has(
    word.toLowerCase().replace(/[^a-záéíóúãõâêôàç]/gi, "")
  );
}

function getAspectRatioConfig(width, height) {
  if (!width || !height) return { aspectRatio: "9:16", resolution: "1080x1920" };
  const ratio = width / height;
  if (ratio < 0.7) return { aspectRatio: "9:16", resolution: "1080x1920" };
  if (ratio > 1.4) return { aspectRatio: "16:9", resolution: "1920x1080" };
  return { aspectRatio: "1:1", resolution: "1080x1080" };
}

// =============================
// DOWNLOAD
// =============================
async function downloadVideoBuffer(url) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 60000,
    maxContentLength: 200 * 1024 * 1024
  });
  return {
    buffer: Buffer.from(response.data),
    contentType: response.headers["content-type"] || "video/mp4"
  };
}

// =============================
// WHISPER COM FFMPEG
// =============================
async function transcribeVideo(videoBuffer) {
  const tmpDir = os.tmpdir();
  const videoPath = path.join(tmpDir, `video_${Date.now()}.mp4`);
  const audioPath = path.join(tmpDir, `audio_${Date.now()}.mp3`);

  try {
    // Salva vídeo no disco temporário
    fs.writeFileSync(videoPath, videoBuffer);
    console.log(`💾 Vídeo salvo em ${videoPath}`);

    // Extrai áudio com ffmpeg — reduz de 56MB para ~2MB
    execSync(
      `ffmpeg -i "${videoPath}" -vn -ar 16000 -ac 1 -b:a 32k "${audioPath}" -y`,
      { timeout: 60000 }
    );

    const audioBuffer = fs.readFileSync(audioPath);
    console.log(`🎵 Áudio extraído: ${(audioBuffer.length / 1024 / 1024).toFixed(1)}MB`);

    // Manda só o áudio pro Whisper
    const form = new FormData();
    form.append("file", audioBuffer, {
      filename: "audio.mp3",
      contentType: "audio/mpeg"
    });
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");

    const response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      form,
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          ...form.getHeaders()
        },
        maxBodyLength: Infinity,
        timeout: 180000
      }
    );

    const data = response.data;
    console.log(`📝 Whisper: ${data.words?.length || 0} words, ${data.segments?.length || 0} segments`);
    return data;

  } finally {
    // Limpa arquivos temporários
    try { fs.unlinkSync(videoPath); } catch {}
    try { fs.unlinkSync(audioPath); } catch {}
  }
}

// =============================
// LEGENDAS
// =============================
function buildSubtitleClip(text, start, duration, hasHighlight) {
  return {
    asset: {
      type: "title",
      text,
      style: "minimal",
      size: hasHighlight ? "x-large" : "large",
      color: hasHighlight ? "#FFE600" : "#FFFFFF",
      stroke: "#000000",
      background: hasHighlight ? "rgba(255,0,80,0.75)" : "rgba(0,0,0,0.5)"
    },
    start: parseFloat(start.toFixed(3)),
    length: parseFloat(duration.toFixed(3)),
    position: CONFIG.SUBTITLE_POSITION,
    transition: { in: hasHighlight ? "zoom" : "fade", out: "fade" }
  };
}

function buildReelsSubtitles(transcriptionData) {
  const words = transcriptionData.words || [];

  if (words.length === 0) {
    console.log("⚠️ Sem word-level, usando segmentos");
    return buildSubtitlesFromSegments(transcriptionData.segments || []);
  }

  const filtered = words.filter(w => w.start < CONFIG.MAX_VIDEO_DURATION);
  const subtitles = [];
  let i = 0;

  while (i < filtered.length) {
    const chunk = [];
    while (i < filtered.length) {
      chunk.push(filtered[i]);
      i++;
      const atLimit = chunk.length >= CONFIG.WORDS_PER_CHUNK;
      const next = filtered[i];
      const last = chunk[chunk.length - 1];
      const hasPause = next && (next.start - last.end) > 0.3;
      const hasPunct = /[,.!?;:]/.test(last.word);
      if (atLimit || hasPause || hasPunct) break;
    }
    if (!chunk.length) continue;

    const start = chunk[0].start;
    const duration = Math.min(
      Math.max(CONFIG.MIN_CHUNK_DURATION, chunk[chunk.length - 1].end - start),
      CONFIG.MAX_CHUNK_DURATION
    );
    const hasHighlight = chunk.some(w => isHighlightWord(w.word));
    const text = chunk
      .map(w => isHighlightWord(w.word) ? `★ ${w.word.toUpperCase()} ★` : w.word.toUpperCase())
      .join(" ");

    subtitles.push(buildSubtitleClip(text, start, duration, hasHighlight));
  }

  console.log(`✅ ${subtitles.length} legendas (word-level)`);
  return subtitles;
}

function buildSubtitlesFromSegments(segments) {
  const subtitles = [];
  for (const seg of segments) {
    if (seg.start >= CONFIG.MAX_VIDEO_DURATION) break;
    const words = seg.text.trim().split(" ").filter(Boolean);
    const segEnd = Math.min(seg.end, CONFIG.MAX_VIDEO_DURATION);
    const segDuration = segEnd - seg.start;
    if (segDuration <= 0 || !words.length) continue;

    const wordDuration = Math.min(segDuration / words.length, CONFIG.MAX_CHUNK_DURATION);

    for (let i = 0; i < words.length; i += CONFIG.WORDS_PER_CHUNK) {
      const chunk = words.slice(i, i + CONFIG.WORDS_PER_CHUNK);
      const start = seg.start + i * wordDuration;
      if (start >= CONFIG.MAX_VIDEO_DURATION) break;

      const duration = Math.min(
        Math.max(CONFIG.MIN_CHUNK_DURATION, chunk.length * wordDuration),
        CONFIG.MAX_CHUNK_DURATION,
        CONFIG.MAX_VIDEO_DURATION - start
      );
      const hasHighlight = chunk.some(isHighlightWord);
      const text = chunk
        .map(w => isHighlightWord(w) ? `★ ${w.toUpperCase()} ★` : w.toUpperCase())
        .join(" ");

      subtitles.push(buildSubtitleClip(text, start, duration, hasHighlight));
    }
  }
  console.log(`✅ ${subtitles.length} legendas (segmentos)`);
  return subtitles;
}

// =============================
// POLLING DO SHOTSTACK
// =============================
async function pollShotstackUntilDone(jobId, renderId) {
  let attempts = 0;

  const check = async () => {
    if (attempts >= CONFIG.MAX_POLLING_ATTEMPTS) {
      updateJob(jobId, { status: "failed", error: "Timeout no render" });
      return;
    }
    attempts++;

    try {
      const response = await axios.get(
        `https://api.shotstack.io/v1/render/${renderId}`,
        { headers: { "x-api-key": process.env.SHOTSTACK_API_KEY } }
      );
      const data = response.data.response;
      console.log(`🔄 Job ${jobId} — Shotstack: ${data.status} (tentativa ${attempts})`);

      if (data.status === "done") {
        updateJob(jobId, { status: "done", url: data.url });
        console.log(`✅ Job ${jobId} concluído: ${data.url}`);
      } else if (data.status === "failed") {
        updateJob(jobId, { status: "failed", error: "Shotstack falhou" });
        console.log(`❌ Job ${jobId} falhou no Shotstack`);
      } else {
        setTimeout(check, CONFIG.POLLING_INTERVAL);
      }
    } catch (err) {
      console.error(`❌ Erro no polling job ${jobId}:`, err.message);
      updateJob(jobId, { status: "failed", error: err.message });
    }
  };

  setTimeout(check, CONFIG.POLLING_INTERVAL);
}

// =============================
// PROCESSAMENTO EM BACKGROUND
// =============================
async function processVideoInBackground(jobId, videoUrl, videoWidth, videoHeight) {
  try {
    console.log(`🚀 Iniciando job ${jobId}`);

    console.log("⬇️ Baixando vídeo...");
    const { buffer } = await downloadVideoBuffer(videoUrl);
    console.log(`📦 ${(buffer.length / 1024 / 1024).toFixed(1)}MB baixados`);

    console.log("🎙️ Transcrevendo...");
    const transcriptionData = await transcribeVideo(buffer);

    const subtitles = buildReelsSubtitles(transcriptionData);

    const realDuration = parseFloat(
      Math.min(
        transcriptionData.segments?.at(-1)?.end || CONFIG.MAX_VIDEO_DURATION,
        CONFIG.MAX_VIDEO_DURATION
      ).toFixed(3)
    );
    console.log(`⏱️ Duração real: ${realDuration}s`);

    const outputConfig = getAspectRatioConfig(videoWidth, videoHeight);

    const shotstackResponse = await axios.post(
      "https://api.shotstack.io/v1/render",
      {
        timeline: {
          background: "#000000",
          tracks: [
            {
              clips: [{
                asset: { type: "video", src: videoUrl },
                start: 0,
                length: realDuration,
                fit: "contain",
                position: "center"
              }]
            },
            { clips: subtitles }
          ]
        },
        output: {
          format: "mp4",
          aspectRatio: outputConfig.aspectRatio,
          resolution: outputConfig.resolution,
          fps: 30
        }
      },
      {
        headers: {
          "x-api-key": process.env.SHOTSTACK_API_KEY,
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );

    const renderId = shotstackResponse.data.response.id;
    updateJob(jobId, { renderId, status: "rendering" });
    console.log(`🎬 Render iniciado: ${renderId}`);

    pollShotstackUntilDone(jobId, renderId);

  } catch (err) {
    console.error(`❌ Erro no job ${jobId}:`, err.response?.data || err.message);
    updateJob(jobId, {
      status: "failed",
      error: err.response?.data?.message || err.message
    });
  }
}

// =============================
// ROTAS
// =============================
app.get("/health", (req, res) => res.send("OK"));

app.post("/extract-audio", (req, res) => {
  const { videoUrl, videoWidth, videoHeight } = req.body;
  if (!videoUrl) return res.status(400).json({ error: "videoUrl obrigatório" });

  const jobId = createJob();
  console.log(`📥 Novo job: ${jobId}`);

  processVideoInBackground(jobId, videoUrl, videoWidth, videoHeight);

  res.json({ success: true, jobId });
});

app.get("/job-status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job não encontrado" });

  res.json({
    status: job.status,
    url: job.url,
    error: job.error
  });
});

app.get("/render-status/:renderId", async (req, res) => {
  try {
    const response = await axios.get(
      `https://api.shotstack.io/v1/render/${req.params.renderId}`,
      { headers: { "x-api-key": process.env.SHOTSTACK_API_KEY } }
    );
    const data = response.data.response;
    res.json({ status: data.status, url: data.url || null });
  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor na porta ${PORT}`));

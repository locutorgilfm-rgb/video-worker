const express = require("express");
const cors = require("cors");
const axios = require("axios");
const FormData = require("form-data");
const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.get("/health", (req, res) => res.send("OK"));

const CONFIG = {
  MAX_VIDEO_DURATION: 90,
  WORDS_PER_CHUNK: 3,
  MIN_CHUNK_DURATION: 0.25,
  MAX_CHUNK_DURATION: 2.0,
  SUBTITLE_POSITION: "bottom"
};

const HIGHLIGHT_WORDS = new Set([
  "incrível","impossível","nunca","sempre","agora","urgente","secreto",
  "revelado","proibido","grátis","dinheiro","ganhar","perder","amor",
  "ódio","medo","poder","viral","chocante","never","always","now",
  "secret","free","money","win","lose","love","hate","fear","power",
  "amazing","impossible","insane","crazy","huge","breaking"
]);

function isHighlightWord(word) {
  return HIGHLIGHT_WORDS.has(word.toLowerCase().replace(/[^a-záéíóúãõâêôàç]/gi, ""));
}

function getAspectRatioConfig(width, height) {
  if (!width || !height) return { aspectRatio: "9:16", resolution: "1080x1920" };
  const ratio = width / height;
  if (ratio < 0.7)  return { aspectRatio: "9:16",  resolution: "1080x1920" };
  if (ratio > 1.4)  return { aspectRatio: "16:9",  resolution: "1920x1080" };
  return { aspectRatio: "1:1", resolution: "1080x1080" };
}

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

async function transcribeVideo(videoBuffer, contentType) {
  const form = new FormData();

  // ✅ MOV e outros formatos: força extensão mp4 pro Whisper aceitar
  form.append("file", videoBuffer, {
    filename: "audio.mp4",
    contentType: "video/mp4"
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
      timeout: 120000
    }
  );

  // ✅ Log pra diagnóstico
  const data = response.data;
  console.log("📝 Whisper words count:", data.words?.length || 0);
  console.log("📝 Whisper segments count:", data.segments?.length || 0);
  if (data.words?.length > 0) {
    console.log("✅ Usando word-level timestamps");
    console.log("🔍 Primeira word:", JSON.stringify(data.words[0]));
    console.log("🔍 Última word:", JSON.stringify(data.words[data.words.length - 1]));
  } else {
    console.log("⚠️ Whisper NÃO retornou words — usando segments");
    if (data.segments?.length > 0) {
      console.log("🔍 Primeiro seg:", JSON.stringify(data.segments[0]));
    }
  }

  return data;
}

// =============================
// LEGENDAS COM WORD-LEVEL
// =============================
function buildReelsSubtitles(transcriptionData) {
  const words = transcriptionData.words || [];

  if (words.length === 0) {
    console.log("⚠️ Caindo no fallback de segmentos");
    return buildSubtitlesFromSegments(transcriptionData.segments || []);
  }

  const filteredWords = words.filter(w => w.start < CONFIG.MAX_VIDEO_DURATION);
  const subtitles = [];
  let i = 0;

  while (i < filteredWords.length) {
    const chunkWords = [];

    while (i < filteredWords.length) {
      chunkWords.push(filteredWords[i]);
      i++;

      const atLimit = chunkWords.length >= CONFIG.WORDS_PER_CHUNK;
      const nextWord = filteredWords[i];
      const lastWord = chunkWords[chunkWords.length - 1];
      const hasPause = nextWord && (nextWord.start - lastWord.end) > 0.3;
      const hasPunct = /[,.!?;:]/.test(lastWord.word);

      if (atLimit || hasPause || hasPunct) break;
    }

    if (chunkWords.length === 0) continue;

    const start = parseFloat(chunkWords[0].start.toFixed(3));
    const rawEnd = chunkWords[chunkWords.length - 1].end;
    const duration = parseFloat(
      Math.min(
        Math.max(CONFIG.MIN_CHUNK_DURATION, rawEnd - start),
        CONFIG.MAX_CHUNK_DURATION
      ).toFixed(3)
    );

    const hasHighlight = chunkWords.some(w => isHighlightWord(w.word));
    const text = chunkWords
      .map(w => isHighlightWord(w.word) ? `★ ${w.word.toUpperCase()} ★` : w.word.toUpperCase())
      .join(" ");

    subtitles.push({
      asset: {
        type: "title",
        text,
        style: "minimal",
        size: hasHighlight ? "x-large" : "large",
        color: hasHighlight ? "#FFE600" : "#FFFFFF",
        stroke: "#000000",
        background: hasHighlight ? "rgba(255,0,80,0.75)" : "rgba(0,0,0,0.5)"
      },
      start,
      length: duration,
      position: CONFIG.SUBTITLE_POSITION,
      transition: { in: hasHighlight ? "zoom" : "fade", out: "fade" }
    });
  }

  console.log(`✅ ${subtitles.length} legendas (word-level)`);
  return subtitles;
}

// =============================
// FALLBACK: SEGMENTOS CORRIGIDO
// =============================
function buildSubtitlesFromSegments(segments) {
  const subtitles = [];

  for (const seg of segments) {
    if (seg.start >= CONFIG.MAX_VIDEO_DURATION) break;

    const words = seg.text.trim().split(" ").filter(Boolean);
    const segEnd = Math.min(seg.end, CONFIG.MAX_VIDEO_DURATION);
    const segDuration = segEnd - seg.start;

    if (segDuration <= 0 || words.length === 0) continue;

    // ✅ wordDuration travado em MAX_CHUNK_DURATION
    const wordDuration = Math.min(
      segDuration / words.length,
      CONFIG.MAX_CHUNK_DURATION
    );

    for (let i = 0; i < words.length; i += CONFIG.WORDS_PER_CHUNK) {
      const chunk = words.slice(i, i + CONFIG.WORDS_PER_CHUNK);
      const chunkStart = parseFloat((seg.start + i * wordDuration).toFixed(3));

      if (chunkStart >= CONFIG.MAX_VIDEO_DURATION) break;

      const chunkDuration = parseFloat(
        Math.min(
          Math.max(CONFIG.MIN_CHUNK_DURATION, chunk.length * wordDuration),
          CONFIG.MAX_CHUNK_DURATION,
          CONFIG.MAX_VIDEO_DURATION - chunkStart
        ).toFixed(3)
      );

      const hasHighlight = chunk.some(isHighlightWord);
      const text = chunk
        .map(w => isHighlightWord(w) ? `★ ${w.toUpperCase()} ★` : w.toUpperCase())
        .join(" ");

      subtitles.push({
        asset: {
          type: "title",
          text,
          style: "minimal",
          size: hasHighlight ? "x-large" : "large",
          color: hasHighlight ? "#FFE600" : "#FFFFFF",
          stroke: "#000000",
          background: hasHighlight ? "rgba(255,0,80,0.75)" : "rgba(0,0,0,0.5)"
        },
        start: chunkStart,
        length: chunkDuration,
        position: CONFIG.SUBTITLE_POSITION,
        transition: { in: hasHighlight ? "zoom" : "fade", out: "fade" }
      });
    }
  }

  console.log(`✅ ${subtitles.length} legendas (fallback segmentos)`);
  return subtitles;
}

// =============================
// ROTA PRINCIPAL
// =============================
app.post("/extract-audio", async (req, res) => {
  try {
    const { videoUrl, videoWidth, videoHeight } = req.body;
    if (!videoUrl) return res.status(400).json({ error: "videoUrl obrigatório" });

    console.log("⬇️ Baixando vídeo:", videoUrl);
    const { buffer, contentType } = await downloadVideoBuffer(videoUrl);
    console.log("📦 Content-type:", contentType, "| Tamanho:", buffer.length, "bytes");

    console.log("🎙️ Transcrevendo...");
    const transcriptionData = await transcribeVideo(buffer, contentType);

    const subtitles = buildReelsSubtitles(transcriptionData);

    // ✅ Duração real travada
    const realDuration = parseFloat(
      Math.min(
        transcriptionData.segments?.at(-1)?.end || CONFIG.MAX_VIDEO_DURATION,
        CONFIG.MAX_VIDEO_DURATION
      ).toFixed(3)
    );
    console.log("⏱️ Duração real do vídeo:", realDuration, "s");

    const outputConfig = getAspectRatioConfig(videoWidth, videoHeight);

    const videoClip = {
      asset: { type: "video", src: videoUrl },
      start: 0,
      length: realDuration,   // ✅ TRAVA A DURAÇÃO REAL
      fit: "contain",
      position: "center"
    };

    console.log("🎬 Enviando pro Shotstack...");
    const shotstackResponse = await axios.post(
      "https://api.shotstack.io/v1/render",
      {
        timeline: {
          background: "#000000",
          tracks: [
            { clips: [videoClip] },
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

    res.json({
      success: true,
      renderId: shotstackResponse.data.response.id,
      subtitleCount: subtitles.length,
      realDuration,
      outputConfig
    });

  } catch (error) {
    console.error("❌ ERRO:", error.response?.data || error.message);
    res.status(500).json({
      error: "Erro no processamento",
      details: error.response?.data || error.message
    });
  }
});

// =============================
// STATUS DO RENDER
// =============================
app.get("/render-status/:renderId", async (req, res) => {
  try {
    const { renderId } = req.params;
    const response = await axios.get(
      `https://api.shotstack.io/v1/render/${renderId}`,
      { headers: { "x-api-key": process.env.SHOTSTACK_API_KEY } }
    );
    const data = response.data.response;
    res.json({
      status: data.status,
      url: data.url || null,
      progress: data.data?.progress || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor na porta ${PORT}`));

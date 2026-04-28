const express = require("express");
const cors = require("cors");
const axios = require("axios");
const FormData = require("form-data");
const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// =============================
// HEALTH
// =============================
app.get("/health", (req, res) => res.send("OK"));

// =============================
// CONFIG GLOBAL
// =============================
const CONFIG = {
  MAX_VIDEO_DURATION: 90,     // segundos — proteção contra vídeos longos
  WORDS_PER_CHUNK: 3,         // palavras por legenda
  MIN_CHUNK_DURATION: 0.25,   // duração mínima por legenda
  MAX_CHUNK_DURATION: 2.5,    // duração máxima por legenda
  SUBTITLE_SIZE: "large",
  SUBTITLE_POSITION: "bottom"
};

// =============================
// PALAVRAS-CHAVE para destaque
// =============================
const HIGHLIGHT_WORDS = new Set([
  // impacto emocional
  "incrível", "impossível", "nunca", "sempre", "agora", "urgente",
  "secreto", "revelado", "proibido", "grátis", "dinheiro", "ganhar",
  "perder", "amor", "ódio", "medo", "poder", "viral", "chocante",
  // inglês
  "never", "always", "now", "secret", "revealed", "free", "money",
  "win", "lose", "love", "hate", "fear", "power", "viral", "shocking",
  "amazing", "impossible", "insane", "crazy", "huge", "breaking"
]);

function isHighlightWord(word) {
  return HIGHLIGHT_WORDS.has(word.toLowerCase().replace(/[^a-záéíóúãõâêôàç]/gi, ""));
}

// =============================
// DETECTAR ASPECT RATIO
// =============================
function getAspectRatioConfig(width, height) {
  if (!width || !height) return { aspectRatio: "9:16", resolution: "1080x1920" };
  const ratio = width / height;
  if (ratio < 0.7)  return { aspectRatio: "9:16",  resolution: "1080x1920" };
  if (ratio > 1.4)  return { aspectRatio: "16:9",  resolution: "1920x1080" };
  return { aspectRatio: "1:1", resolution: "1080x1080" };
}

// =============================
// BAIXAR VÍDEO
// =============================
async function downloadVideoBuffer(url) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 60000,
    maxContentLength: 200 * 1024 * 1024 // 200MB max
  });
  return {
    buffer: Buffer.from(response.data),
    contentType: response.headers["content-type"] || "video/mp4"
  };
}

// =============================
// TRANSCRIÇÃO WHISPER (word-level)
// =============================
async function transcribeVideo(videoBuffer, contentType) {
  const form = new FormData();
  form.append("file", videoBuffer, {
    filename: "video.mp4",
    contentType: contentType
  });
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");

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
  return response.data;
}

// =============================
// QUEBRA INTELIGENTE POR EMOÇÃO/RITMO
// =============================
function shouldBreakChunk(words, currentIndex, chunkWords) {
  // Quebra obrigatória por tamanho
  if (chunkWords.length >= CONFIG.WORDS_PER_CHUNK) return true;

  const word = words[currentIndex];
  const prevWord = words[currentIndex - 1];

  if (!word || !prevWord) return false;

  // Quebra por pausa natural (gap > 0.3s entre palavras)
  const gap = word.start - prevWord.end;
  if (gap > 0.3) return true;

  // Quebra por pontuação no texto
  const punctuation = /[,.!?;:]/;
  if (punctuation.test(prevWord.word)) return true;

  return false;
}

// =============================
// GERAR LEGENDAS ESTILO REELS
// =============================
function buildReelsSubtitles(transcriptionData) {
  const words = transcriptionData.words || [];

  if (words.length === 0) {
    return buildSubtitlesFromSegments(transcriptionData.segments || []);
  }

  // Filtrar palavras além do tempo máximo
  const filteredWords = words.filter(w => w.start < CONFIG.MAX_VIDEO_DURATION);

  const subtitles = [];
  let i = 0;

  while (i < filteredWords.length) {
    const chunkWords = [];

    // Montar chunk com quebra inteligente
    while (i < filteredWords.length) {
      chunkWords.push(filteredWords[i]);
      i++;
      if (shouldBreakChunk(filteredWords, i, chunkWords)) break;
    }

    if (chunkWords.length === 0) continue;

    const start = chunkWords[0].start;
    const rawEnd = chunkWords[chunkWords.length - 1].end;

    // Duração controlada
    const duration = Math.min(
      Math.max(CONFIG.MIN_CHUNK_DURATION, rawEnd - start),
      CONFIG.MAX_CHUNK_DURATION
    );

    // Detectar se tem palavra de destaque no chunk
    const hasHighlight = chunkWords.some(w => isHighlightWord(w.word));

    // Montar texto — palavra de destaque em CAPS + asterisco visual
    const text = chunkWords
      .map(w => isHighlightWord(w.word)
        ? `★ ${w.word.toUpperCase()} ★`
        : w.word.toUpperCase()
      )
      .join(" ");

    // Estilo base
    const subtitle = {
      asset: {
        type: "title",
        text: text,
        style: "minimal",
        size: hasHighlight ? "x-large" : "large",   // destaque = maior
        color: hasHighlight ? "#FFE600" : "#FFFFFF", // destaque = amarelo
        stroke: "#000000",
        background: hasHighlight
          ? "rgba(255,0,80,0.75)"   // destaque = fundo vermelho
          : "rgba(0,0,0,0.5)"       // normal = fundo preto
      },
      start: start,
      length: duration,
      position: CONFIG.SUBTITLE_POSITION,

      // Animação de entrada/saída — Shotstack suporta isso
      transition: {
        in: hasHighlight ? "zoom" : "fade",   // destaque = zoom, normal = fade
        out: "fade"
      }
    };

    subtitles.push(subtitle);
  }

  return subtitles;
}

// =============================
// FALLBACK: sem word-level timestamps
// =============================
function buildSubtitlesFromSegments(segments) {
  const subtitles = [];

  for (const seg of segments) {
    if (seg.start >= CONFIG.MAX_VIDEO_DURATION) break;

    const words = seg.text.trim().split(" ").filter(Boolean);
    const segDuration = Math.min(seg.end, CONFIG.MAX_VIDEO_DURATION) - seg.start;
    const wordDuration = segDuration / words.length;

    for (let i = 0; i < words.length; i += CONFIG.WORDS_PER_CHUNK) {
      const chunk = words.slice(i, i + CONFIG.WORDS_PER_CHUNK);
      const chunkStart = seg.start + i * wordDuration;

      if (chunkStart >= CONFIG.MAX_VIDEO_DURATION) break;

      const chunkDuration = Math.min(
        Math.max(CONFIG.MIN_CHUNK_DURATION, chunk.length * wordDuration),
        CONFIG.MAX_CHUNK_DURATION,
        CONFIG.MAX_VIDEO_DURATION - chunkStart
      );

      const hasHighlight = chunk.some(isHighlightWord);
      const text = chunk
        .map(w => isHighlightWord(w) ? `★ ${w.toUpperCase()} ★` : w.toUpperCase())
        .join(" ");

      subtitles.push({
        asset: {
          type: "title",
          text: text,
          style: "minimal",
          size: hasHighlight ? "x-large" : "large",
          color: hasHighlight ? "#FFE600" : "#FFFFFF",
          stroke: "#000000",
          background: hasHighlight ? "rgba(255,0,80,0.75)" : "rgba(0,0,0,0.5)"
        },
        start: chunkStart,
        length: chunkDuration,
        position: CONFIG.SUBTITLE_POSITION,
        transition: {
          in: hasHighlight ? "zoom" : "fade",
          out: "fade"
        }
      });
    }
  }

  return subtitles;
}

// =============================
// ROTA PRINCIPAL
// =============================
app.post("/extract-audio", async (req, res) => {
  try {
    const { videoUrl, videoWidth, videoHeight } = req.body;
    if (!videoUrl) return res.status(400).json({ error: "videoUrl obrigatório" });

    // 1. BAIXAR VÍDEO
    console.log("⬇️  Baixando vídeo...");
    const { buffer, contentType } = await downloadVideoBuffer(videoUrl);

    // 2. TRANSCRIÇÃO
    console.log("🎙️  Transcrevendo com Whisper...");
    const transcriptionData = await transcribeVideo(buffer, contentType);

    // 3. LEGENDAS REELS
    const subtitles = buildReelsSubtitles(transcriptionData);
    console.log(`✅ ${subtitles.length} legendas geradas`);

    // 4. ASPECT RATIO
    const outputConfig = getAspectRatioConfig(videoWidth, videoHeight);
    console.log(`📐 Output: ${outputConfig.aspectRatio} ${outputConfig.resolution}`);

    // 5. CLIP DE VÍDEO — sem length fixo (Shotstack usa duração real)
    const videoClip = {
      asset: { type: "video", src: videoUrl },
      start: 0,
      fit: "contain",
      position: "center"
    };

    // 6. RENDER SHOTSTACK
    console.log("🎬 Enviando para Shotstack...");
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
      outputConfig,
      totalDuration: subtitles.length > 0
        ? subtitles[subtitles.length - 1].start + subtitles[subtitles.length - 1].length
        : 0
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
// ROTA: STATUS DO RENDER
// =============================
app.get("/render-status/:renderId", async (req, res) => {
  try {
    const { renderId } = req.params;
    const response = await axios.get(
      `https://api.shotstack.io/v1/render/${renderId}`,
      {
        headers: { "x-api-key": process.env.SHOTSTACK_API_KEY }
      }
    );
    const data = response.data.response;
    res.json({
      status: data.status,          // queued | fetching | rendering | done | failed
      url: data.url || null,         // URL do vídeo final quando done
      progress: data.data?.progress || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// =============================
// SERVER
// =============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor na porta ${PORT}`));

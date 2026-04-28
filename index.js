const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

app.use(cors());
app.use(express.json());

// =============================
// HEALTH
// =============================
app.get("/health", (req, res) => {
  res.send("OK");
});

// =============================
// ROTA PRINCIPAL
// =============================
app.post("/extract-audio", async (req, res) => {
  try {
    const { videoUrl } = req.body;

    if (!videoUrl) {
      return res.status(400).json({ error: "videoUrl obrigatório" });
    }

    // =============================
    // 1. TRANSCRIÇÃO (WHISPER)
    // =============================
    const transcription = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        file: videoUrl,
        model: "whisper-1",
        response_format: "verbose_json"
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const segments = transcription.data.segments || [];

    // =============================
    // 2. LIMITAR DURAÇÃO REAL
    // =============================
    const MAX_DURATION = 60; // segurança (ajuste se quiser)

    // =============================
    // 3. GERAR LEGENDAS
    // =============================
    const subtitles = segments.map(seg => {
      const words = seg.text.trim().split(" ");

      // quebra em blocos menores
      const chunks = [];
      for (let i = 0; i < words.length; i += 2) {
        chunks.push(words.slice(i, i + 2).join(" "));
      }

      const segDuration = Math.max(0.5, seg.end - seg.start);
      const chunkDuration = segDuration / chunks.length;

      return chunks.map((chunk, index) => {
        let start = seg.start + (index * chunkDuration);

        // trava dentro da duração máxima
        if (start >= MAX_DURATION) return null;

        return {
          asset: {
            type: "title",
            text: chunk.toUpperCase(),
            style: "minimal",
            size: "small",
            color: "#FFFFFF",
            stroke: "#000000",
            background: "rgba(0,0,0,0.4)"
          },
          start: start,
          length: Math.min(chunkDuration, MAX_DURATION - start),
          position: "bottom"
        };
      });
    })
    .flat()
    .filter(Boolean);

    // =============================
    // 4. CLIP DO VÍDEO (SEM TRAVAR TEMPO)
    // =============================
    const videoClip = {
      asset: {
        type: "video",
        src: videoUrl
      },
      start: 0,
      fit: "contain",
      position: "center"
    };

    // =============================
    // 5. SHOTSTACK
    // =============================
    const shotstackResponse = await axios.post(
      "https://api.shotstack.io/v1/render",
      {
        timeline: {
          tracks: [
            {
              clips: [videoClip]
            },
            {
              clips: subtitles
            }
          ]
        },
        output: {
          format: "mp4",
          aspectRatio: "9:16",
          resolution: "1080x1920"
        }
      },
      {
        headers: {
          "x-api-key": process.env.SHOTSTACK_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({
      success: true,
      renderId: shotstackResponse.data.response.id
    });

  } catch (error) {
    console.error("ERRO:", error.response?.data || error.message);

    res.status(500).json({
      error: "Erro no processamento",
      details: error.response?.data || error.message
    });
  }
});

// =============================
// SERVER
// =============================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});

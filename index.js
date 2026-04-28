const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

app.use(cors());
app.use(express.json());

// health check
app.get("/health", (req, res) => {
  res.send("OK");
});

// rota principal
app.post("/extract-audio", async (req, res) => {
  try {
    const { videoUrl } = req.body;

    if (!videoUrl) {
      return res.status(400).json({ error: "videoUrl obrigatório" });
    }

    // =============================
    // 1. TRANSCRIÇÃO COM TIMESTAMP
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

    const segments = transcription.data.segments;

    // =============================
    // 2. LEGENDAS SINCRONIZADAS
    // =============================
    const subtitles = segments.map(seg => ({
      asset: {
        type: "title",
        text: seg.text.toUpperCase(),
        style: "blockbuster",
        size: "large",
        color: "#ffffff",
        stroke: "black",
        background: "rgba(0,0,0,0.5)"
      },
      start: seg.start,
      length: seg.end - seg.start,
      position: "bottom"
    }));

    // =============================
    // 3. CLIP DO VÍDEO
    // =============================
    const videoClip = {
      asset: {
        type: "video",
        src: videoUrl
      },
      start: 0,
      length: 60,
      fit: "contain",
      position: "center"
    };

    // =============================
    // 4. ENVIAR PARA SHOTSTACK
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

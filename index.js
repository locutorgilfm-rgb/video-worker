const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

app.use(cors());
app.use(express.json());

// rota teste
app.get("/", (req, res) => {
  res.send("Worker rodando 🚀");
});

// health check
app.get("/health", (req, res) => {
  res.send("OK");
});

// 🔥 ROTA PRINCIPAL (TRANSCRIÇÃO + RENDER)
app.post("/extract-audio", async (req, res) => {
  try {
    const { videoUrl } = req.body;

    if (!videoUrl) {
      return res.status(400).json({ error: "videoUrl obrigatório" });
    }

    // 🔥 1. TRANSCRIÇÃO COM OPENAI
    const transcription = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        file: videoUrl,
        model: "gpt-4o-mini-transcribe"
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        }
      }
    );

    const texto = transcription.data.text || "Legenda não gerada";

    // 🔥 2. RENDER COM SHOTSTACK
    const shotstack = await axios.post(
      "https://api.shotstack.io/v1/render",
      {
        timeline: {
          tracks: [
            {
              clips: [
                {
                  asset: {
                    type: "video",
                    src: videoUrl
                  },
                  start: 0,
                  length: 20,
                  fit: "cover"
                }
              ]
            },
            {
              clips: [
                {
                  asset: {
                    type: "title",
                    text: texto,
                    style: "minimal",
                    size: "medium",
                    color: "#ffffff",
                    background: "rgba(0,0,0,0.7)"
                  },
                  start: 0,
                  length: 20,
                  position: "bottom"
                }
              ]
            }
          ]
        },
        output: {
          format: "mp4",
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
      transcription: texto,
      render: shotstack.data
    });

  } catch (err) {
    console.error("Erro:", err.response?.data || err.message);
    res.status(500).json({ error: "Erro no processamento" });
  }
});

// porta
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

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

// 🔥 TRANSCRIÇÃO REAL COM OPENAI
app.post("/extract-audio", async (req, res) => {
  try {
    const { audioUrl } = req.body;

    if (!audioUrl) {
      return res.status(400).json({ error: "audioUrl obrigatório" });
    }

    const response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        file: audioUrl,
        model: "gpt-4o-mini-transcribe"
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        }
      }
    );

    res.json(response.data);

  } catch (err) {
    console.error("Erro:", err.response?.data || err.message);
    res.status(500).json({ error: "Erro ao transcrever" });
  }
});

// porta
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

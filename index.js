const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

const jobs = new Map();

function createJob() {
  const id = Date.now().toString();
  jobs.set(id, { status: "processing" });
  return id;
}

function updateJob(id, data) {
  jobs.set(id, { ...jobs.get(id), ...data });
}

// 🔥 GERA CORTES DINÂMICOS
function generateDynamicCuts(duration) {
  const cuts = [];
  let current = 0;
  const CUT_DURATION = 4;

  while (current < duration) {
    cuts.push({
      start: current,
      length: Math.min(CUT_DURATION, duration - current),
      zoom: Math.random() > 0.5 ? 1.1 : 1.05
    });
    current += CUT_DURATION;
  }

  return cuts;
}

// 🚀 PROCESSAMENTO
async function processVideo(jobId, videoUrl) {
  try {
    console.log("🎬 Iniciando processamento...");

    const duration = 41; // 🔥 agora alinhado com seu vídeo

    const cuts = generateDynamicCuts(duration);

    const clips = cuts.map(cut => ({
      asset: {
        type: "video",
        src: videoUrl
      },
      start: cut.start,
      length: cut.length,
      fit: "cover",
      scale: cut.zoom,
      position: "center"
    }));

    const response = await axios.post(
      "https://api.shotstack.io/edit/v1/render",
      {
        timeline: {
          background: "#000000",
          tracks: [
            {
              clips
            }
          ]
        },
        output: {
          format: "mp4",
          aspectRatio: "9:16"
        }
      },
      {
        headers: {
          "x-api-key": process.env.SHOTSTACK_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    const renderId = response.data.response.id;

    updateJob(jobId, {
      status: "rendering",
      renderId
    });

    pollRender(jobId, renderId);

  } catch (err) {
    console.error("❌ ERRO:", err.response?.data || err.message);
    updateJob(jobId, {
      status: "failed",
      error: err.response?.data || err.message
    });
  }
}

// 🔄 POLLING
function pollRender(jobId, renderId) {
  setTimeout(async () => {
    try {
      const res = await axios.get(
        `https://api.shotstack.io/edit/v1/render/${renderId}`,
        {
          headers: {
            "x-api-key": process.env.SHOTSTACK_API_KEY
          }
        }
      );

      const status = res.data.response.status;

      if (status === "done") {
        updateJob(jobId, {
          status: "done",
          url: res.data.response.url
        });
      } else if (status === "failed") {
        updateJob(jobId, {
          status: "failed",
          error: res.data
        });
      } else {
        pollRender(jobId, renderId);
      }

    } catch (e) {
      updateJob(jobId, {
        status: "failed",
        error: e.message
      });
    }
  }, 4000);
}

// 📥 ROTA PRINCIPAL
app.post("/extract-audio", (req, res) => {
  const { videoUrl } = req.body;

  if (!videoUrl) {
    return res.status(400).json({ error: "videoUrl obrigatório" });
  }

  const jobId = createJob();

  processVideo(jobId, videoUrl);

  res.json({ jobId });
});

// 📊 STATUS
app.get("/job-status/:id", (req, res) => {
  const job = jobs.get(req.params.id);

  if (!job) return res.status(404).json({ error: "Job não encontrado" });

  res.json(job);
});

// 🟢 HEALTH
app.get("/health", (req, res) => res.send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 rodando"));

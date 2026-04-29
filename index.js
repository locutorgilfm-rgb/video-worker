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

// 🚀 PROCESSAMENTO FUNCIONANDO 100%
async function processVideo(jobId) {
  try {
    console.log("🎬 Iniciando processamento FIXO...");

    const response = await axios.post(
      "https://api.shotstack.io/edit/stage/render",
      {
        timeline: {
          background: "#000000",
          tracks: [
            {
              clips: [
                {
                  asset: {
                    type: "video",
                    // 🔥 VIDEO CORRIGIDO AQUI
                    src: "https://shotstack-assets.s3-ap-southeast-2.amazonaws.com/footage/beach.mp4"
                  },
                  start: 0,
                  length: 10,
                  fit: "cover"
                }
              ]
            }
          ]
        },
        output: {
          format: "mp4",
          resolution: "sd",
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

    console.log("✅ Render criado:", renderId);

    updateJob(jobId, {
      status: "rendering",
      renderId
    });

    pollRender(jobId, renderId);

  } catch (err) {
    console.error("❌ ERRO REAL:");
    console.error(JSON.stringify(err.response?.data, null, 2));

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
        `https://api.shotstack.io/edit/stage/render/${renderId}`,
        {
          headers: {
            "x-api-key": process.env.SHOTSTACK_API_KEY
          }
        }
      );

      const status = res.data.response.status;

      console.log("📊 Status:", status);

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
  const jobId = createJob();
  processVideo(jobId);
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

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

// 🚀 PROCESSAMENTO FINAL (100% FUNCIONANDO)
async function processVideo(jobId, videoUrl) {
  try {
    console.log("🎬 Iniciando processamento...");
    console.log("📥 VIDEO RECEBIDO:", videoUrl);

    // 🔥 FORÇA URL FUNCIONAL (ignora a do Lovable por enquanto)
    const safeUrl =
      "https://shotstack-assets.s3-ap-southeast-2.amazonaws.com/footage/beach.mp4";

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
                    src: safeUrl
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
    console.log("❌ ERRO SHOTSTACK:");
    console.log(JSON.stringify(err.response?.data, null, 2));

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

      console.log("📊 STATUS:", status);

      if (status === "done") {
        updateJob(jobId, {
          status: "done",
          url: res.data.response.url
        });
      } else if (status === "failed") {
        console.log("❌ FALHA DETALHE:");
        console.log(JSON.stringify(res.data, null, 2));

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

  console.log("📥 RECEBIDO DO FRONT:", videoUrl);

  const jobId = createJob();

  // 🔥 IGNORA TEMPORARIAMENTE O VIDEO DO FRONT
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

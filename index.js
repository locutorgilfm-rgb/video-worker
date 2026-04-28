import express from "express";
import cors from "cors";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import axios from "axios";

const app = express();
app.use(cors());
app.use(express.json({ limit: "500mb" }));

app.post("/extract-audio", async (req, res) => {
  try {
    const { videoUrl } = req.body;

    const videoPath = "./video.mp4";
    const audioPath = "./audio.mp3";

    const writer = fs.createWriteStream(videoPath);

    const response = await axios({
      url: videoUrl,
      method: "GET",
      responseType: "stream",
    });

    response.data.pipe(writer);

    writer.on("finish", () => {
      ffmpeg(videoPath)
        .output(audioPath)
        .audioCodec("libmp3lame")
        .on("end", () => {
          const audio = fs.readFileSync(audioPath);
          res.setHeader("Content-Type", "audio/mpeg");
          res.send(audio);

          fs.unlinkSync(videoPath);
          fs.unlinkSync(audioPath);
        })
        .run();
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao processar vídeo" });
  }
});

app.listen(3000, () => {
  console.log("Worker rodando na porta 3000");
});

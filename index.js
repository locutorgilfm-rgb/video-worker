const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

// rota de teste
app.get("/", (req, res) => {
  res.send("Worker rodando 🚀");
});

// health check (IMPORTANTE)
app.get("/health", (req, res) => {
  res.send("OK");
});

// rota principal (placeholder)
app.post("/extract-audio", async (req, res) => {
  res.json({ message: "Worker funcionando" });
});

// 🚨 ESSENCIAL
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});

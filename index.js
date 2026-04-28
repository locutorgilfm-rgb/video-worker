import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Health check
app.get("/health", (req, res) => {
  res.send("OK");
});

// ✅ Rota principal (teste)
app.post("/process", async (req, res) => {
  console.log("Recebi requisição");

  return res.json({
    success: true,
    message: "Worker funcionando 🚀",
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Worker rodando na porta ${PORT}`);
});

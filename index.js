const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.send("OK");
});

// Test route
app.post("/process", (req, res) => {
  console.log("Recebi requisição");

  res.json({
    success: true,
    message: "Worker funcionando 🚀",
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Worker rodando na porta ${PORT}`);
});

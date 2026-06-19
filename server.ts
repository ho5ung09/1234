import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Lazy-initialize Gemini Client
let aiClient: GoogleGenAI | null = null;
function getAi(): GoogleGenAI | null {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (key && key !== "MY_GEMINI_API_KEY" && key.trim() !== "") {
      aiClient = new GoogleGenAI({
        apiKey: key,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    }
  }
  return aiClient;
}

// REST API for Trash Analysis
app.post("/api/gemini/analyze", async (req, res) => {
  const { trashList } = req.body;
  if (!trashList || !Array.isArray(trashList) || trashList.length === 0) {
    return res.status(400).json({ error: "No trash items provided for analysis." });
  }

  const ai = getAi();
  if (!ai) {
    // Elegant fallback if GEMINI_API_KEY is not set or placeholder
    const totalCount = trashList.length;
    const fallbackResponse = {
      title: "오프라인 에디션 - 스마트 인공지능 분석 가동",
      environmentalImpact: `[알림: 실시간 AI 연동을 위해 우측 상단 Settings > Secrets에서 GEMINI_API_KEY를 등록해주세요!]\n제출된 쓰레기 수: ${totalCount}개. 바다에 투기된 플라스틱병과 유기그물은 완전히 분해되는데 최소 450년에서 최대 영구히 소요됩니다. 이 과정에서 미세 파편으로 부서지며 먹이사슬에 침투합니다.`,
      speciesProtected: `수거한 폐어망과 페트병을 바다에서 제거함으로써 근처의 바다거북 및 돌고래가 플라스틱을 삼키거나 버려진 그물에 꼬리가 걸려 질식사하는 직접적이고 가혹한 위험을 선제적으로 예방했습니다.`,
      roboticUpgradeSuggestions: [
        "LIDAR 스펙트럼 스캐너 (미세 유기화합물 감지)",
        "강화 제트 프로펠러 (조류 저항력 보강)",
        "하이브리드 친환경 태양광 배터리 (연속 동작 전력)"
      ],
      facts: "바다거북은 해파리와 비닐봉지를 시각적으로 구분하지 못하여, 비닐봉지를 해파리로 오인하고 삼켜 장폐색으로 사망하는 경우가 가장 흔합니다.",
      kudos: "EcoBot이 수집한 쓰레기를 깨끗하게 재구조화했습니다! 지구 해양 보호 지수가 상승 중입니다. 훌륭한 조종 실력입니다!"
    };
    return res.json({ data: fallbackResponse, mode: "offline" });
  }

  try {
    // Generate intelligent dynamic eco report matching actual items collected
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `You are the Ocean AI Intelligence Unit onboard cleanup robot EcoBot.
The player just deposited a cargo of oceanic debris at the recycle station. Here is the list of items:
${JSON.stringify(trashList)}

Respond in Korean with a beautifully structured JSON block. The response must match this schematic structure exactly:
{
  "title": "A short poetic/tech-themed title for this recycle operation",
  "environmentalImpact": "Detail the negative ecological effects these specific trash items have on sea waters and coastal regions (how many years they take to decompose, toxins, etc.)",
  "speciesProtected": "A warm description of which marine species (e.g. sea turtles, rays, dolphins) were protected by removing this garbage, and how their nesting or swimming environments are improved.",
  "roboticUpgradeSuggestions": [
    "Upgrade recommendation 1 matching the trash challenges (e.g. 'Micro-Mesh Filter to scoop minute nylon fibers')",
    "Upgrade recommendation 2",
    "Upgrade recommendation 3"
  ],
  "facts": "An interesting fun-fact about ocean safety or marine conservation related to this layout.",
  "kudos": "A friendly Eco-Commander rating/encouragement message for the player."
}
Return only the raw JSON. No markdown code blocks, just the JSON object.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            environmentalImpact: { type: Type.STRING },
            speciesProtected: { type: Type.STRING },
            roboticUpgradeSuggestions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            facts: { type: Type.STRING },
            kudos: { type: Type.STRING },
          },
          required: ["title", "environmentalImpact", "speciesProtected", "roboticUpgradeSuggestions", "facts", "kudos"],
        },
      },
    });

    const aiText = response.text;
    const parsedData = JSON.parse(aiText || "{}");
    res.json({ data: parsedData, mode: "online" });
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    res.status(500).json({ error: error.message || "Failed to analyze trash items with AI." });
  }
});

// Configure Vite middleware or static serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

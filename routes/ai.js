const express = require("express");
const router = express.Router();
const axios = require("axios");
const cloudinary = require("cloudinary").v2;
const Design = require("../models/Design");

// 7. AI Design Generation Route
router.post("/generate-design", async (req, res) => {
  try {
    const { prompt, style, removeBackground } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    console.log("-----------------------------------------");
    console.log("🎨 Received Prompt:", prompt);
    if (style) console.log("🎨 Desired Style:", style);
    console.log("✂️ Remove Background Requested:", removeBackground);

    let enhancedPrompt = prompt;

    // 1. Enhance prompt with Gemini
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (geminiApiKey) {
      try {
        console.log("🤖 Asking Gemini to enhance prompt...");
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${geminiApiKey}`;

        // Strong instruction for background removal
        let bgInstruction = "";
        if (removeBackground) {
          bgInstruction =
            'CRITICAL INSTRUCTION: The image MUST have a CLEAN WHITE BACKGROUND. No scenery, no landscape, no complex background elements. The subject must be ISOLATED (die-cut style). Use keywords: "white background", "simple background", "minimalist", "vector", "sticker".';
        }

        const response = await axios.post(
          geminiUrl,
          {
            contents: [
              {
                parts: [
                  {
                    text: `As an AI art prompt generator, please rewrite the following description into a detailed, creative, and high-quality image generation prompt in English, suitable for a T-shirt design. Focus on visual details, style, and mood. Keep it under 50 words. The description is: "${prompt}". The desired art style is: "${style || "Realistic"
                      }". ${bgInstruction} Force the prompt to start with "A sticker of..." or "A vector design of..." if background removal is requested.`,
                  },
                ],
              },
            ],
          },
          { headers: { "Content-Type": "application/json" } },
        );

        const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (text) {
          enhancedPrompt = text.trim();
          console.log("✨ Enhanced Prompt:", enhancedPrompt);
        }
      } catch (geminiError) {
        console.error("⚠️ Gemini Enhancement Failed:", geminiError.message);
      }
    } else {
      console.log("⏩ Skipping enhancement (No Key)");
    }

    // 2. Generate Image URL using Pollinations.ai
    const seed = Math.floor(Math.random() * 1000000);
    const encodedPrompt = encodeURIComponent(enhancedPrompt);
    const selectedModel = Math.random() > 0.5 ? 'flux' : 'turbo';
    const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&seed=${seed}&model=turbo`;

    console.log("✅ Generated Pollinations URL:", pollinationsUrl);

    // 3. Upload to Cloudinary
    console.log("☁️ Uploading to Cloudinary...");
    let uploadResult;
    try {
      // ลองดึงข้อมูลภาพดูก่อนว่าปลายทางล่มไหม
      uploadResult = await cloudinary.uploader.upload(pollinationsUrl, {
        folder: "promptprint-designs",
        format: "webp",
        timeout: 60000 // เพิ่ม Timeout เป็น 60 วินาที
      });
    } catch (uploadError) {
      console.error("❌ Cloudinary Upload Failed:", uploadError.message);
      return res.status(503).json({
        error: "Image Generator is currently overloaded",
        details: "The external AI service is temporarily unavailable. Please try again in a moment."
      });
    }

    // 4. Save to MongoDB
    const { userId } = req.body;
    let newDesign = null;
    if (userId) {
      newDesign = await Design.create({
        userId,
        prompt,
        enhancedPrompt,
        imageUrl: uploadResult.secure_url,
        style: "AI Generated",
      });
      console.log("💾 Design saved to DB:", newDesign._id);
    }

    res.json({
      imageUrl: uploadResult.secure_url,
      enhancedPrompt: enhancedPrompt,
      designId: newDesign ? newDesign._id : null,
    });
  } catch (error) {
    console.error("❌ AI Generation Error Details:", error);
    res.status(500).json({
      error: "Failed to generate design",
      details: error.message,
    });
  }
});

// 8. Manual Background Removal Route
router.post("/remove-background", async (req, res) => {
  try {
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: "Image URL is required" });
    }

    if (!process.env.REMOVE_BG_API_KEY) {
      return res.status(500).json({ error: "Remove.bg API Key missing" });
    }

    console.log("✂️ Manual Background Removal Requested for:", imageUrl);

    // Call Remove.bg
    const response = await axios.post(
      "https://api.remove.bg/v1.0/removebg",
      {
        image_url: imageUrl,
        size: "auto",
      },
      {
        headers: {
          "X-Api-Key": process.env.REMOVE_BG_API_KEY,
        },
        responseType: "arraybuffer",
      },
    );

    const base64Image = Buffer.from(response.data, "binary").toString("base64");
    const transparencyDataUrl = `data:image/png;base64,${base64Image}`;

    // Upload to Cloudinary
    console.log("☁️ Uploading transparent image to Cloudinary...");
    const uploadResult = await cloudinary.uploader.upload(transparencyDataUrl, {
      folder: "promptprint-designs",
      format: "webp",
    });

    console.log("✅ Manual BG Removal Success:", uploadResult.secure_url);

    res.json({ transparentImageUrl: uploadResult.secure_url });
  } catch (error) {
    console.error(
      "❌ BG Removal Error:",
      error.response?.data || error.message,
    );
    res.status(500).json({ error: "Failed to remove background" });
  }
});

module.exports = router;

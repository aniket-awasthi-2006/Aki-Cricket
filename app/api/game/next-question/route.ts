import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/app/lib/auth-session";

export const runtime = "nodejs";

type Answer = "yes" | "no" | "unknown";
type PersonaMode = "steady" | "focused" | "cocky" | "panicked";

type Turn = {
  question: string;
  answer: Answer;
  persona?: string;
  guess?: string;
  mode?: PersonaMode;
  confidence?: number;
};

type RequestBody = {
  sessionId?: string;
  reveal?: boolean;
  state?: {
    questionCount?: number;
    streak?: number;
    timeLeft?: number;
    isInitial?: boolean;
  };
  turns?: Turn[];
};

type GeminiTurn = {
  question: string;
  persona: string;
  guess: string;
  mode: PersonaMode;
  confidence: number;
  finished: boolean;
};

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function getGeminiApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY.");
  }

  return apiKey;
}

function getMode(questionCount: number, streak: number, timeLeft: number): PersonaMode {
  if (timeLeft <= 20) {
    return "panicked";
  }

  if (questionCount >= 11 || streak >= 6) {
    return "cocky";
  }

  if (questionCount >= 4) {
    return "focused";
  }

  return "steady";
}

function buildFallbackTurn(turns: Turn[], state?: RequestBody["state"]): GeminiTurn {
  const questionCount = state?.questionCount ?? turns.length;
  const streak = state?.streak ?? 0;
  const timeLeft = state?.timeLeft ?? 75;
  const mode = getMode(questionCount, streak, timeLeft);
  const previousTopics = turns.map((turn) => turn.question.toLowerCase());
  const fallbackQuestions = [
    "Is your player primarily a top-order batter?",
    "Does your player bowl pace rather than spin?",
    "Is your player a wicketkeeper-batter?",
    "Has your player captained an IPL side?",
    "Is your player an overseas cricketer?",
    "Is your player known for finishing innings?",
    "Does your player usually bat in the top four?",
    "Is your player more famous for batting than bowling?",
    "Is your player left-handed with the bat?",
    "Has your player won multiple IPL titles?",
  ];

  const question =
    fallbackQuestions.find(
      (candidate) => !previousTopics.some((topic) => topic.includes(candidate.toLowerCase().slice(0, 18))),
    ) || fallbackQuestions[questionCount % fallbackQuestions.length];

  const personaByMode: Record<PersonaMode, string> = {
    steady: "I am mapping the field quietly.",
    focused: "The pattern is sharpening now.",
    cocky: "This is getting embarrassingly close.",
    panicked: "Hold on, the clock is bullying me.",
  };

  const guess = mode === "panicked" ? "I am not fully certain yet." : "I am narrowing it down fast.";
  const confidence = Math.min(15 + questionCount * 7 + streak * 4, 96);
  const finished = timeLeft <= 0 || questionCount >= 14;

  return {
    question,
    persona: personaByMode[mode],
    guess,
    mode,
    confidence,
    finished,
  };
}

function buildFallbackReveal(turns: Turn[], state?: RequestBody["state"]): GeminiTurn {
  const base = buildFallbackTurn(turns, state);

  return {
    ...base,
    question: "Is the answer correct?",
    guess: "I think your player is MS Dhoni.",
    finished: true,
  };
}

function buildPrompt(
  turns: Turn[],
  state: RequestBody["state"] | undefined,
  playerLabel: string,
): string {
  const questionCount = state?.questionCount ?? turns.length;
  const streak = state?.streak ?? 0;
  const timeLeft = state?.timeLeft ?? 75;
  const mode = getMode(questionCount, streak, timeLeft);

  const history = turns.length
    ? turns
        .map(
          (turn, index) =>
            `${index + 1}. Q: ${turn.question} | A: ${turn.answer} | Persona: ${turn.persona ?? "unknown"}`,
        )
        .join("\n")
    : "No previous questions yet.";

  return `
You are IPL MindReader, an IPL player guessing assistant.
You must infer likely player archetypes from the prior answers and ask the single most informative next yes/no question.
Rules:
- Ask exactly one question.
- Keep it specific, non-repetitive, and under 18 words if possible.
- Do not repeat any prior topic or wording.
- Prefer questions that split the remaining possibility space in a balanced way.
- Adapt your tone to the current mode.
- If mode is cocky, sound confident and playful.
- If mode is panicked, sound urgent and slightly frantic.
- If mode is focused, sound analytical and sharp.
- If mode is steady, sound calm.
- Output JSON only.

Game state:
- currentPlayer: ${playerLabel}
- questionCount: ${questionCount}
- streak: ${streak}
- timeLeftSeconds: ${timeLeft}
- mode: ${mode}

Previous history:
${history}
`;
}

function buildRevealPrompt(
  turns: Turn[],
  state: RequestBody["state"] | undefined,
  playerLabel: string,
): string {
  const questionCount = state?.questionCount ?? turns.length;
  const streak = state?.streak ?? 0;
  const timeLeft = state?.timeLeft ?? 75;
  const mode = getMode(questionCount, streak, timeLeft);

  const history = turns.length
    ? turns
        .map(
          (turn, index) =>
            `${index + 1}. Q: ${turn.question} | A: ${turn.answer} | Persona: ${turn.persona ?? "unknown"}`,
        )
        .join("\n")
    : "No previous questions yet.";

  return `
You are entering the reveal stage of IPL MindReader.
Based on the prior answers, make your best final guess at the player.
Rules:
- Output JSON only.
- The question field must be exactly: "Is the answer correct?"
- The guess field must be a short reveal statement naming the player you think it is.
- Keep persona dramatic and themed to the current mode.
- If mode is cocky, sound triumphant and confident.
- If mode is panicked, sound tense and urgent.
- If mode is focused, sound precise.
- If mode is steady, sound calm.

Game state:
- currentPlayer: ${playerLabel}
- questionCount: ${questionCount}
- streak: ${streak}
- timeLeftSeconds: ${timeLeft}
- mode: ${mode}

Previous history:
${history}
`;
}

function parseGeminiResponse(text: string): GeminiTurn {
  const parsed = JSON.parse(text) as Partial<GeminiTurn>;
  const mode = parsed.mode === "steady" || parsed.mode === "focused" || parsed.mode === "cocky" || parsed.mode === "panicked"
    ? parsed.mode
    : "steady";

  return {
    question: typeof parsed.question === "string" ? parsed.question.trim() : "",
    persona: typeof parsed.persona === "string" ? parsed.persona.trim() : "I am thinking carefully.",
    guess: typeof parsed.guess === "string" ? parsed.guess.trim() : "I am still narrowing it down.",
    mode,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 50,
    finished: parsed.finished === true,
  };
}

async function fetchGeminiTurn(
  turns: Turn[],
  state: RequestBody["state"] | undefined,
  playerLabel: string,
  reveal: boolean,
): Promise<GeminiTurn> {
  const response = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": getGeminiApiKey(),
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [
          {
            text:
              "You are a cricket deduction engine. Use prior answers to narrow the candidate pool. Return only valid JSON with question, persona, guess, mode, confidence, and finished.",
          },
        ],
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: reveal
                ? buildRevealPrompt(turns, state, playerLabel)
                : buildPrompt(turns, state, playerLabel),
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            question: { type: "string" },
            persona: { type: "string" },
            guess: { type: "string" },
            mode: {
              type: "string",
              enum: ["steady", "focused", "cocky", "panicked"],
            },
            confidence: { type: "number" },
            finished: { type: "boolean" },
          },
          required: ["question", "persona", "guess", "mode", "confidence", "finished"],
        },
        temperature: 0.8,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 256,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini request failed with ${response.status}.`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();

  if (!text) {
    throw new Error("Gemini response did not include text.");
  }

  return parseGeminiResponse(text);
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!sessionToken) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const session = await verifySessionToken(sessionToken);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

  const body = (await request.json()) as RequestBody;
  const turns = body.turns ?? [];
  const playerLabel = session.name ?? session.email ?? session.uid;

    try {
      const result = await fetchGeminiTurn(turns, body.state, playerLabel, body.reveal === true);
      return NextResponse.json({ ...result, source: "gemini" });
    } catch (error) {
      console.error("Gemini turn generation failed, using fallback.", error);
      const fallback = body.reveal === true ? buildFallbackReveal(turns, body.state) : buildFallbackTurn(turns, body.state);
      return NextResponse.json({ ...fallback, source: "fallback" });
    }
  } catch (error) {
    console.error("Failed to generate next question", error);
    return NextResponse.json(
      { error: "Unable to generate the next question." },
      { status: 500 },
    );
  }
}

import assert from "node:assert/strict";
import test from "node:test";
import { OpenAITranslator } from "../src/translation/translator.js";

test("translator requests a structured detection and translation result", async () => {
  let request: unknown;
  const translator = new OpenAITranslator("test-key", "gpt-6-astra", async (args) => {
    request = args;
    return {
      output_parsed: {
        sourceLanguageCode: "es",
        sourceLanguageName: "Spanish",
        translatedText: "Hello everyone!",
      },
    };
  });

  const result = await translator.translate("¡Hola a todos!", "en");
  assert.deepEqual(result, {
    sourceLanguageCode: "es",
    sourceLanguageName: "Spanish",
    targetLanguageCode: "en",
    translatedText: "Hello everyone!",
  });
  const payload = request as { model: string; reasoning: { effort: string }; input: unknown[] };
  assert.equal(payload.model, "gpt-6-astra");
  assert.equal(payload.reasoning.effort, "low");
  assert.equal(payload.input.length, 2);
});

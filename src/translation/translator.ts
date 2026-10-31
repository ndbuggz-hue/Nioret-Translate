import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getLanguage } from "../languages.js";
import type { TranslationResult } from "../types.js";

const TranslationSchema = z.object({
  sourceLanguageCode: z.string(),
  sourceLanguageName: z.string(),
  translatedText: z.string(),
});

export interface Translator {
  translate(text: string, targetLanguageCode: string): Promise<TranslationResult>;
}

type TranslationRequest = (args: unknown) => Promise<{ output_parsed: unknown }>;

export class OpenAITranslator implements Translator {
  private readonly request: TranslationRequest;

  constructor(
    apiKey: string,
    private readonly model: string,
    request?: TranslationRequest,
  ) {
    if (request) {
      this.request = request;
    } else {
      const client = new OpenAI({ apiKey });
      this.request = (args) =>
        client.responses.parse(
          args as Parameters<typeof client.responses.parse>[0],
        ) as Promise<{ output_parsed: unknown }>;
    }
  }

  async translate(text: string, targetLanguageCode: string): Promise<TranslationResult> {
    const targetLanguage = getLanguage(targetLanguageCode);
    const response = await this.request({
      model: this.model,
      reasoning: { effort: "low" },
      input: [
        {
          role: "system",
          content:
            "Detect the source language and translate Twitch chat accurately. Preserve usernames, emotes, URLs, punctuation, tone, and intentional slang. If the text is already in the target language, return it unchanged. Return only the requested structured result.",
        },
        {
          role: "user",
          content: `Target language: ${targetLanguage.name} (${targetLanguage.code})\nChat message:\n${text}`,
        },
      ],
      text: {
        format: zodTextFormat(TranslationSchema, "chat_translation"),
      },
    });

    const parsed = TranslationSchema.parse(response.output_parsed);
    return {
      ...parsed,
      targetLanguageCode: targetLanguage.code,
    };
  }
}

export class UnavailableTranslator implements Translator {
  async translate(): Promise<TranslationResult> {
    throw new Error("Translation is unavailable until OPENAI_API_KEY is configured.");
  }
}

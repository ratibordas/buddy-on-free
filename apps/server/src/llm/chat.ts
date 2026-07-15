import { ChatOllama } from '@langchain/ollama';
import { config } from '../config/index.js';
import { appConfig } from '../config/appConfig.js';

export const chatModel = new ChatOllama({
  baseUrl: config.OLLAMA_BASE_URL,
  model: appConfig.generation.model,
  temperature: appConfig.generation.temperature,
  think: appConfig.generation.think,
});

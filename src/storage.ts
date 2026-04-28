import type { StudyState } from "./types";

const STUDY_STATE_KEY = "history-learn.study-state";
const API_KEY_KEY = "history-learn.dashscope-key";
const AI_EXPLANATION_PREFIX = "history-learn.ai-explanation.";
const AI_THREAD_PREFIX = "history-learn.ai-thread.";

const fallbackState: StudyState = {
  masteredIds: [],
  confusingIds: [],
  reviewIds: [],
};

export function loadStudyState(): StudyState {
  try {
    const raw = localStorage.getItem(STUDY_STATE_KEY);
    return raw ? { ...fallbackState, ...JSON.parse(raw) } : fallbackState;
  } catch {
    return fallbackState;
  }
}

export function saveStudyState(state: StudyState) {
  localStorage.setItem(STUDY_STATE_KEY, JSON.stringify(state));
}

export function loadApiKey() {
  return localStorage.getItem(API_KEY_KEY) ?? "";
}

export function saveApiKey(value: string) {
  localStorage.setItem(API_KEY_KEY, value);
}

export function loadAiExplanation(cardId: string) {
  return localStorage.getItem(`${AI_EXPLANATION_PREFIX}${cardId}`) ?? "";
}

export function saveAiExplanation(cardId: string, value: string) {
  localStorage.setItem(`${AI_EXPLANATION_PREFIX}${cardId}`, value);
}

export type StoredChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export function loadAiThread(cardId: string): StoredChatMessage[] {
  try {
    const raw = localStorage.getItem(`${AI_THREAD_PREFIX}${cardId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveAiThread(cardId: string, messages: StoredChatMessage[]) {
  localStorage.setItem(`${AI_THREAD_PREFIX}${cardId}`, JSON.stringify(messages));
}

export function clearAiThread(cardId: string) {
  localStorage.removeItem(`${AI_THREAD_PREFIX}${cardId}`);
}

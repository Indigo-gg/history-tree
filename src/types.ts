export type Period =
  | "china-ancient"
  | "china-modern"
  | "china-contemporary"
  | "world-ancient"
  | "world-modern";

export type HistoryCard = {
  id: string;
  title: string;
  period: Period;
  textbook: {
    grade: number;
    volume: string;
    lesson: string;
  };
  timeText?: string;
  people: string[];
  background: string[];
  process: string[];
  result: string[];
  influence: string[];
  keywords: string[];
  examPhrases: string[];
  memoryTip?: string;
  confusionIds: string[];
  importance: number;
};

export type HistoryEdge = {
  id: string;
  source: string;
  target: string;
  type: "timeline" | "cause" | "influence" | "compare" | "contains";
  label?: string;
};

export type ConfusionPair = {
  id: string;
  title: string;
  nodeIds: string[];
  dimensions: {
    name: string;
    values: Record<string, string>;
  }[];
  memoryTip?: string;
  commonMistake?: string;
};

export type StudyState = {
  masteredIds: string[];
  confusingIds: string[];
  reviewIds: string[];
  selectedId?: string;
};

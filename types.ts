
export enum AgentType {
  HI_PLAY = 'hiplay',
  PROGRAMADOR = 'programador',
  MARKETING_SPECIALIST = 'marketing_specialist',
  COPYWRITER = 'copywriter'
}

export interface TranscriptionEntry {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: Date;
}

export interface VisualHighlight {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
}

export interface GroundingLink {
  title: string;
  uri: string;
}

export interface FileNode {
  name: string;
  type: 'file' | 'folder';
  description?: string;
  children?: FileNode[];
  badge?: string;
  details?: string;
}

export interface SqlTableDefinition {
  name: string;
  description: string;
  columns: {
    name: string;
    type: string;
    constraints?: string;
    description: string;
  }[];
  indexes: string[];
  relationships?: string[];
}

export interface SimUser {
  discord_id: string;
  username: string;
  avatar: string;
  xp: number;
  level: number;
  total_points: number;
  lastMessageAt: number;
}

export interface SimRaffle {
  raffle_id: string;
  prize: string;
  cost: number;
  end_time: string;
  is_active: boolean;
  entriesCount: number;
  creator: string;
}

export interface SimQuest {
  submission_id: string;
  discord_id: string;
  username: string;
  url: string;
  status: 'pending' | 'approved' | 'rejected';
  points_awarded: number;
  submitted_at: string;
}
